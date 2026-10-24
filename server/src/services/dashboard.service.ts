import { STATUS_LABELS } from '../lib/orderStatus.js';
import { Order } from '../models/Order.js';
import { PaymentTransaction } from '../models/PaymentTransaction.js';
import { Product } from '../models/Product.js';
import { toAdminOrderSummary } from './order-helpers.js';

export const TIMEZONE = 'Asia/Kolkata';
const IST_OFFSET_MS = 5.5 * 3600_000;

/** Midnight IST `daysAgo` days before today, as a UTC Date. */
export function startOfIstDay(now: Date, daysAgo = 0) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const midnightIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - daysAgo);
  return new Date(midnightIst - IST_OFFSET_MS);
}

function istDateKey(d: Date) {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Orders that were actually placed (excludes abandoned/expired unpaid online checkouts). */
export const PLACED_ORDER_FILTER: Record<string, unknown> = {
  status: { $ne: 'pending_payment' },
  $nor: [{ status: 'cancelled', 'payment.status': 'failed' }],
};

/**
 * Dashboard metrics. Definitions:
 *  - Range: from 00:00 IST on (today − days + 1) until now.
 *  - Orders: placed orders created in range (abandoned online checkouts excluded).
 *  - Sales: payments verified in range (Razorpay captured via signature/API/webhook,
 *    or COD cash recorded by staff), minus refunds processed in range.
 *  - Pending / awaiting shipment / in transit / completed: current counts across all time.
 */
export async function getDashboard(days: number) {
  const now = new Date();
  const start = startOfIstDay(now, days - 1);

  const [
    ordersInRange,
    paidAgg,
    refundAgg,
    statusCounts,
    lowStockCount,
    outOfStockCount,
    lowStock,
    recent,
    dailySales,
    dailyOrders,
    topProducts,
    attentionCount,
  ] = await Promise.all([
    Order.countDocuments({ ...PLACED_ORDER_FILTER, createdAt: { $gte: start } }),
    Order.aggregate<{ _id: string; total: number; count: number }>([
      { $match: { 'payment.paidAt': { $gte: start }, 'payment.amountPaid': { $gt: 0 } } },
      { $group: { _id: '$payment.method', total: { $sum: '$payment.amountPaid' }, count: { $sum: 1 } } },
    ]),
    PaymentTransaction.aggregate<{ _id: null; total: number }>([
      { $match: { type: 'refund', status: 'processed', updatedAt: { $gte: start } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Order.aggregate<{ _id: string; count: number }>([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Product.countDocuments({ status: 'active', stock: { $gt: 0 }, $expr: { $lte: ['$stock', '$lowStockThreshold'] } }),
    Product.countDocuments({ status: 'active', stock: 0 }),
    Product.find({ status: 'active', $expr: { $lte: ['$stock', '$lowStockThreshold'] } })
      .sort({ stock: 1 })
      .limit(8)
      .select('name sku stock lowStockThreshold images')
      .lean(),
    Order.find(PLACED_ORDER_FILTER).sort({ createdAt: -1 }).limit(8).lean(),
    Order.aggregate<{ _id: string; total: number }>([
      { $match: { 'payment.paidAt': { $gte: start }, 'payment.amountPaid': { $gt: 0 } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$payment.paidAt', timezone: TIMEZONE } }, total: { $sum: '$payment.amountPaid' } } },
    ]),
    Order.aggregate<{ _id: string; count: number }>([
      { $match: { ...PLACED_ORDER_FILTER, createdAt: { $gte: start } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TIMEZONE } }, count: { $sum: 1 } } },
    ]),
    Order.aggregate<{ _id: string; name: string; quantity: number; revenue: number }>([
      { $match: { ...PLACED_ORDER_FILTER, status: { $nin: ['pending_payment', 'cancelled'] }, createdAt: { $gte: start } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.sku', name: { $first: '$items.name' }, quantity: { $sum: '$items.quantity' }, revenue: { $sum: '$items.lineTotal' } } },
      { $sort: { quantity: -1 } },
      { $limit: 5 },
    ]),
    Order.countDocuments({ attention: { $ne: null } }),
  ]);

  const byStatus = Object.fromEntries(statusCounts.map((s) => [s._id, s.count])) as Record<string, number>;
  const sum = (...keys: string[]) => keys.reduce((s, k) => s + (byStatus[k] ?? 0), 0);
  const online = paidAgg.find((p) => p._id === 'razorpay');
  const cod = paidAgg.find((p) => p._id === 'cod');
  const gross = (online?.total ?? 0) + (cod?.total ?? 0);
  const refunds = refundAgg[0]?.total ?? 0;

  const salesMap = new Map(dailySales.map((d) => [d._id, d.total]));
  const ordersMap = new Map(dailyOrders.map((d) => [d._id, d.count]));
  const trend = Array.from({ length: days }, (_, i) => {
    const day = istDateKey(startOfIstDay(now, days - 1 - i));
    return { date: day, sales: salesMap.get(day) ?? 0, orders: ordersMap.get(day) ?? 0 };
  });

  return {
    range: { days, from: start, to: now, timezone: TIMEZONE },
    kpis: {
      orders: ordersInRange,
      grossSales: gross,
      refunds,
      netSales: gross - refunds,
      onlineSales: online?.total ?? 0,
      codCollected: cod?.total ?? 0,
      paidOrders: (online?.count ?? 0) + (cod?.count ?? 0),
      averageOrderValue: (online?.count ?? 0) + (cod?.count ?? 0) > 0 ? Math.round(gross / ((online?.count ?? 0) + (cod?.count ?? 0))) : 0,
    },
    pipeline: {
      awaitingPayment: sum('pending_payment'),
      pending: sum('placed', 'payment_confirmed'),
      awaitingShipment: sum('processing', 'packed'),
      inTransit: sum('shipped', 'out_for_delivery'),
      completed: sum('delivered'),
      returns: sum('return_requested'),
      cancelled: sum('cancelled'),
      needsAttention: attentionCount,
    },
    inventory: {
      lowStock: lowStockCount,
      outOfStock: outOfStockCount,
      items: lowStock.map((p) => ({
        id: String(p._id),
        name: p.name,
        sku: p.sku,
        stock: p.stock,
        lowStockThreshold: p.lowStockThreshold,
        image: p.images[0]?.url ?? null,
      })),
    },
    recentOrders: recent.map(toAdminOrderSummary),
    trend,
    topProducts: topProducts.map((t) => ({ sku: t._id, name: t.name, quantity: t.quantity, revenue: t.revenue })),
    statusLabels: STATUS_LABELS,
  };
}

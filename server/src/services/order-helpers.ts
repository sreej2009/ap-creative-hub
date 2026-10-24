import type { ClientSession, Types } from 'mongoose';
import { adminActions, customerActions, STATUS_LABELS } from '../lib/orderStatus.js';
import { verifyTrackingToken } from '../lib/tracking.js';
import { maskPhone } from '../lib/util.js';
import { Order, type IOrder } from '../models/Order.js';
import { Product } from '../models/Product.js';
import type { StockLine } from './inventory.service.js';

export type LeanOrder = IOrder & { _id: Types.ObjectId };

export function stockLines(order: Pick<IOrder, 'items'>): StockLine[] {
  return order.items.map((i) => ({
    productId: i.product,
    variantId: i.variantId ?? null,
    quantity: i.quantity,
    sku: i.sku,
    name: i.name,
  }));
}

export async function adjustSoldCount(order: Pick<IOrder, 'items'>, sign: 1 | -1, session: ClientSession | null) {
  const totals = new Map<string, { id: Types.ObjectId; qty: number }>();
  for (const i of order.items) {
    const k = String(i.product);
    totals.set(k, { id: i.product, qty: (totals.get(k)?.qty ?? 0) + i.quantity });
  }
  if (!totals.size) return;
  await Product.bulkWrite(
    [...totals.values()].map((t) => ({
      updateOne: {
        filter: sign < 0 ? { _id: t.id, soldCount: { $gte: t.qty } } : { _id: t.id },
        update: { $inc: { soldCount: sign * t.qty } },
      },
    })),
    { session: session ?? undefined },
  );
}

/**
 * Loads an order only if the requester may see it: the signed-in owner, or
 * anyone holding the order's secret tracking token. Everything else gets a
 * 404 so order numbers cannot be probed.
 */
export async function findAccessibleOrder(
  orderNumber: string,
  access: { userId?: Types.ObjectId | null; token?: string },
): Promise<LeanOrder | null> {
  if (!/^AP-\d{6}-[A-Z0-9]{5}$/.test(orderNumber)) return null;
  const order = await Order.findOne({ orderNumber }).select('+trackingSalt').lean();
  if (!order) return null;
  const isOwner = !!access.userId && !!order.user && order.user.equals(access.userId);
  if (isOwner) return order;
  if (access.token && verifyTrackingToken(String(order._id), order.trackingSalt, access.token)) return order;
  return null;
}

const actorLabel = (t: string) => (t === 'admin' || t === 'staff' ? 'A&P team' : t === 'system' ? 'System' : 'You');

export function toCustomerOrder(order: LeanOrder, returnWindowDays: number, opts: { maskContact?: boolean } = {}) {
  const mask = opts.maskContact;
  return {
    id: String(order._id),
    orderNumber: order.orderNumber,
    status: order.status,
    statusLabel: STATUS_LABELS[order.status],
    createdAt: order.createdAt,
    items: order.items.map((i) => ({
      productId: String(i.product),
      variantId: i.variantId ? String(i.variantId) : null,
      name: i.name,
      sku: i.sku,
      variantLabel: i.variantLabel ?? null,
      image: i.image ?? null,
      unitPrice: i.unitPrice,
      compareAtPrice: i.compareAtPrice ?? null,
      quantity: i.quantity,
      lineTotal: i.lineTotal,
    })),
    pricing: order.pricing,
    coupon: order.coupon ? { code: order.coupon.code, discount: order.coupon.discount } : null,
    payment: {
      method: order.payment.method,
      status: order.payment.status,
      paidAt: order.payment.paidAt ?? null,
      amountPaid: order.payment.amountPaid,
      amountRefunded: order.payment.amountRefunded,
    },
    customer: mask
      ? { name: order.customer.name, email: null, phone: maskPhone(order.customer.phone) }
      : order.customer,
    shippingAddress: mask
      ? { fullName: order.shippingAddress.fullName, city: order.shippingAddress.city, state: order.shippingAddress.state, pincode: order.shippingAddress.pincode }
      : order.shippingAddress,
    timeline: order.timeline.map((t) => ({
      status: t.status,
      label: STATUS_LABELS[t.status],
      at: t.at,
      by: actorLabel(t.actor?.type),
      note: t.note ?? null,
    })),
    shipment: order.shipment,
    courierEvents: order.courierEvents ?? [],
    cancellation: order.cancellation ? { reason: order.cancellation.reason, at: order.cancellation.at } : null,
    returnRequest: order.returnRequest ?? null,
    reservationExpiresAt: order.status === 'pending_payment' ? order.reservationExpiresAt : null,
    actions: customerActions(order, returnWindowDays),
  };
}

export function toAdminOrderSummary(order: LeanOrder) {
  return {
    id: String(order._id),
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    customer: order.customer,
    isGuest: !order.user,
    itemCount: order.items.reduce((s, i) => s + i.quantity, 0),
    total: order.pricing.total,
    status: order.status,
    statusLabel: STATUS_LABELS[order.status],
    payment: { method: order.payment.method, status: order.payment.status },
    attention: order.attention ?? null,
    city: order.shippingAddress.city,
  };
}

export function toAdminOrder(order: LeanOrder) {
  return {
    ...toAdminOrderSummary(order),
    user: order.user ? String(order.user) : null,
    shippingAddress: order.shippingAddress,
    items: order.items.map((i) => ({ ...i, product: String(i.product), variantId: i.variantId ? String(i.variantId) : null })),
    pricing: order.pricing,
    coupon: order.coupon ? { code: order.coupon.code, discount: order.coupon.discount, released: order.coupon.released } : null,
    payment: order.payment,
    inventoryState: order.inventoryState,
    reservationExpiresAt: order.reservationExpiresAt ?? null,
    timeline: order.timeline.map((t) => ({ ...t, label: STATUS_LABELS[t.status], actor: { ...t.actor, id: t.actor?.id ? String(t.actor.id) : null } })),
    internalNotes: (order.internalNotes ?? []).map((n) => ({ note: n.note, at: n.at, by: n.by?.name ?? n.by?.type })),
    shipment: order.shipment,
    courierEvents: order.courierEvents ?? [],
    cancellation: order.cancellation ?? null,
    returnRequest: order.returnRequest ?? null,
    customerNote: order.customerNote ?? null,
    whatsappOptIn: order.whatsappOptIn,
    updatedAt: order.updatedAt,
    actions: adminActions(order),
  };
}

import { Types } from 'mongoose';
import { notFound } from '../lib/errors.js';
import { STATUS_LABELS } from '../lib/orderStatus.js';
import { escapeRegex, pageMeta, paginate } from '../lib/util.js';
import { ContactMessage, Notification } from '../models/misc.js';
import { Order } from '../models/Order.js';
import { PaymentTransaction } from '../models/PaymentTransaction.js';
import { User } from '../models/User.js';
import { destroyAllSessions } from './auth.service.js';
import { toAdminOrder, toAdminOrderSummary } from './order-helpers.js';

/* ------------------------------- Orders ------------------------------- */

export interface OrderQuery {
  page: number;
  limit: number;
  q?: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  from?: string;
  to?: string;
  attention?: boolean;
}

/** Converts YYYY-MM-DD (IST calendar days) into a createdAt range. */
function istDayRange(from?: string, to?: string) {
  const range: Record<string, Date> = {};
  if (from) range.$gte = new Date(`${from}T00:00:00+05:30`);
  if (to) range.$lt = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86400_000);
  return Object.keys(range).length ? range : null;
}

function orderFilter(q: OrderQuery) {
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.paymentStatus) filter['payment.status'] = q.paymentStatus;
  if (q.paymentMethod) filter['payment.method'] = q.paymentMethod;
  if (q.attention) filter.attention = { $ne: null };
  const range = istDayRange(q.from, q.to);
  if (range) filter.createdAt = range;
  if (q.q) {
    const term = q.q.trim();
    const rx = new RegExp(escapeRegex(term), 'i');
    filter.$or = [
      { orderNumber: term.toUpperCase() },
      { orderNumber: new RegExp(`^${escapeRegex(term.toUpperCase())}`) },
      { 'customer.email': rx },
      { 'customer.name': rx },
      { 'customer.phone': rx },
      { 'shipment.trackingNumber': term },
    ];
  }
  return filter;
}

export async function listAdminOrders(q: OrderQuery) {
  const filter = orderFilter(q);
  const { skip, limit, page } = paginate(q.page, q.limit);
  const [items, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Order.countDocuments(filter),
  ]);
  return { items: items.map(toAdminOrderSummary), meta: pageMeta(total, page, limit) };
}

export async function getAdminOrder(id: string) {
  const order = await Order.findById(id).lean();
  if (!order) throw notFound('Order');
  const [transactions, notifications] = await Promise.all([
    PaymentTransaction.find({ order: order._id }).sort({ createdAt: 1 }).lean(),
    Notification.find({ order: order._id }).sort({ createdAt: -1 }).limit(50).lean(),
  ]);
  return {
    ...toAdminOrder(order),
    transactions: transactions.map((t) => ({
      id: String(t._id),
      provider: t.provider,
      type: t.type,
      status: t.status,
      amount: t.amount,
      providerOrderId: t.providerOrderId,
      providerPaymentId: t.providerPaymentId,
      providerRefundId: t.providerRefundId,
      method: t.method,
      verifiedVia: t.verifiedVia,
      errorDescription: t.errorDescription,
      reference: t.reference,
      createdAt: t.createdAt,
    })),
    notifications: notifications.map((n) => ({
      id: String(n._id),
      event: n.event,
      channel: n.channel,
      status: n.status,
      reason: n.reason ?? null,
      createdAt: n.createdAt,
    })),
  };
}

/** Prevents spreadsheet formula injection (=, +, -, @ at the start of a cell). */
function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportOrdersCsv(q: OrderQuery) {
  const orders = await Order.find(orderFilter(q)).sort({ createdAt: -1 }).limit(5000).lean();
  const header = [
    'Order number', 'Created (IST)', 'Status', 'Payment method', 'Payment status', 'Customer', 'Email', 'Phone',
    'City', 'State', 'PIN', 'Items', 'Subtotal (INR)', 'Discount (INR)', 'Shipping (INR)', 'COD fee (INR)',
    'Total (INR)', 'Paid (INR)', 'Refunded (INR)', 'Coupon', 'Courier', 'Tracking number',
  ];
  const rupees = (p: number) => (p / 100).toFixed(2);
  const rows = orders.map((o) => [
    o.orderNumber,
    new Date(o.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    STATUS_LABELS[o.status],
    o.payment.method,
    o.payment.status,
    o.customer.name,
    o.customer.email,
    o.customer.phone,
    o.shippingAddress.city,
    o.shippingAddress.state,
    o.shippingAddress.pincode,
    o.items.map((i) => `${i.sku} x${i.quantity}`).join('; '),
    rupees(o.pricing.subtotal),
    rupees(o.pricing.discount),
    rupees(o.pricing.shipping),
    rupees(o.pricing.codFee),
    rupees(o.pricing.total),
    rupees(o.payment.amountPaid),
    rupees(o.payment.amountRefunded),
    o.coupon?.code ?? '',
    o.shipment?.courierName ?? '',
    o.shipment?.trackingNumber ?? '',
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/* ------------------------------ Customers ----------------------------- */

async function orderStats(userIds: Types.ObjectId[]) {
  const rows = await Order.aggregate<{ _id: Types.ObjectId; orders: number; spent: number; lastOrderAt: Date }>([
    { $match: { user: { $in: userIds }, status: { $ne: 'pending_payment' } } },
    {
      $group: {
        _id: '$user',
        orders: { $sum: 1 },
        spent: { $sum: { $subtract: ['$payment.amountPaid', '$payment.amountRefunded'] } },
        lastOrderAt: { $max: '$createdAt' },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), r]));
}

export async function listCustomers(q: { page: number; limit: number; q?: string; status?: 'active' | 'disabled' }) {
  const filter: Record<string, unknown> = { role: 'customer' };
  if (q.status) filter.isActive = q.status === 'active';
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
  }
  const { skip, limit, page } = paginate(q.page, q.limit);
  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  const stats = await orderStats(users.map((u) => u._id));
  return {
    items: users.map((u) => {
      const s = stats.get(String(u._id));
      return {
        id: String(u._id),
        name: u.name,
        email: u.email,
        phone: u.phone ?? null,
        isActive: u.isActive,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt ?? null,
        orders: s?.orders ?? 0,
        totalSpent: s?.spent ?? 0,
        lastOrderAt: s?.lastOrderAt ?? null,
      };
    }),
    meta: pageMeta(total, page, limit),
  };
}

export async function getCustomer(id: string) {
  const user = await User.findOne({ _id: id, role: 'customer' }).lean();
  if (!user) throw notFound('Customer');
  const [orders, stats] = await Promise.all([
    Order.find({ user: user._id }).sort({ createdAt: -1 }).limit(100).lean(),
    orderStats([user._id]),
  ]);
  const s = stats.get(String(user._id));
  // Password hashes, reset tokens and payment credentials are never included.
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    phone: user.phone ?? null,
    isActive: user.isActive,
    whatsappOptIn: user.whatsappOptIn,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt ?? null,
    addresses: user.addresses.map((a) => ({ ...a, _id: String(a._id) })),
    stats: { orders: s?.orders ?? 0, totalSpent: s?.spent ?? 0, lastOrderAt: s?.lastOrderAt ?? null },
    orders: orders.map(toAdminOrderSummary),
  };
}

export async function setCustomerStatus(id: string, isActive: boolean) {
  const user = await User.findOneAndUpdate({ _id: id, role: 'customer' }, { $set: { isActive } }, { returnDocument: 'after' }).lean();
  if (!user) throw notFound('Customer');
  if (!isActive) await destroyAllSessions(user._id);
  return { id: String(user._id), isActive: user.isActive };
}

/* ---------------------------- Notifications --------------------------- */

export async function listNotifications(q: { page: number; limit: number; status?: string; channel?: string }) {
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.channel) filter.channel = q.channel;
  const { skip, limit, page } = paginate(q.page, q.limit);
  const [items, total] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('order', 'orderNumber').lean(),
    Notification.countDocuments(filter),
  ]);
  return {
    items: items.map((n) => ({
      id: String(n._id),
      event: n.event,
      channel: n.channel,
      recipient: n.recipient,
      status: n.status,
      reason: n.reason ?? null,
      subject: n.subject ?? null,
      order: n.order ? (n.order as unknown as { orderNumber: string }).orderNumber : null,
      orderId: n.order ? String((n.order as unknown as { _id: Types.ObjectId })._id) : null,
      createdAt: n.createdAt,
    })),
    meta: pageMeta(total, page, limit),
  };
}

/* ------------------------------ Messages ------------------------------ */

export async function listMessages(q: { page: number; limit: number; status?: string }) {
  const filter: Record<string, unknown> = q.status ? { status: q.status } : {};
  const { skip, limit, page } = paginate(q.page, q.limit);
  const [items, total, unread] = await Promise.all([
    ContactMessage.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ContactMessage.countDocuments(filter),
    ContactMessage.countDocuments({ status: 'new' }),
  ]);
  return {
    items: items.map((m) => ({ id: String(m._id), name: m.name, email: m.email, phone: m.phone ?? null, subject: m.subject, message: m.message, status: m.status, createdAt: m.createdAt })),
    meta: { ...pageMeta(total, page, limit), unread },
  };
}

export async function setMessageStatus(id: string, status: 'new' | 'read' | 'resolved') {
  const m = await ContactMessage.findByIdAndUpdate(id, { $set: { status } }, { returnDocument: 'after' }).lean();
  if (!m) throw notFound('Message');
  return { id: String(m._id), status: m.status };
}


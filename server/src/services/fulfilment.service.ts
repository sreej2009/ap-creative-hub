import type { ClientSession, Types } from 'mongoose';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors.js';
import {
  CANCELLABLE_BY_ADMIN,
  CANCELLABLE_BY_CUSTOMER,
  SHIPMENT_EDITABLE,
  STATUS_LABELS,
  canTransition,
} from '../lib/orderStatus.js';
import { runInTransaction } from '../lib/transaction.js';
import { Order, type Actor, type OrderStatus, type PaymentStatus } from '../models/Order.js';
import { PaymentTransaction } from '../models/PaymentTransaction.js';
import type { AdjustmentReason } from '../models/InventoryAdjustment.js';
import { releaseCouponForOrder } from './coupon.service.js';
import { restoreStock } from './inventory.service.js';
import { notifications } from './notification.service.js';
import { adjustSoldCount, stockLines, type LeanOrder } from './order-helpers.js';
import { getSettings } from './settings.service.js';

export const SYSTEM_ACTOR: Actor = { type: 'system', id: null, name: 'System' };

/**
 * Returns an order's stock exactly once. The inventoryState flip is the
 * guard: a second call (e.g. a retried job or duplicate request) finds the
 * state already 'released' and does nothing.
 */
export async function releaseOrderInventory(
  orderId: Types.ObjectId,
  reason: AdjustmentReason,
  actor: Actor,
  session: ClientSession | null,
) {
  const before = await Order.findOneAndUpdate(
    { _id: orderId, inventoryState: { $in: ['reserved', 'committed'] } },
    { $set: { inventoryState: 'released' } },
    { session, returnDocument: 'before' },
  ).lean();
  if (!before) return false;
  await restoreStock(stockLines(before), reason, { session, actor, orderId });
  if (before.inventoryState === 'committed') await adjustSoldCount(before, -1, session);
  return true;
}

function nextPaymentStatusOnCancel(current: PaymentStatus, bySystem: boolean): PaymentStatus {
  if (current === 'awaiting_payment') return bySystem ? 'failed' : 'void';
  if (current === 'cod_pending') return 'void';
  return current; // paid stays paid until a refund is processed
}

export async function cancelOrder(
  orderId: Types.ObjectId | string,
  actor: Actor,
  reason: string,
  opts: { allowedFrom?: OrderStatus[]; notify?: boolean } = {},
) {
  const allowedFrom = opts.allowedFrom ?? (actor.type === 'customer' ? CANCELLABLE_BY_CUSTOMER : CANCELLABLE_BY_ADMIN);
  const result = await runInTransaction(async (session) => {
    const current = await Order.findById(orderId).session(session).lean();
    if (!current) throw notFound('Order');
    if (!allowedFrom.includes(current.status)) {
      throw conflict(`An order that is "${STATUS_LABELS[current.status]}" can no longer be cancelled.`, 'INVALID_TRANSITION');
    }
    const now = new Date();
    const paymentStatus = nextPaymentStatusOnCancel(current.payment.status, actor.type === 'system');
    const needsRefund = current.payment.amountPaid - current.payment.amountRefunded > 0;
    const updated = await Order.findOneAndUpdate(
      { _id: current._id, status: current.status },
      {
        $set: {
          status: 'cancelled',
          'payment.status': paymentStatus,
          reservationExpiresAt: null,
          cancellation: { reason, at: now, by: actor },
          ...(needsRefund ? { attention: { reason: 'Refund required — order was cancelled after payment.', at: now } } : {}),
        },
        $push: { timeline: { status: 'cancelled', at: now, actor, note: reason } },
      },
      { session, returnDocument: 'after' },
    ).lean();
    if (!updated) throw conflict('The order was updated by someone else. Please reload.', 'ORDER_CHANGED');
    await releaseOrderInventory(current._id, 'order_released', actor, session);
    await releaseCouponForOrder(current._id, session);
    return { order: updated, wasPending: current.status === 'pending_payment' };
  });
  // Customers who abandoned payment never received a confirmation; don't email them on expiry.
  const shouldNotify = opts.notify ?? !(result.wasPending && actor.type === 'system');
  if (shouldNotify) notifications.orderEvent('cancellation', result.order._id);
  return result.order;
}

export async function transitionOrder(
  orderId: string,
  to: OrderStatus,
  actor: Actor,
  opts: { note?: string; shipment?: { courierName: string; trackingNumber: string; trackingUrl?: string } } = {},
) {
  const current = await Order.findById(orderId).lean();
  if (!current) throw notFound('Order');
  if (to === 'cancelled') throw badRequest('Use the cancel action to cancel an order.');
  if (to === 'payment_confirmed') throw badRequest('Payments are confirmed automatically after verification with the payment provider.');
  if (to === 'refunded') throw badRequest('Orders are marked refunded only after a refund is processed.');
  if (to === 'returned') throw badRequest('Use the return workflow to mark an order as returned.');
  if (!canTransition(current.status, to)) {
    throw conflict(`Cannot change status from "${STATUS_LABELS[current.status]}" to "${STATUS_LABELS[to]}".`, 'INVALID_TRANSITION');
  }

  const now = new Date();
  const set: Record<string, unknown> = { status: to };
  if (to === 'shipped') {
    const shipment = opts.shipment ?? current.shipment;
    if (!shipment?.courierName || !shipment?.trackingNumber) {
      throw unprocessable('Add the courier name and tracking number before marking the order as shipped.', 'SHIPMENT_REQUIRED');
    }
    if (opts.shipment) {
      set['shipment.courierName'] = opts.shipment.courierName;
      set['shipment.trackingNumber'] = opts.shipment.trackingNumber;
      set['shipment.trackingUrl'] = opts.shipment.trackingUrl ?? null;
    }
    set['shipment.shippedAt'] = now;
  }
  if (to === 'delivered') set['shipment.deliveredAt'] = now;
  if (to === 'return_requested') set.returnRequest = { reason: opts.note ?? 'Requested via support', requestedAt: now };

  const updated = await Order.findOneAndUpdate(
    { _id: current._id, status: current.status },
    { $set: set, $push: { timeline: { status: to, at: now, actor, note: opts.note } } },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) throw conflict('The order was updated by someone else. Please reload.', 'ORDER_CHANGED');

  if (to === 'shipped') notifications.orderEvent('shipment', updated._id);
  if (to === 'out_for_delivery' || to === 'delivered') notifications.orderEvent('delivery_update', updated._id);
  return updated;
}

export async function updateShipment(
  orderId: string,
  input: { courierName: string; trackingNumber: string; trackingUrl?: string },
  actor: Actor,
) {
  const updated = await Order.findOneAndUpdate(
    { _id: orderId, status: { $in: SHIPMENT_EDITABLE } },
    {
      $set: {
        'shipment.courierName': input.courierName,
        'shipment.trackingNumber': input.trackingNumber,
        'shipment.trackingUrl': input.trackingUrl ?? null,
      },
      $push: {
        internalNotes: { note: `Tracking set: ${input.courierName} ${input.trackingNumber}`, at: new Date(), by: actor },
      },
    },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) {
    if (!(await Order.exists({ _id: orderId }))) throw notFound('Order');
    throw conflict('Tracking details can only be edited while the order is being processed or in transit.', 'INVALID_STATE');
  }
  return updated;
}

export async function addInternalNote(orderId: string, note: string, actor: Actor) {
  const updated = await Order.findByIdAndUpdate(
    orderId,
    { $push: { internalNotes: { note, at: new Date(), by: actor } } },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) throw notFound('Order');
  return updated;
}

export async function clearAttention(orderId: string, actor: Actor) {
  const updated = await Order.findByIdAndUpdate(
    orderId,
    { $set: { attention: null }, $push: { internalNotes: { note: 'Attention flag cleared', at: new Date(), by: actor } } },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) throw notFound('Order');
  return updated;
}

export async function requestReturn(order: LeanOrder, reason: string, actor: Actor) {
  const settings = await getSettings();
  const deliveredAt = order.shipment?.deliveredAt;
  const days = settings.returns.windowDays;
  if (order.status !== 'delivered' || !deliveredAt) throw conflict('Returns can be requested only for delivered orders.', 'INVALID_TRANSITION');
  if (days <= 0 || Date.now() - new Date(deliveredAt).getTime() > days * 86400_000) {
    throw conflict(`The ${days}-day return window for this order has closed.`, 'RETURN_WINDOW_CLOSED');
  }
  const now = new Date();
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: 'delivered' },
    {
      $set: { status: 'return_requested', returnRequest: { reason, requestedAt: now } },
      $push: { timeline: { status: 'return_requested', at: now, actor, note: 'Return requested' } },
    },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) throw conflict('The order was updated. Please reload.', 'ORDER_CHANGED');
  return updated;
}

export async function resolveReturn(orderId: string, input: { approve: boolean; restock: boolean; note?: string }, actor: Actor) {
  const now = new Date();
  return runInTransaction(async (session) => {
    const current = await Order.findById(orderId).session(session).lean();
    if (!current) throw notFound('Order');
    if (current.status !== 'return_requested') throw conflict('This order has no open return request.', 'INVALID_TRANSITION');
    const to: OrderStatus = input.approve ? 'returned' : 'delivered';
    const paidOutstanding = current.payment.amountPaid - current.payment.amountRefunded > 0;
    const updated = await Order.findOneAndUpdate(
      { _id: current._id, status: 'return_requested' },
      {
        $set: {
          status: to,
          'returnRequest.resolvedAt': now,
          'returnRequest.resolution': input.approve ? 'approved' : 'rejected',
          ...(input.approve && paidOutstanding ? { attention: { reason: 'Refund required — return received.', at: now } } : {}),
        },
        $push: {
          timeline: {
            status: to,
            at: now,
            actor,
            note: input.note ?? (input.approve ? 'Return received' : 'Return request declined'),
          },
        },
      },
      { session, returnDocument: 'after' },
    ).lean();
    if (!updated) throw conflict('The order was updated. Please reload.', 'ORDER_CHANGED');
    if (input.approve && input.restock) await releaseOrderInventory(current._id, 'return_restock', actor, session);
    return updated;
  });
}

/** COD cash collection is confirmed manually by staff once the courier remits it. */
export async function recordCodCollected(orderId: string, actor: Actor, reference?: string) {
  const now = new Date();
  const result = await runInTransaction(async (session) => {
    const current = await Order.findOne({ _id: orderId }).session(session).lean();
    if (!current) throw notFound('Order');
    const updated = await Order.findOneAndUpdate(
      {
        _id: current._id,
        'payment.method': 'cod',
        'payment.status': 'cod_pending',
        status: { $in: ['shipped', 'out_for_delivery', 'delivered'] },
      },
      {
        $set: { 'payment.status': 'paid', 'payment.paidAt': now, 'payment.amountPaid': current.pricing.total },
        $push: { internalNotes: { note: `COD payment recorded${reference ? ` (ref: ${reference})` : ''}`, at: now, by: actor } },
      },
      { session, returnDocument: 'after' },
    ).lean();
    if (!updated) throw conflict('COD payment can be recorded only for shipped/delivered COD orders that are not yet paid.', 'INVALID_STATE');
    await PaymentTransaction.create(
      [
        {
          order: current._id,
          provider: 'cod',
          type: 'payment',
          amount: current.pricing.total,
          status: 'recorded',
          method: 'cod',
          verifiedVia: ['manual'],
          reference: reference ?? null,
          createdBy: actor.id ?? null,
        },
      ],
      { session: session ?? undefined },
    );
    return updated;
  });
  return result;
}

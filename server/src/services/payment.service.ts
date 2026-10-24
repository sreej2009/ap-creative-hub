import type { Types } from 'mongoose';
import { env } from '../config/env.js';
import {
  getPaymentGateway,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  type GatewayPayment,
  type GatewayRefund,
} from '../integrations/razorpay.js';
import { AppError, badGateway, badRequest, conflict, isDuplicateKeyError, notFound, serviceUnavailable, unprocessable } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { REFUNDABLE_STATUSES, refundableAmount } from '../lib/orderStatus.js';
import { runInTransaction } from '../lib/transaction.js';
import { sha256 } from '../lib/util.js';
import { Order, type Actor } from '../models/Order.js';
import { PaymentTransaction, WebhookEvent } from '../models/PaymentTransaction.js';
import { SYSTEM_ACTOR } from './fulfilment.service.js';
import { reserveStock, restoreStock } from './inventory.service.js';
import { notifications } from './notification.service.js';
import { adjustSoldCount, stockLines, type LeanOrder } from './order-helpers.js';

const CURRENCY = 'INR';

function requireGateway() {
  const gateway = getPaymentGateway();
  if (!gateway) {
    throw serviceUnavailable('Online payment is not configured yet. Please choose Cash on Delivery or contact us.', 'PAYMENT_NOT_CONFIGURED');
  }
  return gateway;
}

/** Options the browser needs to open Razorpay Checkout. Contains only the public key id. */
export function checkoutPayload(order: LeanOrder) {
  const gateway = requireGateway();
  return {
    provider: 'razorpay' as const,
    keyId: gateway.keyId,
    mode: gateway.mode,
    razorpayOrderId: order.payment.razorpayOrderId!,
    amount: order.pricing.total,
    currency: CURRENCY,
    name: env.STORE_NAME,
    description: `Order ${order.orderNumber}`,
    prefill: { name: order.customer.name, email: order.customer.email, contact: order.customer.phone },
    expiresAt: order.reservationExpiresAt,
  };
}

/** Creates the Razorpay order for a freshly placed online order. */
export async function initiateOnlinePayment(order: LeanOrder) {
  const gateway = requireGateway();
  const rzOrder = await gateway.createOrder({
    amount: order.pricing.total,
    currency: CURRENCY,
    receipt: order.orderNumber,
    notes: { orderId: String(order._id), orderNumber: order.orderNumber },
  });
  if (rzOrder.amount !== order.pricing.total || rzOrder.currency !== CURRENCY) {
    throw badGateway('Payment provider returned an unexpected amount.');
  }
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: 'pending_payment' },
    { $set: { 'payment.razorpayOrderId': rzOrder.id } },
    { returnDocument: 'after' },
  ).lean();
  await PaymentTransaction.create({
    order: order._id,
    provider: 'razorpay',
    type: 'payment',
    providerOrderId: rzOrder.id,
    amount: rzOrder.amount,
    currency: rzOrder.currency,
    status: 'created',
  });
  return updated!;
}

async function upsertPaymentTxn(orderId: Types.ObjectId, payment: GatewayPayment, via: string) {
  const status = payment.status === 'captured' ? 'captured' : payment.status === 'authorized' ? 'authorized' : payment.status === 'failed' ? 'failed' : 'created';
  try {
    await PaymentTransaction.findOneAndUpdate(
      { type: 'payment', providerPaymentId: payment.id },
      {
        $set: {
          order: orderId,
          provider: 'razorpay',
          providerOrderId: payment.order_id,
          amount: payment.amount,
          currency: payment.currency,
          status,
          method: payment.method ?? null,
          errorCode: payment.error_code ?? null,
          errorDescription: payment.error_description ?? null,
        },
        $addToSet: { verifiedVia: via },
      },
      { upsert: true },
    );
  } catch (err) {
    // A concurrent upsert for the same payment id raced us; the other write wins.
    if (!isDuplicateKeyError(err)) throw err;
  }
}

export type MarkPaidResult = 'confirmed' | 'already_paid' | 'reinstated' | 'needs_refund' | 'duplicate_payment';

/**
 * Marks an order paid after the payment was verified server-side (API fetch
 * or signed webhook). Safe to call repeatedly: the status precondition makes
 * the transition happen once, and stock is never decremented here (it was
 * reserved when the order was created).
 */
export async function markOrderPaid(order: LeanOrder, payment: GatewayPayment, via: string): Promise<MarkPaidResult> {
  if (payment.status !== 'captured') throw conflict('Payment has not been captured yet.', 'PAYMENT_NOT_CAPTURED');
  if (payment.order_id !== order.payment.razorpayOrderId) throw badRequest('Payment does not belong to this order.', undefined, 'PAYMENT_MISMATCH');
  if (payment.amount !== order.pricing.total || payment.currency !== CURRENCY) {
    logger.error({ orderNumber: order.orderNumber, paid: payment.amount, expected: order.pricing.total }, 'payment amount mismatch');
    await Order.updateOne({ _id: order._id }, { $set: { attention: { reason: `Payment amount mismatch (${payment.amount} vs ${order.pricing.total}). Investigate before fulfilling.`, at: new Date() } } });
    throw badRequest('Payment amount does not match the order total.', undefined, 'AMOUNT_MISMATCH');
  }
  await upsertPaymentTxn(order._id, payment, via);
  const now = new Date();

  const confirmed = await runInTransaction(async (session) => {
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: 'pending_payment', 'payment.status': 'awaiting_payment', inventoryState: 'reserved' },
      {
        $set: {
          status: 'payment_confirmed',
          'payment.status': 'paid',
          'payment.razorpayPaymentId': payment.id,
          'payment.paidAt': now,
          'payment.amountPaid': payment.amount,
          inventoryState: 'committed',
          reservationExpiresAt: null,
        },
        $push: { timeline: { status: 'payment_confirmed', at: now, actor: SYSTEM_ACTOR, note: 'Payment received' } },
      },
      { session, returnDocument: 'after' },
    ).lean();
    if (!updated) return false;
    await adjustSoldCount(updated, 1, session);
    return true;
  });
  if (confirmed) {
    notifications.orderEvent('payment_confirmation', order._id);
    return 'confirmed';
  }

  const current = await Order.findById(order._id).lean();
  if (!current) throw notFound('Order');
  if (current.payment.razorpayPaymentId === payment.id) return 'already_paid';
  if (current.payment.razorpayPaymentId && current.payment.razorpayPaymentId !== payment.id) {
    await Order.updateOne(
      { _id: current._id },
      { $set: { attention: { reason: `A second payment (${payment.id}) was received for this order. Refund the duplicate in Razorpay.`, at: now } } },
    );
    return 'duplicate_payment';
  }
  if (current.status === 'cancelled' && ['failed', 'void'].includes(current.payment.status)) {
    // Only orders the system expired are reinstated. If the customer or staff
    // cancelled deliberately, keep it cancelled and flag the payment for refund.
    if (current.cancellation?.by?.type === 'system') return handleLatePayment(current, payment);
    await Order.updateOne(
      { _id: current._id, status: 'cancelled' },
      {
        $set: {
          'payment.status': 'paid',
          'payment.razorpayPaymentId': payment.id,
          'payment.paidAt': now,
          'payment.amountPaid': payment.amount,
          attention: { reason: 'Payment received for an order that had already been cancelled. Refund required.', at: now },
        },
      },
    );
    return 'needs_refund';
  }
  return 'already_paid';
}

/** Payment arrived after the reservation expired: reinstate if stock allows, otherwise flag for refund. */
async function handleLatePayment(order: LeanOrder, payment: GatewayPayment): Promise<MarkPaidResult> {
  const now = new Date();
  try {
    await runInTransaction(async (session) => {
      // Re-reserve first (throws OUT_OF_STOCK, compensating itself), then claim the order.
      const lines = stockLines(order);
      await reserveStock(lines, { session, actor: SYSTEM_ACTOR, orderId: order._id, note: 'Late payment reinstatement' });
      const claimed = await Order.findOneAndUpdate(
        { _id: order._id, status: 'cancelled', inventoryState: 'released', 'payment.status': { $in: ['failed', 'void'] } },
        {
          $set: {
            status: 'payment_confirmed',
            'payment.status': 'paid',
            'payment.razorpayPaymentId': payment.id,
            'payment.paidAt': now,
            'payment.amountPaid': payment.amount,
            inventoryState: 'committed',
            cancellation: null,
          },
          $push: { timeline: { status: 'payment_confirmed', at: now, actor: SYSTEM_ACTOR, note: 'Payment received; order reinstated' } },
        },
        { session, returnDocument: 'after' },
      ).lean();
      if (!claimed) {
        if (!session) await restoreStock(lines, 'order_released', { session, actor: SYSTEM_ACTOR, orderId: order._id });
        throw conflict('Order state changed', 'ORDER_CHANGED');
      }
      await adjustSoldCount(claimed, 1, session);
    });
    notifications.orderEvent('payment_confirmation', order._id);
    return 'reinstated';
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    await Order.updateOne(
      { _id: order._id, status: 'cancelled' },
      {
        $set: {
          'payment.status': 'paid',
          'payment.razorpayPaymentId': payment.id,
          'payment.paidAt': now,
          'payment.amountPaid': payment.amount,
          attention: { reason: 'Payment received after the order expired and stock is no longer available. Refund required.', at: now },
        },
      },
    );
    return 'needs_refund';
  }
}

/** Ensure the payment is captured (capture authorised payments when auto-capture is off). */
async function ensureCaptured(payment: GatewayPayment, expectedAmount: number) {
  if (payment.status === 'captured') return payment;
  if (payment.status !== 'authorized') return payment;
  const gateway = requireGateway();
  try {
    return await gateway.capturePayment(payment.id, expectedAmount, CURRENCY);
  } catch (err) {
    // Another path (webhook vs. browser) may have captured it already.
    const fresh = await gateway.fetchPayment(payment.id);
    if (fresh.status === 'captured') return fresh;
    throw err;
  }
}

/**
 * Browser callback after Razorpay Checkout. The signature proves the
 * payment id belongs to our Razorpay order; the payment status and amount
 * are then confirmed by fetching the payment from Razorpay's API. The
 * frontend's word alone never marks an order paid.
 */
export async function verifyCheckoutPayment(input: {
  orderNumber: string;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}) {
  const gateway = requireGateway();
  const order = await Order.findOne({ orderNumber: input.orderNumber }).lean();
  if (!order || order.payment.method !== 'razorpay') throw notFound('Order');
  if (order.payment.razorpayOrderId !== input.razorpay_order_id) {
    throw badRequest('Payment does not belong to this order.', undefined, 'PAYMENT_MISMATCH');
  }
  if (!verifyCheckoutSignature(input.razorpay_order_id, input.razorpay_payment_id, input.razorpay_signature)) {
    logger.warn({ orderNumber: order.orderNumber }, 'invalid Razorpay checkout signature');
    throw badRequest('Payment verification failed.', undefined, 'SIGNATURE_INVALID');
  }
  let payment: GatewayPayment;
  try {
    payment = await ensureCaptured(await gateway.fetchPayment(input.razorpay_payment_id), order.pricing.total);
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'could not fetch payment from Razorpay');
    throw badGateway('We could not confirm your payment with the provider yet. If money was debited, your order will update automatically.', 'PAYMENT_LOOKUP_FAILED');
  }
  if (payment.status !== 'captured') {
    await upsertPaymentTxn(order._id, payment, 'api');
    throw conflict('Your payment is still being processed. We will update your order as soon as it is confirmed.', 'PAYMENT_PENDING');
  }
  const result = await markOrderPaid(order, payment, 'signature+api');
  const fresh = await Order.findById(order._id).lean();
  return { result, status: fresh!.status, paymentStatus: fresh!.payment.status };
}

/** Lets a customer reopen checkout for an unpaid order while its reservation is still valid. */
export async function retryPayment(order: LeanOrder) {
  if (order.status !== 'pending_payment' || order.payment.method !== 'razorpay') {
    throw conflict('This order is not awaiting payment.', 'NOT_AWAITING_PAYMENT');
  }
  if (!order.reservationExpiresAt || order.reservationExpiresAt <= new Date()) {
    throw conflict('The payment window for this order has expired. Please place a new order.', 'PAYMENT_WINDOW_EXPIRED');
  }
  if (!order.payment.razorpayOrderId) throw conflict('Payment was not initialised for this order.', 'PAYMENT_NOT_INITIALISED');
  return checkoutPayload(order);
}

/**
 * Before expiring an unpaid order, ask Razorpay whether a payment actually
 * succeeded (covers missed webhooks and closed browser tabs).
 */
export async function reconcilePendingOrder(order: LeanOrder): Promise<boolean> {
  const gateway = getPaymentGateway();
  if (!gateway || !order.payment.razorpayOrderId) return false;
  try {
    const payments = await gateway.fetchOrderPayments(order.payment.razorpayOrderId);
    for (const p of payments) {
      if (p.status === 'captured' || p.status === 'authorized') {
        const captured = await ensureCaptured(p, order.pricing.total);
        if (captured.status === 'captured') {
          await markOrderPaid(order, captured, 'reconciliation');
          return true;
        }
      }
    }
  } catch (err) {
    logger.warn({ orderNumber: order.orderNumber, err: (err as Error).message }, 'reconciliation lookup failed');
    // Be conservative: if we cannot confirm, do not expire yet — try again next run.
    throw err;
  }
  return false;
}

/* ------------------------------- Webhooks ------------------------------ */

interface RazorpayWebhook {
  event: string;
  payload: {
    payment?: { entity: GatewayPayment };
    order?: { entity: { id: string } };
    refund?: { entity: GatewayRefund };
  };
}

export async function handleRazorpayWebhook(rawBody: Buffer | undefined, signature: string | undefined, eventIdHeader: string | undefined) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) throw serviceUnavailable('Webhook secret not configured.', 'WEBHOOK_NOT_CONFIGURED');
  if (!rawBody || !verifyWebhookSignature(rawBody, signature)) {
    throw badRequest('Invalid webhook signature.', undefined, 'SIGNATURE_INVALID');
  }
  let body: RazorpayWebhook;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw badRequest('Invalid webhook payload.');
  }
  const eventId = eventIdHeader?.slice(0, 100) || sha256(rawBody.toString('utf8'));

  // Idempotency: each provider event id is processed once. Failed events may be retried.
  try {
    await WebhookEvent.create({ provider: 'razorpay', eventId, event: body.event, status: 'processing' });
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    const reclaimed = await WebhookEvent.findOneAndUpdate(
      { provider: 'razorpay', eventId, status: 'failed' },
      { $set: { status: 'processing' } },
    );
    if (!reclaimed) return { duplicate: true, event: body.event };
  }

  try {
    const outcome = await processWebhookEvent(body);
    await WebhookEvent.updateOne({ provider: 'razorpay', eventId }, { $set: { status: outcome, processedAt: new Date() } });
    return { duplicate: false, event: body.event, outcome };
  } catch (err) {
    await WebhookEvent.updateOne(
      { provider: 'razorpay', eventId },
      { $set: { status: 'failed', error: (err as Error).message?.slice(0, 300) } },
    );
    throw err;
  }
}

async function processWebhookEvent(body: RazorpayWebhook): Promise<'processed' | 'ignored'> {
  switch (body.event) {
    case 'payment.captured':
    case 'payment.authorized':
    case 'order.paid': {
      const payment = body.payload.payment?.entity;
      if (!payment?.order_id) return 'ignored';
      const order = await Order.findOne({ 'payment.razorpayOrderId': payment.order_id }).lean();
      if (!order) {
        logger.warn({ razorpayOrderId: payment.order_id }, 'webhook for unknown order');
        return 'ignored';
      }
      const captured = await ensureCaptured(payment, order.pricing.total);
      if (captured.status !== 'captured') return 'ignored';
      await markOrderPaid(order, captured, 'webhook');
      return 'processed';
    }
    case 'payment.failed': {
      const payment = body.payload.payment?.entity;
      if (!payment?.order_id) return 'ignored';
      const order = await Order.findOne({ 'payment.razorpayOrderId': payment.order_id }).select('_id').lean();
      if (!order) return 'ignored';
      // Record the failed attempt; the customer may retry until the reservation expires.
      await upsertPaymentTxn(order._id, payment, 'webhook');
      return 'processed';
    }
    case 'refund.processed':
    case 'refund.failed': {
      const refund = body.payload.refund?.entity;
      if (!refund) return 'ignored';
      let txn = await PaymentTransaction.findOne({ providerRefundId: refund.id }).lean();
      if (!txn) {
        // Refund issued outside the admin panel (e.g. Razorpay dashboard): record it so the ledger stays accurate.
        const order = await Order.findOne({ 'payment.razorpayPaymentId': refund.payment_id }).lean();
        if (!order) return 'ignored';
        try {
          txn = (
            await PaymentTransaction.create({
              order: order._id,
              provider: 'razorpay',
              type: 'refund',
              providerPaymentId: refund.payment_id,
              providerRefundId: refund.id,
              amount: refund.amount,
              currency: CURRENCY,
              status: 'pending',
              verifiedVia: ['webhook'],
              reference: 'Issued outside the admin panel',
            })
          ).toObject();
        } catch (err) {
          if (!isDuplicateKeyError(err)) throw err;
          txn = await PaymentTransaction.findOne({ providerRefundId: refund.id }).lean();
          if (!txn) return 'ignored';
        }
        await Order.updateOne(
          { _id: order._id },
          {
            $inc: { 'payment.refundReserved': refund.amount },
            $set: { attention: { reason: `Refund ${refund.id} was issued directly in Razorpay. Review the order.`, at: new Date() } },
          },
        );
      }
      await finalizeRefund(txn._id, body.event === 'refund.processed' ? 'processed' : 'failed');
      return 'processed';
    }
    default:
      return 'ignored';
  }
}

/* -------------------------------- Refunds ------------------------------ */

/** Applies a refund outcome exactly once (pending → processed/failed). */
export async function finalizeRefund(txnId: Types.ObjectId, outcome: 'processed' | 'failed') {
  const txn = await PaymentTransaction.findOneAndUpdate(
    { _id: txnId, type: 'refund', status: 'pending' },
    { $set: { status: outcome } },
    { returnDocument: 'after' },
  ).lean();
  if (!txn) return false;
  const now = new Date();
  if (outcome === 'failed') {
    await Order.updateOne(
      { _id: txn.order },
      {
        $inc: { 'payment.refundReserved': -txn.amount },
        $set: { attention: { reason: 'A refund failed at the payment provider. Review in Razorpay.', at: now } },
      },
    );
    await recomputeRefundStatus(txn.order);
    return true;
  }
  await Order.updateOne(
    { _id: txn.order },
    { $inc: { 'payment.refundReserved': -txn.amount, 'payment.amountRefunded': txn.amount } },
  );
  await recomputeRefundStatus(txn.order, true);
  return true;
}

async function recomputeRefundStatus(orderId: Types.ObjectId, notifyIfRefunded = false) {
  const order = await Order.findById(orderId).lean();
  if (!order) return;
  const { amountPaid, amountRefunded, refundReserved } = order.payment;
  let status = order.payment.status;
  if (amountRefunded >= amountPaid && amountPaid > 0) status = 'refunded';
  else if (refundReserved > 0) status = 'refund_pending';
  else if (amountRefunded > 0) status = 'partially_refunded';
  else status = 'paid';

  const set: Record<string, unknown> = { 'payment.status': status };
  const push: Record<string, unknown> = {};
  const fully = status === 'refunded';
  if (fully && REFUNDABLE_STATUSES.includes(order.status)) {
    set.status = 'refunded';
    set.attention = null;
    push.timeline = { status: 'refunded', at: new Date(), actor: SYSTEM_ACTOR, note: 'Refund processed' };
  }
  await Order.updateOne({ _id: order._id }, { $set: set, ...(push.timeline ? { $push: push } : {}) });
  if (notifyIfRefunded && (fully || status === 'partially_refunded')) notifications.orderEvent('refund', order._id);
}

async function reserveRefundAmount(orderId: Types.ObjectId, amount: number) {
  const reserved = await Order.findOneAndUpdate(
    {
      _id: orderId,
      'payment.status': { $in: ['paid', 'partially_refunded', 'refund_pending'] },
      status: { $in: REFUNDABLE_STATUSES },
      $expr: {
        $lte: [{ $add: ['$payment.amountRefunded', '$payment.refundReserved', amount] }, '$payment.amountPaid'],
      },
    },
    { $inc: { 'payment.refundReserved': amount } },
    { returnDocument: 'after' },
  ).lean();
  if (!reserved) throw conflict('Refund amount exceeds what can still be refunded.', 'REFUND_NOT_ALLOWED');
  return reserved;
}

/** Refund through Razorpay. Only cancelled or returned orders with a verified payment qualify. */
export async function refundOrder(orderId: string, input: { amount?: number; reason: string }, actor: Actor) {
  const order = await Order.findById(orderId).lean();
  if (!order) throw notFound('Order');
  if (order.payment.method !== 'razorpay' || !order.payment.razorpayPaymentId) {
    throw unprocessable('Only verified online payments can be refunded through Razorpay.', 'REFUND_NOT_ALLOWED');
  }
  if (!REFUNDABLE_STATUSES.includes(order.status)) {
    throw conflict('Refunds are available only for cancelled or returned orders.', 'REFUND_NOT_ALLOWED');
  }
  const amount = input.amount ?? refundableAmount(order);
  if (amount <= 0) throw conflict('Nothing left to refund on this order.', 'REFUND_NOT_ALLOWED');
  const gateway = requireGateway();
  await reserveRefundAmount(order._id, amount);

  let refund: GatewayRefund;
  try {
    refund = await gateway.refundPayment(order.payment.razorpayPaymentId, {
      amount,
      notes: { orderNumber: order.orderNumber, reason: input.reason.slice(0, 200) },
    });
  } catch (err) {
    await Order.updateOne({ _id: order._id }, { $inc: { 'payment.refundReserved': -amount } });
    logger.error({ orderNumber: order.orderNumber, err: (err as Error).message }, 'refund request failed');
    throw badGateway('Razorpay rejected the refund request. No money was moved.', 'REFUND_FAILED');
  }
  const txn = await PaymentTransaction.create({
    order: order._id,
    provider: 'razorpay',
    type: 'refund',
    providerPaymentId: order.payment.razorpayPaymentId,
    providerRefundId: refund.id,
    amount,
    currency: CURRENCY,
    status: 'pending',
    verifiedVia: ['api'],
    reference: input.reason,
    createdBy: actor.id ?? null,
  });
  await Order.updateOne(
    { _id: order._id },
    { $push: { internalNotes: { note: `Refund ${refund.id} requested for ₹${(amount / 100).toFixed(2)}: ${input.reason}`, at: new Date(), by: actor } } },
  );
  if (refund.status === 'processed') await finalizeRefund(txn._id, 'processed');
  else if (refund.status === 'failed') await finalizeRefund(txn._id, 'failed');
  else await recomputeRefundStatus(order._id);
  return { refundId: refund.id, status: refund.status, amount };
}

/**
 * COD orders are refunded outside the system (cash, UPI or bank transfer).
 * Staff record the refund with a reference; it is labelled as manual.
 */
export async function recordManualRefund(orderId: string, input: { amount: number; reference: string }, actor: Actor) {
  const order = await Order.findById(orderId).lean();
  if (!order) throw notFound('Order');
  if (order.payment.method !== 'cod') throw unprocessable('Online payments must be refunded through Razorpay.', 'REFUND_NOT_ALLOWED');
  await reserveRefundAmount(order._id, input.amount);
  const txn = await PaymentTransaction.create({
    order: order._id,
    provider: 'manual',
    type: 'refund',
    amount: input.amount,
    currency: CURRENCY,
    status: 'pending',
    verifiedVia: ['manual'],
    reference: input.reference,
    createdBy: actor.id ?? null,
  });
  await Order.updateOne(
    { _id: order._id },
    { $push: { internalNotes: { note: `Manual refund recorded ₹${(input.amount / 100).toFixed(2)} (ref: ${input.reference})`, at: new Date(), by: actor } } },
  );
  await finalizeRefund(txn._id, 'processed');
  return { status: 'processed', amount: input.amount };
}

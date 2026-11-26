import type { Types } from 'mongoose';
import { conflict, notFound } from '../lib/errors.js';
import { formatINR } from '../lib/util.js';
import { runInTransaction } from '../lib/transaction.js';
import { Order, type Actor } from '../models/Order.js';
import { PaymentTransaction } from '../models/PaymentTransaction.js';
import { cancelOrder } from './fulfilment.service.js';
import { notifications } from './notification.service.js';
import { adjustSoldCount, type LeanOrder } from './order-helpers.js';

/**
 * Manual UPI payments ("scan the QR, then tell us the transaction ID").
 *
 * No payment provider confirms these, so the customer's submission never
 * marks an order paid on its own. It moves the order to
 * `verification_pending` and flags it for staff, who check their bank / UPI
 * app for the amount and UTR and then confirm or reject it.
 */

export async function submitUpiPayment(
  order: LeanOrder,
  input: { payerName: string; payerUpiId: string; utr: string },
  actor: Actor,
) {
  if (order.payment.method !== 'upi') throw conflict('This order is not a UPI order.', 'NOT_UPI_ORDER');
  if (order.payment.status === 'verification_pending') {
    throw conflict('We already have your payment details and are verifying them.', 'ALREADY_SUBMITTED');
  }
  if (order.status !== 'pending_payment' || order.payment.status !== 'awaiting_payment') {
    throw conflict('This order is not awaiting payment.', 'NOT_AWAITING_PAYMENT');
  }
  if (!order.reservationExpiresAt || order.reservationExpiresAt <= new Date()) {
    throw conflict(
      'The payment window for this order has closed. If you already paid, message us on WhatsApp with your order number and transaction ID.',
      'PAYMENT_WINDOW_EXPIRED',
    );
  }
  // One UPI transaction can only pay for one order.
  if (await Order.exists({ _id: { $ne: order._id }, 'payment.upi.utr': input.utr })) {
    throw conflict('This transaction ID was already used for another order. Please check the number on your receipt.', 'UTR_ALREADY_USED');
  }

  const now = new Date();
  const amount = formatINR(order.pricing.total);
  const updated = await Order.findOneAndUpdate(
    {
      _id: order._id,
      status: 'pending_payment',
      'payment.method': 'upi',
      'payment.status': 'awaiting_payment',
      reservationExpiresAt: { $gt: now },
    },
    {
      $set: {
        'payment.status': 'verification_pending',
        'payment.upi': { ...input, submittedAt: now },
        // Keep the stock held until staff decide; the expiry job ignores orders without a deadline.
        reservationExpiresAt: null,
        attention: {
          reason: `UPI payment to verify: check your bank app for ${amount} from ${input.payerName} (${input.payerUpiId}), UTR ${input.utr}. Then confirm or reject it.`,
          at: now,
        },
      },
      $push: { timeline: { status: 'pending_payment', at: now, actor, note: 'Payment details submitted — we’re verifying your payment' } },
    },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) throw conflict('The order was updated. Please reload the page.', 'ORDER_CHANGED');
  notifications.upiPaymentSubmitted(updated);
  return updated;
}

/** Staff saw the money in their account: mark the order paid and commit the reserved stock. */
export async function confirmUpiPayment(orderId: string | Types.ObjectId, actor: Actor) {
  const now = new Date();
  const confirmed = await runInTransaction(async (session) => {
    const current = await Order.findById(orderId).session(session).lean();
    if (!current) throw notFound('Order');
    const updated = await Order.findOneAndUpdate(
      {
        _id: current._id,
        status: 'pending_payment',
        'payment.method': 'upi',
        'payment.status': 'verification_pending',
        inventoryState: 'reserved',
      },
      {
        $set: {
          status: 'payment_confirmed',
          'payment.status': 'paid',
          'payment.paidAt': now,
          'payment.amountPaid': current.pricing.total,
          inventoryState: 'committed',
          reservationExpiresAt: null,
          attention: null,
        },
        $push: {
          timeline: { status: 'payment_confirmed', at: now, actor, note: 'Payment received' },
          internalNotes: { note: `UPI payment verified (UTR ${current.payment.upi?.utr ?? '—'})`, at: now, by: actor },
        },
      },
      { session, returnDocument: 'after' },
    ).lean();
    if (!updated) throw conflict('Only UPI orders waiting for verification can be confirmed. Please reload.', 'INVALID_STATE');
    await adjustSoldCount(updated, 1, session);
    await PaymentTransaction.create(
      [
        {
          order: current._id,
          provider: 'upi',
          type: 'payment',
          amount: current.pricing.total,
          status: 'recorded',
          method: 'upi',
          verifiedVia: ['manual'],
          reference: `UTR ${current.payment.upi?.utr ?? ''} · ${current.payment.upi?.payerName ?? ''} (${current.payment.upi?.payerUpiId ?? ''})`.slice(0, 200),
          createdBy: actor.id ?? null,
        },
      ],
      { session: session ?? undefined },
    );
    return updated;
  });
  notifications.orderEvent('payment_confirmation', confirmed._id);
  return confirmed;
}

/** The payment could not be found: cancel the order and release the held stock. */
export async function rejectUpiPayment(orderId: string | Types.ObjectId, reason: string, actor: Actor) {
  const order = await Order.findById(orderId).lean();
  if (!order) throw notFound('Order');
  if (order.payment.method !== 'upi' || order.payment.status !== 'verification_pending' || order.status !== 'pending_payment') {
    throw conflict('Only UPI orders waiting for verification can be rejected. Please reload.', 'INVALID_STATE');
  }
  return cancelOrder(order._id, actor, `We couldn’t verify your UPI payment: ${reason}`, { allowedFrom: ['pending_payment'] });
}

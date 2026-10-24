import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { Order } from '../models/Order.js';
import { cancelOrder, SYSTEM_ACTOR } from '../services/fulfilment.service.js';
import { cleanupOrphanedMedia } from '../services/media.service.js';
import { reconcilePendingOrder } from '../services/payment.service.js';

/**
 * Releases stock held by unpaid online orders whose reservation window has
 * passed. Before cancelling, Razorpay is asked whether a payment succeeded
 * (covering missed webhooks). Safe to run concurrently on several instances:
 * every state change is a conditional update.
 */
export async function expireStaleOrders(now = new Date()) {
  const stale = await Order.find({ status: 'pending_payment', reservationExpiresAt: { $lte: now } })
    .sort({ reservationExpiresAt: 1 })
    .limit(50)
    .lean();
  let expired = 0;
  for (const order of stale) {
    try {
      if (await reconcilePendingOrder(order)) continue;
    } catch {
      continue; // provider unreachable: keep the reservation and retry next run
    }
    try {
      await cancelOrder(order._id, SYSTEM_ACTOR, 'Payment was not completed in time', { allowedFrom: ['pending_payment'] });
      expired++;
    } catch (err) {
      if (err instanceof AppError && ['INVALID_TRANSITION', 'ORDER_CHANGED'].includes(err.code)) continue;
      logger.error({ err, orderNumber: order.orderNumber }, 'failed to expire order');
    }
  }
  if (expired) logger.info({ expired }, 'expired unpaid orders and released stock');
  return expired;
}

export function startJobs() {
  let running = false;
  const expiry = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await expireStaleOrders();
    } catch (err) {
      logger.error({ err }, 'reservation expiry job failed');
    } finally {
      running = false;
    }
  }, 60_000);

  const media = setInterval(() => {
    cleanupOrphanedMedia().catch((err) => logger.error({ err }, 'media cleanup failed'));
  }, 6 * 3600_000);

  expiry.unref();
  media.unref();
  return () => {
    clearInterval(expiry);
    clearInterval(media);
  };
}

import { Types, type HydratedDocument } from 'mongoose';
import { env } from '../config/env.js';
import { getPaymentGateway } from '../integrations/razorpay.js';
import { AppError, badGateway, conflict, isDuplicateKeyError, serviceUnavailable, unprocessable } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { trackingToken } from '../lib/tracking.js';
import { runInTransaction } from '../lib/transaction.js';
import { generateOrderNumber, randomToken } from '../lib/util.js';
import { Coupon } from '../models/Coupon.js';
import { Order, type Actor } from '../models/Order.js';
import { User, type IUser } from '../models/User.js';
import type { CheckoutInput } from '../schemas/index.js';
import { quoteCart } from './cart.service.js';
import { claimCoupon, unclaimCoupon } from './coupon.service.js';
import { cancelOrder, SYSTEM_ACTOR } from './fulfilment.service.js';
import { reserveStock, restoreStock, type StockLine } from './inventory.service.js';
import { notifications } from './notification.service.js';
import { adjustSoldCount, toCustomerOrder, type LeanOrder } from './order-helpers.js';
import { checkoutPayload, initiateOnlinePayment } from './payment.service.js';
import { getSettings } from './settings.service.js';

async function placedResponse(order: LeanOrder & { trackingSalt: string }) {
  const settings = await getSettings();
  return {
    order: toCustomerOrder(order, settings.returns.windowDays),
    trackingToken: trackingToken(String(order._id), order.trackingSalt),
    payment: order.payment.method === 'razorpay' && order.status === 'pending_payment' ? checkoutPayload(order) : null,
  };
}

async function findByIdempotencyKey(key: string, email: string) {
  const existing = await Order.findOne({ idempotencyKey: key }).select('+trackingSalt').lean();
  if (!existing) return null;
  if (existing.customer.email !== email) throw conflict('This checkout request was already used.', 'IDEMPOTENCY_CONFLICT');
  return existing;
}

/**
 * Places an order:
 *   1. re-prices the cart from the database (client totals are ignored),
 *   2. atomically reserves stock and claims the coupon in one transaction,
 *   3. for online payment, creates the Razorpay order (outside the transaction).
 * Stock is held for RESERVATION_MINUTES for unpaid online orders and released
 * by the expiry job if payment never arrives.
 */
export async function placeOrder(input: CheckoutInput, user: HydratedDocument<IUser> | null | undefined) {
  // Signed-in customers always use their account email so order history and coupon limits line up.
  const email = user ? user.email : input.customer.email;

  const replay = await findByIdempotencyKey(input.idempotencyKey, email);
  if (replay) return placedResponse(replay);

  const quote = await quoteCart({
    items: input.items,
    couponCode: input.couponCode,
    paymentMethod: input.paymentMethod,
    email,
    phone: input.customer.phone,
  });
  if (quote.hasIssues || quote.lines.length === 0) {
    throw conflict('Some items in your cart have changed. Please review your cart.', 'CART_CHANGED', { quote });
  }
  if (input.couponCode && quote.coupon && !quote.coupon.valid) {
    throw new AppError(422, quote.coupon.reason, quote.coupon.message);
  }
  if (input.expectedTotal !== undefined && input.expectedTotal !== quote.total) {
    throw conflict('Prices have changed since you loaded checkout. Please review the updated total.', 'PRICE_CHANGED', { quote });
  }
  if (input.paymentMethod === 'razorpay' && !getPaymentGateway()) {
    throw serviceUnavailable('Online payment is not configured yet. Please choose Cash on Delivery.', 'PAYMENT_NOT_CONFIGURED');
  }
  if (input.paymentMethod === 'cod' && !quote.paymentMethods.cod.available) {
    throw unprocessable(quote.paymentMethods.cod.reason ?? 'Cash on Delivery is unavailable.', 'COD_UNAVAILABLE');
  }

  const isCod = input.paymentMethod === 'cod';
  const actor: Actor = user
    ? { type: 'customer', id: user._id, name: user.name }
    : { type: 'customer', id: null, name: input.customer.name };
  const lines: StockLine[] = quote.lines.map((l) => ({
    productId: new Types.ObjectId(l.productId),
    variantId: l.variantId ? new Types.ObjectId(l.variantId) : null,
    quantity: l.quantity,
    sku: l.sku,
    name: l.name,
  }));
  const couponQuote = quote.coupon?.valid ? quote.coupon : null;
  const couponDoc = couponQuote ? await Coupon.findById(couponQuote.couponId).lean() : null;

  let order: LeanOrder | null = null;
  for (let attempt = 0; attempt < 3 && !order; attempt++) {
    const orderId = new Types.ObjectId();
    const orderNumber = generateOrderNumber();
    const now = new Date();
    try {
      order = await runInTransaction(async (session) => {
        await reserveStock(lines, { session, actor, orderId });
        let couponKeys: string[] = [];
        let couponClaimed = false;
        try {
          if (couponDoc) {
            couponKeys = await claimCoupon(couponDoc, couponQuote!.usageKeys, session);
            couponClaimed = true;
          }
          const status = isCod ? 'placed' : 'pending_payment';
          const [created] = await Order.create(
            [
              {
                _id: orderId,
                orderNumber,
                user: user?._id ?? null,
                customer: { name: input.customer.name, email, phone: input.customer.phone },
                shippingAddress: { ...input.shippingAddress, country: 'IN' },
                items: quote.lines.map((l) => ({
                  product: new Types.ObjectId(l.productId),
                  variantId: l.variantId ? new Types.ObjectId(l.variantId) : null,
                  name: l.name,
                  sku: l.sku,
                  variantLabel: l.variantLabel ?? undefined,
                  image: l.image ?? undefined,
                  unitPrice: l.unitPrice,
                  compareAtPrice: l.compareAtPrice,
                  quantity: l.quantity,
                  lineTotal: l.lineTotal,
                })),
                pricing: {
                  subtotal: quote.subtotal,
                  discount: quote.discount,
                  shipping: quote.shipping,
                  codFee: quote.codFee,
                  total: quote.total,
                },
                coupon: couponDoc
                  ? { couponId: couponDoc._id, code: couponDoc.code, discount: quote.discount, usageKeys: couponKeys, released: false }
                  : null,
                payment: {
                  method: input.paymentMethod,
                  status: isCod ? 'cod_pending' : 'awaiting_payment',
                  amountPaid: 0,
                  amountRefunded: 0,
                  refundReserved: 0,
                },
                status,
                inventoryState: isCod ? 'committed' : 'reserved',
                reservationExpiresAt: isCod ? null : new Date(now.getTime() + env.RESERVATION_MINUTES * 60_000),
                timeline: [{ status, at: now, actor, note: isCod ? 'Order placed (Cash on Delivery)' : 'Order created — awaiting payment' }],
                customerNote: input.customerNote,
                whatsappOptIn: input.whatsappOptIn,
                trackingSalt: randomToken(12),
                idempotencyKey: input.idempotencyKey,
              },
            ],
            { session: session ?? undefined },
          );
          if (isCod) await adjustSoldCount(created, 1, session);
          return created.toObject() as LeanOrder;
        } catch (err) {
          if (!session) {
            // No transaction support: undo the stock reservation by hand.
            await restoreStock(lines, 'order_released', { session: null, actor: SYSTEM_ACTOR, orderId, note: 'Order creation failed' });
            if (couponClaimed) await unclaimCoupon(couponDoc!._id, couponKeys);
          }
          throw err;
        }
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        const key = Object.keys(err.keyPattern ?? {})[0];
        if (key === 'idempotencyKey') {
          const existing = await findByIdempotencyKey(input.idempotencyKey, email);
          if (existing) return placedResponse(existing);
        }
        if (key === 'orderNumber') continue; // extremely unlikely collision — retry with a new number
      }
      throw err;
    }
  }
  if (!order) throw conflict('Could not create the order. Please try again.');

  if (input.saveAddress && user) {
    await saveAddressIfNew(user._id, input.shippingAddress).catch((err) => logger.warn({ err }, 'could not save address'));
  }

  if (isCod) {
    notifications.orderEvent('order_confirmation', order._id);
  } else {
    try {
      order = await initiateOnlinePayment(order);
    } catch (err) {
      logger.error({ orderNumber: order.orderNumber, err: (err as Error).message }, 'Razorpay order creation failed');
      await cancelOrder(order._id, SYSTEM_ACTOR, 'Payment could not be initiated', { allowedFrom: ['pending_payment'], notify: false });
      if (err instanceof AppError) throw err;
      throw badGateway('We could not start the online payment. Your cart is unchanged — please try again or choose Cash on Delivery.', 'PAYMENT_INIT_FAILED');
    }
  }
  const withSalt = await Order.findById(order._id).select('+trackingSalt').lean();
  return placedResponse(withSalt!);
}

async function saveAddressIfNew(userId: Types.ObjectId, a: CheckoutInput['shippingAddress']) {
  const user = await User.findById(userId);
  if (!user) return;
  const exists = user.addresses.some(
    (x) => x.line1.toLowerCase() === a.line1.toLowerCase() && x.pincode === a.pincode && x.phone === a.phone,
  );
  if (exists || user.addresses.length >= 10) return;
  user.addresses.push({ ...a, country: 'IN', isDefault: user.addresses.length === 0 });
  await user.save();
}

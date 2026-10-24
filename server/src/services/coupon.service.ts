import type { ClientSession, Types } from 'mongoose';
import { AppError, conflict, isDuplicateKeyError, notFound } from '../lib/errors.js';
import { escapeRegex, formatINR, pageMeta, paginate } from '../lib/util.js';
import { Coupon, CouponUsage, type ICoupon } from '../models/Coupon.js';
import { Order } from '../models/Order.js';

type LeanCoupon = ICoupon & { _id: Types.ObjectId };

export const couponUsageKeys = (email?: string, phone?: string) =>
  [email ? `email:${email.toLowerCase()}` : null, phone ? `phone:${phone}` : null].filter((k): k is string => Boolean(k));

export function computeDiscount(coupon: Pick<ICoupon, 'type' | 'value' | 'maxDiscount'>, subtotal: number): number {
  let discount = coupon.type === 'percent' ? Math.floor((subtotal * coupon.value) / 100) : coupon.value;
  if (coupon.type === 'percent' && coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
  return Math.max(0, Math.min(discount, subtotal));
}

const invalid = (message: string, code = 'COUPON_INVALID') => new AppError(422, code, message);

/**
 * Validates a coupon for a given subtotal and customer. Throws a 422 with a
 * customer-friendly message when it cannot be applied.
 */
export async function evaluateCoupon(code: string, subtotal: number, keys: string[], now = new Date()) {
  const coupon = await Coupon.findOne({ code: code.trim().toUpperCase() }).lean();
  if (!coupon || !coupon.isActive) throw invalid('This coupon code is not valid.');
  if (coupon.startsAt && coupon.startsAt > now) throw invalid('This coupon is not active yet.');
  if (coupon.expiresAt && coupon.expiresAt <= now) throw invalid('This coupon has expired.', 'COUPON_EXPIRED');
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
    throw invalid('This coupon has reached its usage limit.', 'COUPON_EXHAUSTED');
  }
  if (subtotal < coupon.minOrderValue) {
    throw invalid(
      `Add ${formatINR(coupon.minOrderValue - subtotal)} more to use this coupon (minimum order ${formatINR(coupon.minOrderValue)}).`,
      'COUPON_MIN_ORDER',
    );
  }
  if (coupon.perCustomerLimit && keys.length) {
    const used = await CouponUsage.findOne({ coupon: coupon._id, key: { $in: keys }, count: { $gte: coupon.perCustomerLimit } }).lean();
    if (used) throw invalid('You have already used this coupon.', 'COUPON_ALREADY_USED');
  }
  const discount = computeDiscount(coupon, subtotal);
  if (discount <= 0) throw invalid('This coupon does not apply to your cart.');
  return { coupon, discount };
}

/**
 * Atomically records one use of the coupon. The global limit is enforced by
 * a conditional $inc; per-customer limits by conditional upserts on a unique
 * (coupon, key) index — a concurrent over-use fails with a duplicate key.
 */
export async function claimCoupon(coupon: LeanCoupon, keys: string[], session: ClientSession | null) {
  const opts = { session, returnDocument: 'after' as const };
  const limitFilter =
    coupon.usageLimit != null ? { $expr: { $lt: ['$usedCount', '$usageLimit'] } } : {};
  const claimed = await Coupon.findOneAndUpdate(
    { _id: coupon._id, isActive: true, ...limitFilter },
    { $inc: { usedCount: 1 } },
    opts,
  ).lean();
  if (!claimed) throw invalid('This coupon has just reached its usage limit.', 'COUPON_EXHAUSTED');

  const applied: string[] = [];
  try {
    if (coupon.perCustomerLimit) {
      for (const key of keys) {
        await CouponUsage.findOneAndUpdate(
          { coupon: coupon._id, key, count: { $lt: coupon.perCustomerLimit } },
          { $inc: { count: 1 } },
          { ...opts, upsert: true },
        );
        applied.push(key);
      }
    }
  } catch (err) {
    if (!session) {
      await Coupon.updateOne({ _id: coupon._id }, { $inc: { usedCount: -1 } });
      for (const key of applied) await CouponUsage.updateOne({ coupon: coupon._id, key }, { $inc: { count: -1 } });
    }
    if (isDuplicateKeyError(err)) throw invalid('You have already used this coupon.', 'COUPON_ALREADY_USED');
    throw err;
  }
  return keys;
}

/** Compensation for the non-transactional fallback when order creation fails after a claim. */
export async function unclaimCoupon(couponId: Types.ObjectId, keys: string[]) {
  await Coupon.updateOne({ _id: couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
  for (const key of keys) await CouponUsage.updateOne({ coupon: couponId, key, count: { $gt: 0 } }, { $inc: { count: -1 } });
}

/** Returns a coupon use to the pool (once per order) when an order is cancelled or expires. */
export async function releaseCouponForOrder(orderId: Types.ObjectId, session: ClientSession | null) {
  const order = await Order.findOneAndUpdate(
    { _id: orderId, 'coupon.couponId': { $exists: true }, 'coupon.released': false },
    { $set: { 'coupon.released': true } },
    { session, returnDocument: 'before' },
  ).lean();
  if (!order?.coupon) return false;
  await Coupon.updateOne({ _id: order.coupon.couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } }, { session: session ?? undefined });
  for (const key of order.coupon.usageKeys ?? []) {
    await CouponUsage.updateOne({ coupon: order.coupon.couponId, key, count: { $gt: 0 } }, { $inc: { count: -1 } }, { session: session ?? undefined });
  }
  return true;
}

/* ------------------------------- Admin -------------------------------- */

type CouponInput = Omit<ICoupon, 'usedCount' | 'createdAt' | 'updatedAt' | 'createdBy'>;

function serialize(c: LeanCoupon) {
  const now = new Date();
  const state = !c.isActive
    ? 'inactive'
    : c.expiresAt && c.expiresAt <= now
      ? 'expired'
      : c.startsAt && c.startsAt > now
        ? 'scheduled'
        : c.usageLimit != null && c.usedCount >= c.usageLimit
          ? 'exhausted'
          : 'active';
  return {
    id: String(c._id),
    code: c.code,
    description: c.description ?? '',
    type: c.type,
    value: c.value,
    maxDiscount: c.maxDiscount ?? null,
    minOrderValue: c.minOrderValue,
    startsAt: c.startsAt ?? null,
    expiresAt: c.expiresAt ?? null,
    usageLimit: c.usageLimit ?? null,
    perCustomerLimit: c.perCustomerLimit ?? null,
    usedCount: c.usedCount,
    isActive: c.isActive,
    state,
    createdAt: c.createdAt,
  };
}

export async function listCoupons(query: { page: number; limit: number; q?: string }) {
  const filter = query.q ? { code: new RegExp(escapeRegex(query.q), 'i') } : {};
  const { skip, limit, page } = paginate(query.page, query.limit);
  const [items, total] = await Promise.all([
    Coupon.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Coupon.countDocuments(filter),
  ]);
  return { items: items.map(serialize), meta: pageMeta(total, page, limit) };
}

export async function createCoupon(input: CouponInput, userId: Types.ObjectId) {
  try {
    const c = await Coupon.create({ ...input, createdBy: userId });
    return serialize(c.toObject());
  } catch (err) {
    if (isDuplicateKeyError(err)) throw conflict('A coupon with this code already exists.', 'CODE_TAKEN', { code: 'Already exists' });
    throw err;
  }
}

export async function updateCoupon(id: string, input: CouponInput) {
  const existing = await Coupon.findById(id).lean();
  if (!existing) throw notFound('Coupon');
  if (existing.usedCount > 0 && input.code !== existing.code) {
    throw conflict('The code of a coupon that has been used cannot be changed. Create a new coupon instead.', 'COUPON_IN_USE', { code: 'Locked' });
  }
  try {
    const c = await Coupon.findByIdAndUpdate(id, { $set: input }, { returnDocument: 'after', runValidators: true }).lean();
    return serialize(c!);
  } catch (err) {
    if (isDuplicateKeyError(err)) throw conflict('A coupon with this code already exists.', 'CODE_TAKEN', { code: 'Already exists' });
    throw err;
  }
}

export async function deleteCoupon(id: string) {
  const c = await Coupon.findById(id).lean();
  if (!c) throw notFound('Coupon');
  if (c.usedCount > 0 || (await Order.exists({ 'coupon.couponId': c._id }))) {
    throw conflict('This coupon has been used on orders. Deactivate it instead of deleting.', 'COUPON_IN_USE');
  }
  await Coupon.deleteOne({ _id: c._id });
  await CouponUsage.deleteMany({ coupon: c._id });
  return { deleted: true };
}

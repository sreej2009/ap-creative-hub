import { Schema, model, type Types } from 'mongoose';

export interface ICoupon {
  code: string;
  description?: string;
  type: 'percent' | 'fixed';
  /** Percent (1–100) or fixed amount in paise. */
  value: number;
  /** Optional cap for percentage discounts, in paise. */
  maxDiscount?: number | null;
  minOrderValue: number;
  startsAt?: Date | null;
  expiresAt?: Date | null;
  usageLimit?: number | null;
  perCustomerLimit?: number | null;
  usedCount: number;
  isActive: boolean;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CouponSchema = new Schema<ICoupon>(
  {
    code: { type: String, required: true, uppercase: true, trim: true, maxlength: 30 },
    description: { type: String, maxlength: 200 },
    type: { type: String, enum: ['percent', 'fixed'], required: true },
    value: { type: Number, required: true, min: 1 },
    maxDiscount: { type: Number, default: null },
    minOrderValue: { type: Number, default: 0, min: 0 },
    startsAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    usageLimit: { type: Number, default: null },
    perCustomerLimit: { type: Number, default: 1 },
    usedCount: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

CouponSchema.index({ code: 1 }, { unique: true });

export const Coupon = model<ICoupon>('Coupon', CouponSchema);

/**
 * Per-customer usage counter. One document per (coupon, key) where key is
 * a normalised email or phone. Incremented atomically with a conditional
 * upsert so concurrent orders cannot exceed the per-customer limit.
 */
export interface ICouponUsage {
  coupon: Types.ObjectId;
  key: string;
  count: number;
}

const CouponUsageSchema = new Schema<ICouponUsage>({
  coupon: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true },
  key: { type: String, required: true },
  count: { type: Number, required: true, default: 0, min: 0 },
});
CouponUsageSchema.index({ coupon: 1, key: 1 }, { unique: true });

export const CouponUsage = model<ICouponUsage>('CouponUsage', CouponUsageSchema);

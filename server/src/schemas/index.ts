import { z } from 'zod';
import { ADJUSTMENT_REASONS, MANUAL_ADJUSTMENT_REASONS } from '../models/InventoryAdjustment.js';
import { ORDER_STATUSES, PAYMENT_STATUSES } from '../models/Order.js';
import { PRODUCT_STATUSES } from '../models/Product.js';
import {
  AddressSchema,
  addressFields,
  boolQuery,
  emailField,
  nameField,
  objectId,
  optionalDate,
  pageQuery,
  paise,
  paiseOrZero,
  passwordField,
  phoneField,
  searchText,
} from './common.js';

/* ------------------------------- Auth -------------------------------- */

export const RegisterSchema = z.object({
  name: nameField,
  email: emailField,
  phone: phoneField.optional().or(z.literal('').transform(() => undefined)),
  password: passwordField,
});

export const LoginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Enter your password').max(128),
});

export const ForgotPasswordSchema = z.object({ email: emailField });
export const ResetPasswordSchema = z.object({ token: z.string().min(20).max(100), password: passwordField });
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordField,
});

export const ProfileSchema = z.object({
  name: nameField,
  phone: phoneField.optional().or(z.literal('').transform(() => undefined)),
  whatsappOptIn: z.boolean().optional(),
});

export const AccountAddressSchema = AddressSchema.extend({
  label: z.string().trim().max(40).optional(),
  isDefault: z.boolean().optional(),
});

export const WishlistSchema = z.object({ productIds: z.array(objectId).max(200) });

/* ------------------------------ Catalog ------------------------------ */

const slugField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens')
  .max(90);

export const ImageInputSchema = z.object({
  url: z.string().trim().max(500),
  publicId: z.string().trim().max(300).optional(),
  alt: z.string().trim().max(200).optional().default(''),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export const CategoryInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: slugField.optional().or(z.literal('').transform(() => undefined)),
  description: z.string().trim().max(1000).optional().default(''),
  image: ImageInputSchema.nullable().optional(),
  parent: objectId.nullable().optional(),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().min(0).max(10_000).default(0),
});

const skuField = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-_]{1,39}$/, 'SKU: 2–40 characters, letters, numbers, - or _');

export const VariantInputSchema = z.object({
  _id: objectId.optional(),
  sku: skuField,
  label: z.string().trim().min(1).max(80),
  price: paise.nullable().optional(),
  salePrice: paise.nullable().optional(),
  stock: z.number().int().min(0).max(100_000).default(0),
  isActive: z.boolean().default(true),
});

export const ProductInputSchema = z
  .object({
    name: z.string().trim().min(2).max(140),
    slug: slugField.optional().or(z.literal('').transform(() => undefined)),
    sku: skuField,
    description: z.string().trim().max(5000).default(''),
    shortDescription: z.string().trim().max(300).optional(),
    category: objectId,
    tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(20).default([]),
    images: z.array(ImageInputSchema).max(10).default([]),
    price: paise,
    salePrice: paise.nullable().optional(),
    /** Initial stock (create only). Later changes go through inventory adjustments. */
    stock: z.number().int().min(0).max(100_000).default(0),
    lowStockThreshold: z.number().int().min(0).max(10_000).default(5),
    attributes: z
      .array(z.object({ name: z.string().trim().min(1).max(40), value: z.string().trim().min(1).max(80) }))
      .max(20)
      .default([]),
    variants: z.array(VariantInputSchema).max(50).default([]),
    isFeatured: z.boolean().default(false),
    isNewArrival: z.boolean().default(false),
    status: z.enum(PRODUCT_STATUSES).default('draft'),
  })
  .superRefine((p, ctx) => {
    if (p.salePrice != null && p.salePrice >= p.price) {
      ctx.addIssue({ code: 'custom', path: ['salePrice'], message: 'Sale price must be lower than the regular price' });
    }
    const skus = new Set<string>([p.sku]);
    p.variants.forEach((v, i) => {
      if (skus.has(v.sku)) ctx.addIssue({ code: 'custom', path: ['variants', i, 'sku'], message: 'Duplicate SKU' });
      skus.add(v.sku);
      const base = v.price ?? p.price;
      if (v.salePrice != null && v.salePrice >= base) {
        ctx.addIssue({ code: 'custom', path: ['variants', i, 'salePrice'], message: 'Sale price must be lower than the price' });
      }
    });
    const names = new Set<string>();
    p.attributes.forEach((a, i) => {
      const key = a.name.toLowerCase();
      if (names.has(key)) ctx.addIssue({ code: 'custom', path: ['attributes', i, 'name'], message: 'Duplicate attribute' });
      names.add(key);
    });
  });
export type ProductInput = z.output<typeof ProductInputSchema>;

export const ProductStatusSchema = z.object({ status: z.enum(PRODUCT_STATUSES) });

export const PRODUCT_SORTS = ['newest', 'price_asc', 'price_desc', 'popular', 'name'] as const;

export const ProductListQuery = z.object({
  ...pageQuery,
  limit: z.coerce.number().int().min(1).max(48).default(24),
  q: searchText,
  category: z.string().trim().max(90).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  inStock: boolQuery,
  onSale: boolQuery,
  featured: boolQuery,
  newArrival: boolQuery,
  /** Attribute filters, e.g. "Colour:Gold|Material:Brass" */
  attrs: z.string().max(500).optional(),
  sort: z.enum(PRODUCT_SORTS).default('newest'),
});

export const AdminProductListQuery = z.object({
  ...pageQuery,
  q: searchText,
  category: objectId.optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  stock: z.enum(['low', 'out', 'in']).optional(),
  sort: z.enum(['newest', 'oldest', 'name', 'price_asc', 'price_desc', 'stock_asc', 'stock_desc', 'popular']).default('newest'),
});

/* ------------------------------ Inventory ---------------------------- */

export const StockAdjustSchema = z
  .object({
    variantId: objectId.optional(),
    mode: z.enum(['delta', 'set']).default('delta'),
    quantity: z.number().int().min(-100_000).max(100_000),
    reason: z.enum(MANUAL_ADJUSTMENT_REASONS as [string, ...string[]]),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.mode === 'set' ? v.quantity >= 0 : v.quantity !== 0, {
    message: 'Enter a non-zero change (or a stock level ≥ 0)',
    path: ['quantity'],
  });

export const AdjustmentListQuery = z.object({
  ...pageQuery,
  product: objectId.optional(),
  reason: z.enum(ADJUSTMENT_REASONS).optional(),
});

/* ------------------------------ Coupons ------------------------------ */

export const CouponInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9_-]{2,29}$/, 'Code: 3–30 letters, numbers, - or _'),
    description: z.string().trim().max(200).optional(),
    type: z.enum(['percent', 'fixed']),
    value: z.number().int().positive(),
    maxDiscount: paise.nullable().optional(),
    minOrderValue: paiseOrZero.default(0),
    startsAt: optionalDate,
    expiresAt: optionalDate,
    usageLimit: z.number().int().positive().max(1_000_000).nullable().optional(),
    perCustomerLimit: z.number().int().positive().max(1000).nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .superRefine((c, ctx) => {
    if (c.type === 'percent' && (c.value < 1 || c.value > 90)) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Percentage must be between 1 and 90' });
    }
    if (c.type === 'fixed' && c.value > 100_000_000) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Amount is too large' });
    }
    if (c.startsAt && c.expiresAt && c.expiresAt <= c.startsAt) {
      ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Expiry must be after the start date' });
    }
  });

/* ------------------------------ Cart / checkout ---------------------- */

export const CartItemSchema = z.object({
  productId: objectId,
  variantId: objectId.optional().nullable(),
  quantity: z.number().int().min(1).max(20),
});

export const CartQuoteSchema = z.object({
  items: z.array(CartItemSchema).max(50),
  couponCode: z.string().trim().toUpperCase().max(30).optional().or(z.literal('').transform(() => undefined)),
  paymentMethod: z.enum(['razorpay', 'cod']).optional(),
  email: emailField.optional(),
  phone: phoneField.optional(),
});

export const CheckoutSchema = z.object({
  items: z.array(CartItemSchema).min(1, 'Your cart is empty').max(50),
  customer: z.object({ name: nameField, email: emailField, phone: phoneField }),
  shippingAddress: z.object(addressFields),
  couponCode: z.string().trim().toUpperCase().max(30).optional().or(z.literal('').transform(() => undefined)),
  paymentMethod: z.enum(['razorpay', 'cod']),
  whatsappOptIn: z.boolean().default(false),
  customerNote: z.string().trim().max(500).optional(),
  expectedTotal: z.number().int().min(0).optional(),
  saveAddress: z.boolean().default(false),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9-]{16,64}$/, 'Invalid idempotency key'),
});
export type CheckoutInput = z.output<typeof CheckoutSchema>;

export const VerifyPaymentSchema = z.object({
  orderNumber: z.string().max(40),
  razorpay_order_id: z.string().min(1).max(100),
  razorpay_payment_id: z.string().min(1).max(100),
  razorpay_signature: z.string().min(1).max(200),
});

export const RetryPaymentSchema = z.object({
  orderNumber: z.string().max(40),
  token: z.string().max(64).optional(),
});

/* ------------------------------ Orders ------------------------------- */

export const OrderTokenQuery = z.object({ token: z.string().max(64).optional() });

export const CustomerCancelSchema = z.object({
  reason: z.string().trim().min(3, 'Tell us why you are cancelling').max(300),
  token: z.string().max(64).optional(),
});
export const ReturnRequestSchema = z.object({
  reason: z.string().trim().min(10, 'Please describe the issue (at least 10 characters)').max(500),
  token: z.string().max(64).optional(),
});

export const AdminOrderListQuery = z.object({
  ...pageQuery,
  q: searchText,
  status: z.enum(ORDER_STATUSES).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  paymentMethod: z.enum(['razorpay', 'cod']).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  attention: boolQuery,
});

export const StatusUpdateSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.string().trim().max(500).optional(),
});

export const ShipmentSchema = z.object({
  courierName: z.string().trim().min(2).max(60),
  trackingNumber: z.string().trim().min(3).max(60).regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and - only'),
  trackingUrl: z
    .url({ protocol: /^https$/, error: 'Enter a valid https:// link' })
    .max(500)
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export const InternalNoteSchema = z.object({ note: z.string().trim().min(1).max(2000) });
export const AdminCancelSchema = z.object({ reason: z.string().trim().min(3).max(300), restock: z.boolean().default(true) });
export const RefundSchema = z.object({
  amount: paise.optional(),
  reason: z.string().trim().min(3).max(300),
});
export const ManualRefundSchema = z.object({
  amount: paise,
  reference: z.string().trim().min(3).max(200),
});
export const ReturnResolutionSchema = z.object({
  approve: z.boolean(),
  restock: z.boolean().default(true),
  note: z.string().trim().max(500).optional(),
});
export const CodCollectedSchema = z.object({ reference: z.string().trim().max(200).optional() });

/* ------------------------------ Customers ---------------------------- */

export const CustomerListQuery = z.object({ ...pageQuery, q: searchText, status: z.enum(['active', 'disabled']).optional() });
export const CustomerStatusSchema = z.object({ isActive: z.boolean() });

/* ------------------------------ Settings ----------------------------- */

const relativeOrHttps = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || v.startsWith('/') || /^https:\/\//.test(v), 'Use a relative path or https:// link');

export const SettingsSchema = z.object({
  announcement: z.string().trim().max(160),
  hero: z.object({
    eyebrow: z.string().trim().max(60),
    title: z.string().trim().min(2).max(120),
    subtitle: z.string().trim().max(300),
    ctaLabel: z.string().trim().min(2).max(40),
    ctaHref: z.string().trim().regex(/^\/[A-Za-z0-9/_?=&-]*$/, 'Use an internal link such as /shop'),
    imageUrl: relativeOrHttps,
  }),
  shipping: z.object({
    flatFee: paiseOrZero,
    freeShippingThreshold: paiseOrZero,
    estimatedDays: z.string().trim().max(60),
  }),
  cod: z.object({ enabled: z.boolean(), fee: paiseOrZero, maxOrderValue: paiseOrZero }),
  returns: z.object({ windowDays: z.number().int().min(0).max(60) }),
  contact: z.object({
    email: z.union([z.literal(''), z.email().max(254)]),
    phone: z.string().trim().max(20),
    whatsapp: z.string().trim().regex(/^(\d{10,15})?$/, 'Digits only, with country code, e.g. 919876543210'),
    instagram: z.union([z.literal(''), z.url({ protocol: /^https$/ }).max(200)]),
    address: z.string().trim().max(300),
    hours: z.string().trim().max(100),
  }),
});

export const ContactSchema = z.object({
  name: nameField,
  email: emailField,
  phone: phoneField.optional().or(z.literal('').transform(() => undefined)),
  subject: z.string().trim().min(3).max(150),
  message: z.string().trim().min(10, 'Please write at least 10 characters').max(3000),
  /** Honeypot field — must stay empty. */
  website: z.string().max(0).optional().or(z.literal('')),
});

export const MessageStatusSchema = z.object({ status: z.enum(['new', 'read', 'resolved']) });

export { AddressSchema };

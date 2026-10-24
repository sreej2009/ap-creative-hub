import { Types } from 'mongoose';
import { getPaymentGateway } from '../integrations/razorpay.js';
import { AppError } from '../lib/errors.js';
import { unitPriceFor } from '../lib/pricing.js';
import { Product } from '../models/Product.js';
import { activeCategoryIds } from './category.service.js';
import { couponUsageKeys, evaluateCoupon } from './coupon.service.js';
import { getSettings } from './settings.service.js';

export const MAX_QTY_PER_LINE = 20;

export type LineIssue = 'unavailable' | 'variant_required' | 'variant_unavailable' | 'out_of_stock' | 'insufficient_stock';

export interface QuoteLine {
  key: string;
  productId: string;
  variantId: string | null;
  slug: string;
  name: string;
  sku: string;
  variantLabel: string | null;
  image: string | null;
  unitPrice: number;
  compareAtPrice: number | null;
  quantity: number;
  lineTotal: number;
  available: number;
  maxQuantity: number;
  issue: LineIssue | null;
}

export interface CartQuote {
  currency: 'INR';
  lines: QuoteLine[];
  subtotal: number;
  discount: number;
  shipping: number;
  codFee: number;
  total: number;
  itemCount: number;
  hasIssues: boolean;
  coupon:
    | { code: string; valid: true; discount: number; description: string; couponId: string; usageKeys: string[] }
    | { code: string; valid: false; message: string; reason: string }
    | null;
  shippingInfo: { flatFee: number; freeShippingThreshold: number; amountToFreeShipping: number };
  paymentMethods: {
    razorpay: { available: boolean; reason?: string };
    cod: { available: boolean; reason?: string; fee: number };
  };
}

/**
 * Prices a cart entirely from the database. Client-side prices are never
 * trusted; the checkout uses this exact computation to create the order.
 */
export async function quoteCart(input: {
  items: { productId: string; variantId?: string | null; quantity: number }[];
  couponCode?: string;
  paymentMethod?: 'razorpay' | 'cod';
  email?: string;
  phone?: string;
}): Promise<CartQuote> {
  // Merge duplicate lines (same product + variant).
  const merged = new Map<string, { productId: string; variantId: string | null; quantity: number }>();
  for (const item of input.items) {
    const key = `${item.productId}:${item.variantId ?? ''}`;
    const prev = merged.get(key);
    merged.set(key, {
      productId: item.productId,
      variantId: item.variantId ?? null,
      quantity: Math.min((prev?.quantity ?? 0) + item.quantity, MAX_QTY_PER_LINE),
    });
  }

  const ids = [...new Set([...merged.values()].map((m) => m.productId))].map((id) => new Types.ObjectId(id));
  const [products, activeCats, settings] = await Promise.all([
    Product.find({ _id: { $in: ids } }).lean(),
    activeCategoryIds(),
    getSettings(),
  ]);
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const activeCatSet = new Set(activeCats.map(String));

  const lines: QuoteLine[] = [];
  for (const [key, m] of merged) {
    const p = byId.get(m.productId);
    const sellable = p && p.status === 'active' && activeCatSet.has(String(p.category));
    if (!p || !sellable) {
      lines.push({
        key, productId: m.productId, variantId: m.variantId, slug: p?.slug ?? '', name: p?.name ?? 'Unavailable product',
        sku: p?.sku ?? '', variantLabel: null, image: p?.images[0]?.url ?? null, unitPrice: 0, compareAtPrice: null,
        quantity: m.quantity, lineTotal: 0, available: 0, maxQuantity: 0, issue: 'unavailable',
      });
      continue;
    }
    const activeVariants = p.variants.filter((v) => v.isActive);
    let issue: LineIssue | null = null;
    let variant = null as (typeof p.variants)[number] | null;
    if (m.variantId) {
      variant = p.variants.find((v) => String(v._id) === m.variantId) ?? null;
      if (!variant || !variant.isActive) issue = 'variant_unavailable';
    } else if (activeVariants.length) {
      issue = 'variant_required';
    }
    const available = variant ? variant.stock : activeVariants.length ? 0 : p.stock;
    if (!issue) {
      if (available <= 0) issue = 'out_of_stock';
      else if (available < m.quantity) issue = 'insufficient_stock';
    }
    const price = unitPriceFor(p, variant);
    lines.push({
      key,
      productId: m.productId,
      variantId: variant ? String(variant._id) : null,
      slug: p.slug,
      name: p.name,
      sku: variant?.sku ?? p.sku,
      variantLabel: variant?.label ?? null,
      image: p.images[0]?.url ?? null,
      unitPrice: price.unitPrice,
      compareAtPrice: price.compareAtPrice,
      quantity: m.quantity,
      lineTotal: issue ? 0 : price.unitPrice * m.quantity,
      available: Math.max(0, available),
      maxQuantity: Math.max(0, Math.min(available, MAX_QTY_PER_LINE)),
      issue,
    });
  }

  const valid = lines.filter((l) => !l.issue);
  const subtotal = valid.reduce((s, l) => s + l.lineTotal, 0);
  const itemCount = valid.reduce((s, l) => s + l.quantity, 0);

  let discount = 0;
  let coupon: CartQuote['coupon'] = null;
  if (input.couponCode) {
    const keys = couponUsageKeys(input.email, input.phone);
    try {
      if (subtotal === 0) throw new AppError(422, 'COUPON_INVALID', 'Add items to your cart to use a coupon.');
      const res = await evaluateCoupon(input.couponCode, subtotal, keys);
      discount = res.discount;
      coupon = {
        code: res.coupon.code,
        valid: true,
        discount,
        description: res.coupon.description ?? '',
        couponId: String(res.coupon._id),
        usageKeys: keys,
      };
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      coupon = { code: input.couponCode.toUpperCase(), valid: false, message: err.message, reason: err.code };
    }
  }

  const { flatFee, freeShippingThreshold } = settings.shipping;
  const afterDiscount = subtotal - discount;
  const freeShipping = freeShippingThreshold > 0 && afterDiscount >= freeShippingThreshold;
  const shipping = valid.length === 0 || freeShipping ? 0 : flatFee;

  const codSettings = settings.cod;
  const preCodTotal = afterDiscount + shipping;
  let cod: CartQuote['paymentMethods']['cod'] = { available: true, fee: codSettings.fee };
  if (!codSettings.enabled) cod = { available: false, reason: 'Cash on Delivery is currently unavailable.', fee: 0 };
  else if (codSettings.maxOrderValue > 0 && preCodTotal + codSettings.fee > codSettings.maxOrderValue) {
    cod = { available: false, reason: 'Cash on Delivery is not available for orders of this value.', fee: codSettings.fee };
  }
  const codFee = input.paymentMethod === 'cod' && cod.available && valid.length ? codSettings.fee : 0;

  const gateway = getPaymentGateway();
  return {
    currency: 'INR',
    lines,
    subtotal,
    discount,
    shipping,
    codFee,
    total: preCodTotal + codFee,
    itemCount,
    hasIssues: lines.some((l) => l.issue),
    coupon,
    shippingInfo: {
      flatFee,
      freeShippingThreshold,
      amountToFreeShipping: freeShippingThreshold > 0 ? Math.max(0, freeShippingThreshold - afterDiscount) : 0,
    },
    paymentMethods: {
      razorpay: gateway ? { available: true } : { available: false, reason: 'Online payment is not configured yet.' },
      cod,
    },
  };
}

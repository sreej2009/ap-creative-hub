/**
 * DEMO ONLY — an in-browser stand-in for the A&P API, used by the static
 * GitHub Pages demo (VITE_DEMO=true). It mirrors the real server's rules
 * (server-side pricing, stock checks, coupon limits, order state machine,
 * role permissions, dashboard maths) against sample data kept in the
 * visitor's localStorage. No network calls, no real orders or payments.
 */
import { ApiError } from '../lib/api';
import {
  DEMO_ACCOUNTS,
  createSeed,
  demoHash,
  unitPrice,
  type Actor,
  type DCategory,
  type DemoDB,
  type DOrder,
  type DProduct,
  type DUser,
  type DVariant,
} from './data';

const KEY = 'ap_demo_db_v1';
const CUSTOMER_KEY = 'ap_demo_customer';
const ADMIN_KEY = 'ap_demo_admin';

type Query = Record<string, string | number | boolean | null | undefined>;
type Body = Record<string, unknown>;

/* ------------------------------ Storage ------------------------------ */

let db: DemoDB | null = null;

function load(): DemoDB {
  if (db) return db;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoDB;
      if (parsed.version === 1) return (db = parsed);
    }
  } catch {
    /* fall through to a fresh seed */
  }
  db = createSeed();
  save();
  return db;
}

function save() {
  try {
    if (db) localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* storage full or blocked — keep working in memory */
  }
}

export function resetDemo() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(CUSTOMER_KEY);
    localStorage.removeItem(ADMIN_KEY);
    localStorage.removeItem('ap_cart_v1');
    localStorage.removeItem('ap_wishlist_v1');
    localStorage.removeItem('ap_coupon');
  } catch {
    /* ignore */
  }
  db = null;
}

const newId = (prefix: string) => {
  const d = load();
  d.seq += 1;
  return `${prefix}${d.seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
};
const nowIso = () => new Date().toISOString();
const err = (status: number, code: string, message: string, details?: Record<string, unknown>) => new ApiError(status, code, message, details);
const notFound = (what = 'Resource') => err(404, 'NOT_FOUND', `${what} not found.`);
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const num = (v: unknown, d = 0) => (v === undefined || v === null || v === '' ? d : Number(v));
const bool = (v: unknown) => v === true || v === 'true' || v === '1';

const pageMeta = (total: number, page: number, limit: number) => ({ total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
function paginate<T>(list: T[], q: Query, defLimit = 20) {
  const limit = Math.min(Math.max(num(q.limit, defLimit), 1), 100);
  const page = Math.max(num(q.page, 1), 1);
  return { items: list.slice((page - 1) * limit, page * limit), meta: pageMeta(list.length, page, limit) };
}

/* ------------------------------ Sessions ----------------------------- */

const sessionUser = (key: string) => {
  try {
    const id = localStorage.getItem(key);
    return id ? (load().users.find((u) => u.id === id && u.isActive) ?? null) : null;
  } catch {
    return null;
  }
};
const customer = () => {
  const u = sessionUser(CUSTOMER_KEY);
  return u?.role === 'customer' ? u : null;
};
const admin = () => {
  const u = sessionUser(ADMIN_KEY);
  return u && u.role !== 'customer' ? u : null;
};
const setSession = (key: string, id: string | null) => {
  try {
    if (id) localStorage.setItem(key, id);
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
};
const publicUser = (u: DUser) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, whatsappOptIn: u.whatsappOptIn, createdAt: u.createdAt });

const ADMIN_ONLY = ['orders:refund', 'orders:export', 'products:delete', 'categories:delete', 'customers:write', 'coupons:write', 'settings:write'];
const ALL_PERMISSIONS = [
  'dashboard:read', 'products:read', 'products:write', 'products:delete', 'categories:read', 'categories:write', 'categories:delete',
  'media:upload', 'inventory:read', 'inventory:write', 'orders:read', 'orders:write', 'orders:cancel', 'orders:refund', 'orders:export',
  'customers:read', 'customers:write', 'coupons:read', 'coupons:write', 'notifications:read', 'messages:read', 'messages:write',
  'settings:read', 'settings:write',
];
const permissionsFor = (role: string) => ALL_PERMISSIONS.filter((p) => role === 'admin' || !ADMIN_ONLY.includes(p));
function requireAdmin(permission?: string) {
  const u = admin();
  if (!u) throw err(401, 'UNAUTHENTICATED', 'Admin session required.');
  if (permission && !permissionsFor(u.role).includes(permission)) throw err(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
  return u;
}
const adminActor = (u: DUser): Actor => ({ type: u.role === 'admin' ? 'admin' : 'staff', id: u.id, name: u.name });

/* ------------------------------ Catalogue ---------------------------- */

const STATUS_LABELS: Record<string, string> = {
  pending_payment: 'Awaiting Payment', placed: 'Order Placed', payment_confirmed: 'Payment Confirmed', processing: 'Processing',
  packed: 'Packed', shipped: 'Shipped', out_for_delivery: 'Out for Delivery', delivered: 'Delivered', cancelled: 'Cancelled',
  return_requested: 'Return Requested', returned: 'Returned', refunded: 'Refunded',
};
const ADMIN_TRANSITIONS: Record<string, string[]> = {
  pending_payment: [], placed: ['processing'], payment_confirmed: ['processing'], processing: ['packed'], packed: ['shipped', 'processing'],
  shipped: ['out_for_delivery', 'delivered'], out_for_delivery: ['delivered'], delivered: ['return_requested'],
  return_requested: [], returned: [], cancelled: [], refunded: [],
};
const CANCELLABLE_BY_ADMIN = ['pending_payment', 'placed', 'payment_confirmed', 'processing', 'packed'];
const CANCELLABLE_BY_CUSTOMER = ['pending_payment', 'placed', 'payment_confirmed'];
const SHIPMENT_EDITABLE = ['processing', 'packed', 'shipped', 'out_for_delivery'];

function activeCategoryIds(d: DemoDB) {
  const active = new Set(d.categories.filter((c) => c.isActive).map((c) => c.id));
  return new Set(d.categories.filter((c) => c.isActive && (!c.parent || active.has(c.parent))).map((c) => c.id));
}
const withChildren = (d: DemoDB, id: string) => [id, ...d.categories.filter((c) => c.parent === id).map((c) => c.id)];
const sellable = (d: DemoDB, p: DProduct, active = activeCategoryIds(d)) => p.status === 'active' && active.has(p.categoryId);

function listing(p: DProduct) {
  const active = p.variants.filter((v) => v.isActive);
  const prices = active.length ? active.map((v) => unitPrice(p, v)) : [unitPrice(p)];
  return { sellingPrice: Math.min(...prices.map((x) => x.unitPrice)), isOnSale: prices.some((x) => x.compareAtPrice !== null), cheapest: [...prices].sort((a, b) => a.unitPrice - b.unitPrice)[0] };
}

function card(d: DemoDB, p: DProduct) {
  const l = listing(p);
  const cat = d.categories.find((c) => c.id === p.categoryId);
  const activeV = p.variants.filter((v) => v.isActive);
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    image: p.images[0] ?? null,
    hoverImage: p.images[1] ?? null,
    price: l.cheapest.unitPrice,
    compareAtPrice: l.cheapest.compareAtPrice,
    hasVariants: activeV.length > 0,
    priceVaries: new Set(activeV.map((v) => unitPrice(p, v).unitPrice)).size > 1,
    inStock: p.stock > 0,
    lowStock: p.stock > 0 && p.stock <= p.lowStockThreshold,
    isNewArrival: p.isNewArrival,
    isFeatured: p.isFeatured,
    category: cat ? { name: cat.name, slug: cat.slug } : null,
  };
}

function detail(d: DemoDB, p: DProduct) {
  const base = unitPrice(p);
  const cat = d.categories.find((c) => c.id === p.categoryId) ?? null;
  const parent = cat?.parent ? (d.categories.find((c) => c.id === cat.parent) ?? null) : null;
  const ref = (c: DCategory | null) => (c ? { id: c.id, name: c.name, slug: c.slug } : null);
  return {
    id: p.id, name: p.name, slug: p.slug, sku: p.sku, description: p.description, shortDescription: p.shortDescription, images: p.images,
    price: base.unitPrice, compareAtPrice: base.compareAtPrice, stock: p.stock, inStock: p.stock > 0, lowStock: p.stock > 0 && p.stock <= p.lowStockThreshold,
    attributes: p.attributes,
    variants: p.variants.filter((v) => v.isActive).map((v) => ({ id: v.id, sku: v.sku, label: v.label, ...unitPrice(p, v), price: unitPrice(p, v).unitPrice, stock: v.stock, inStock: v.stock > 0 })),
    tags: p.tags, isNewArrival: p.isNewArrival, isFeatured: p.isFeatured, category: ref(cat), parentCategory: ref(parent),
  };
}

function adminProduct(d: DemoDB, p: DProduct) {
  const cat = d.categories.find((c) => c.id === p.categoryId);
  return {
    id: p.id, name: p.name, slug: p.slug, sku: p.sku, description: p.description, shortDescription: p.shortDescription,
    category: { id: p.categoryId, name: cat?.name ?? null }, tags: p.tags, images: p.images, price: p.price, salePrice: p.salePrice,
    sellingPrice: listing(p).sellingPrice, stock: p.stock, lowStockThreshold: p.lowStockThreshold,
    stockState: p.stock === 0 ? 'out' : p.stock <= p.lowStockThreshold ? 'low' : 'in',
    attributes: p.attributes, variants: p.variants, isFeatured: p.isFeatured, isNewArrival: p.isNewArrival, status: p.status,
    soldCount: p.soldCount, isSample: p.isSample, createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

function categoryTree(d: DemoDB) {
  const active = activeCategoryIds(d);
  const counts = (id: string) => d.products.filter((p) => p.categoryId === id && p.status === 'active').length;
  const ser = (c: DCategory) => ({ ...c, productCount: counts(c.id), activeProductCount: counts(c.id) });
  const cats = d.categories.filter((c) => active.has(c.id)).sort((a, b) => a.displayOrder - b.displayOrder);
  return cats
    .filter((c) => !c.parent)
    .map((r) => {
      const children = cats.filter((c) => c.parent === r.id).map(ser);
      return { ...ser(r), productCount: counts(r.id) + children.reduce((s, c) => s + c.productCount, 0), children };
    });
}

function listProducts(d: DemoDB, q: Query) {
  const active = activeCategoryIds(d);
  let catIds = active;
  let category: { id: string; name: string; slug: string } | null = null;
  if (q.category) {
    const cat = d.categories.find((c) => c.slug === q.category);
    if (!cat || !active.has(cat.id)) throw notFound('Category');
    catIds = new Set(withChildren(d, cat.id).filter((id) => active.has(id)));
    category = { id: cat.id, name: cat.name, slug: cat.slug };
  }
  const term = str(q.q).trim().toLowerCase();
  let base = d.products.filter((p) => p.status === 'active' && catIds.has(p.categoryId));
  if (term) base = base.filter((p) => p.name.toLowerCase().includes(term) || p.tags.some((t) => t.includes(term)) || p.sku === term.toUpperCase());
  const min = q.minPrice != null && q.minPrice !== '' ? Number(q.minPrice) : null;
  const max = q.maxPrice != null && q.maxPrice !== '' ? Number(q.maxPrice) : null;
  base = base.filter((p) => {
    const sp = listing(p).sellingPrice;
    return (min == null || sp >= min) && (max == null || sp <= max);
  });
  if (bool(q.inStock)) base = base.filter((p) => p.stock > 0);
  if (bool(q.onSale)) base = base.filter((p) => listing(p).isOnSale);
  if (bool(q.featured)) base = base.filter((p) => p.isFeatured);
  if (bool(q.newArrival)) base = base.filter((p) => p.isNewArrival);
  const attrs = str(q.attrs)
    .split('|')
    .map((pair) => {
      const i = pair.indexOf(':');
      return i > 0 ? { name: pair.slice(0, i), values: pair.slice(i + 1).split(',').filter(Boolean) } : null;
    })
    .filter((x): x is { name: string; values: string[] } => !!x && x.values.length > 0);
  const filtered = base.filter((p) => attrs.every((a) => p.attributes.some((x) => x.name === a.name && a.values.includes(x.value))));
  const sorts: Record<string, (a: DProduct, b: DProduct) => number> = {
    newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
    price_asc: (a, b) => listing(a).sellingPrice - listing(b).sellingPrice,
    price_desc: (a, b) => listing(b).sellingPrice - listing(a).sellingPrice,
    popular: (a, b) => b.soldCount - a.soldCount || b.createdAt.localeCompare(a.createdAt),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  filtered.sort(sorts[str(q.sort)] ?? sorts.newest);
  const facetMap = new Map<string, Set<string>>();
  for (const p of base) for (const a of p.attributes) (facetMap.get(a.name) ?? facetMap.set(a.name, new Set()).get(a.name)!).add(a.value);
  const inCats = d.products.filter((p) => p.status === 'active' && catIds.has(p.categoryId)).map((p) => listing(p).sellingPrice);
  const page = paginate(filtered, q, 24);
  return {
    items: page.items.map((p) => card(d, p)),
    meta: page.meta,
    category,
    facets: {
      attributes: [...facetMap.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, 8).map(([name, values]) => ({ name, values: [...values].sort() })),
      price: inCats.length ? { min: Math.min(...inCats), max: Math.max(...inCats) } : null,
    },
  };
}

/* ------------------------------ Pricing ------------------------------ */

const usageKeys = (email?: string, phone?: string) => [email ? `email:${email.toLowerCase()}` : null, phone ? `phone:${phone}` : null].filter(Boolean) as string[];

function couponUses(d: DemoDB, code: string, keys: string[]) {
  return d.orders.filter((o) => o.coupon?.code === code && !o.coupon.released && keys.some((k) => k === `email:${o.customer.email}` || k === `phone:${o.customer.phone}`)).length;
}

function evaluateCoupon(d: DemoDB, code: string, subtotal: number, keys: string[]) {
  const c = d.coupons.find((x) => x.code === code.trim().toUpperCase());
  const now = Date.now();
  const bad = (message: string, reason = 'COUPON_INVALID') => ({ ok: false as const, message, reason });
  if (!c || !c.isActive) return bad('This coupon code is not valid.');
  if (c.startsAt && Date.parse(c.startsAt) > now) return bad('This coupon is not active yet.');
  if (c.expiresAt && Date.parse(c.expiresAt) <= now) return bad('This coupon has expired.', 'COUPON_EXPIRED');
  if (c.usageLimit != null && c.usedCount >= c.usageLimit) return bad('This coupon has reached its usage limit.', 'COUPON_EXHAUSTED');
  if (subtotal < c.minOrderValue) {
    return bad(`Add ₹${((c.minOrderValue - subtotal) / 100).toLocaleString('en-IN')} more to use this coupon (minimum order ₹${(c.minOrderValue / 100).toLocaleString('en-IN')}).`, 'COUPON_MIN_ORDER');
  }
  if (c.perCustomerLimit && keys.length && couponUses(d, c.code, keys) >= c.perCustomerLimit) return bad('You have already used this coupon.', 'COUPON_ALREADY_USED');
  let discount = c.type === 'percent' ? Math.floor((subtotal * c.value) / 100) : c.value;
  if (c.type === 'percent' && c.maxDiscount) discount = Math.min(discount, c.maxDiscount);
  discount = Math.max(0, Math.min(discount, subtotal));
  return { ok: true as const, coupon: c, discount };
}

interface QuoteItem {
  productId: string;
  variantId?: string | null;
  quantity: number;
}

function quote(d: DemoDB, body: Body) {
  const items = (Array.isArray(body.items) ? body.items : []) as QuoteItem[];
  const merged = new Map<string, QuoteItem>();
  for (const it of items) {
    const key = `${it.productId}:${it.variantId ?? ''}`;
    merged.set(key, { productId: it.productId, variantId: it.variantId ?? null, quantity: Math.min((merged.get(key)?.quantity ?? 0) + num(it.quantity, 1), 20) });
  }
  const active = activeCategoryIds(d);
  const lines = [...merged.entries()].map(([key, m]) => {
    const p = d.products.find((x) => x.id === m.productId);
    if (!p || !sellable(d, p, active)) {
      return { key, productId: m.productId, variantId: m.variantId ?? null, slug: p?.slug ?? '', name: p?.name ?? 'Unavailable product', sku: p?.sku ?? '', variantLabel: null, image: p?.images[0]?.url ?? null, unitPrice: 0, compareAtPrice: null, quantity: m.quantity, lineTotal: 0, available: 0, maxQuantity: 0, issue: 'unavailable' };
    }
    const activeV = p.variants.filter((v) => v.isActive);
    let v: DVariant | null = null;
    let issue: string | null = null;
    if (m.variantId) {
      v = p.variants.find((x) => x.id === m.variantId) ?? null;
      if (!v || !v.isActive) issue = 'variant_unavailable';
    } else if (activeV.length) issue = 'variant_required';
    const available = v ? v.stock : activeV.length ? 0 : p.stock;
    if (!issue && available <= 0) issue = 'out_of_stock';
    else if (!issue && available < m.quantity) issue = 'insufficient_stock';
    const price = unitPrice(p, v);
    return {
      key, productId: p.id, variantId: v?.id ?? null, slug: p.slug, name: p.name, sku: v?.sku ?? p.sku, variantLabel: v?.label ?? null,
      image: p.images[0]?.url ?? null, unitPrice: price.unitPrice, compareAtPrice: price.compareAtPrice, quantity: m.quantity,
      lineTotal: issue ? 0 : price.unitPrice * m.quantity, available: Math.max(0, available), maxQuantity: Math.max(0, Math.min(available, 20)), issue,
    };
  });
  const valid = lines.filter((l) => !l.issue);
  const subtotal = valid.reduce((s, l) => s + l.lineTotal, 0);
  const itemCount = valid.reduce((s, l) => s + l.quantity, 0);
  let discount = 0;
  let coupon: Record<string, unknown> | null = null;
  let couponCode: string | null = null;
  if (body.couponCode) {
    const res = subtotal === 0 ? { ok: false as const, message: 'Add items to your cart to use a coupon.', reason: 'COUPON_INVALID' } : evaluateCoupon(d, str(body.couponCode), subtotal, usageKeys(str(body.email) || undefined, str(body.phone) || undefined));
    if (res.ok) {
      discount = res.discount;
      couponCode = res.coupon.code;
      coupon = { code: res.coupon.code, valid: true, discount, description: res.coupon.description };
    } else coupon = { code: str(body.couponCode).toUpperCase(), valid: false, message: res.message, reason: res.reason };
  }
  const s = d.settings;
  const after = subtotal - discount;
  const shipping = valid.length === 0 || (s.shipping.freeShippingThreshold > 0 && after >= s.shipping.freeShippingThreshold) ? 0 : s.shipping.flatFee;
  const pre = after + shipping;
  let cod: { available: boolean; reason?: string; fee: number } = { available: true, fee: s.cod.fee };
  if (!s.cod.enabled) cod = { available: false, reason: 'Cash on Delivery is currently unavailable.', fee: 0 };
  else if (s.cod.maxOrderValue > 0 && pre + s.cod.fee > s.cod.maxOrderValue) cod = { available: false, reason: 'Cash on Delivery is not available for orders of this value.', fee: s.cod.fee };
  const codFee = body.paymentMethod === 'cod' && cod.available && valid.length ? s.cod.fee : 0;
  return {
    currency: 'INR' as const, lines, subtotal, discount, shipping, codFee, total: pre + codFee, itemCount, hasIssues: lines.some((l) => l.issue), coupon, couponCode,
    shippingInfo: { flatFee: s.shipping.flatFee, freeShippingThreshold: s.shipping.freeShippingThreshold, amountToFreeShipping: s.shipping.freeShippingThreshold > 0 ? Math.max(0, s.shipping.freeShippingThreshold - after) : 0 },
    paymentMethods: { razorpay: { available: false, reason: 'Online payment (Razorpay) is switched on at launch — this demo uses Cash on Delivery.' }, cod },
  };
}

/* ------------------------------ Orders ------------------------------- */

function restock(d: DemoDB, o: DOrder, reason: string, actor: Actor) {
  if (o.inventoryState === 'released') return;
  for (const it of o.items) {
    const p = d.products.find((x) => x.id === it.product);
    if (!p) continue;
    const v = it.variantId ? p.variants.find((x) => x.id === it.variantId) : null;
    if (v) v.stock += it.quantity;
    p.stock = p.variants.length ? p.variants.reduce((s, x) => s + x.stock, 0) : p.stock + it.quantity;
    if (o.inventoryState === 'committed') p.soldCount = Math.max(0, p.soldCount - it.quantity);
    d.adjustments.unshift({ id: newId('a'), productId: p.id, sku: it.sku, delta: it.quantity, stockAfter: v ? v.stock : p.stock, reason, order: o.orderNumber, actor, note: null, createdAt: nowIso() });
  }
  o.inventoryState = 'released';
}

function releaseCoupon(d: DemoDB, o: DOrder) {
  if (!o.coupon || o.coupon.released) return;
  o.coupon.released = true;
  const c = d.coupons.find((x) => x.code === o.coupon!.code);
  if (c && c.usedCount > 0) c.usedCount--;
}

function notify(d: DemoDB, event: string, o: DOrder) {
  // Mirrors production with no email provider configured: logged as skipped, never claimed as sent.
  d.notifications.unshift({ id: newId('n'), event, channel: 'email', recipient: o.customer.email, status: 'skipped', reason: 'email_provider_not_configured', subject: null, orderId: o.id, orderNumber: o.orderNumber, createdAt: nowIso() });
  d.notifications.unshift({ id: newId('n'), event, channel: 'whatsapp', recipient: o.customer.phone, status: 'skipped', reason: o.whatsappOptIn ? 'whatsapp_provider_not_configured' : 'no_customer_opt_in', subject: null, orderId: o.id, orderNumber: o.orderNumber, createdAt: nowIso() });
}

const actorLabel = (t: string) => (t === 'admin' || t === 'staff' ? 'A&P team' : t === 'system' ? 'System' : 'You');

function customerOrder(d: DemoDB, o: DOrder, mask = false) {
  const delivered = o.shipment.deliveredAt ? Date.parse(o.shipment.deliveredAt) : 0;
  const days = d.settings.returns.windowDays;
  return {
    id: o.id, orderNumber: o.orderNumber, status: o.status, statusLabel: STATUS_LABELS[o.status], createdAt: o.createdAt,
    items: o.items.map((i) => ({ ...i, productId: i.product })), pricing: o.pricing,
    coupon: o.coupon ? { code: o.coupon.code, discount: o.coupon.discount } : null,
    payment: { method: o.payment.method, status: o.payment.status, paidAt: o.payment.paidAt, amountPaid: o.payment.amountPaid, amountRefunded: o.payment.amountRefunded },
    customer: mask ? { name: o.customer.name, email: null, phone: `******${o.customer.phone.slice(-4)}` } : o.customer,
    shippingAddress: mask ? { fullName: o.shippingAddress.fullName, city: o.shippingAddress.city, state: o.shippingAddress.state, pincode: o.shippingAddress.pincode } : o.shippingAddress,
    timeline: o.timeline.map((t) => ({ status: t.status, label: STATUS_LABELS[t.status], at: t.at, by: actorLabel(t.actor.type), note: t.note ?? null })),
    shipment: o.shipment, courierEvents: [],
    cancellation: o.cancellation ? { reason: o.cancellation.reason, at: o.cancellation.at } : null,
    returnRequest: o.returnRequest, reservationExpiresAt: null,
    actions: {
      canCancel: CANCELLABLE_BY_CUSTOMER.includes(o.status),
      canRequestReturn: o.status === 'delivered' && days > 0 && !!delivered && Date.now() - delivered <= days * 86400_000,
      canPay: false,
    },
  };
}

function orderSummary(o: DOrder) {
  return {
    id: o.id, orderNumber: o.orderNumber, createdAt: o.createdAt, customer: o.customer, isGuest: !o.user,
    itemCount: o.items.reduce((s, i) => s + i.quantity, 0), total: o.pricing.total, status: o.status, statusLabel: STATUS_LABELS[o.status],
    payment: { method: o.payment.method, status: o.payment.status }, attention: o.attention, city: o.shippingAddress.city,
  };
}

function adminOrder(d: DemoDB, o: DOrder) {
  const paid = ['paid', 'partially_refunded'].includes(o.payment.status);
  const refundable = o.payment.amountPaid - o.payment.amountRefunded - o.payment.refundReserved;
  return {
    ...orderSummary(o),
    user: o.user, shippingAddress: o.shippingAddress, items: o.items, pricing: o.pricing, coupon: o.coupon, payment: o.payment,
    inventoryState: o.inventoryState, reservationExpiresAt: null,
    timeline: o.timeline.map((t) => ({ ...t, label: STATUS_LABELS[t.status] })),
    internalNotes: o.internalNotes, shipment: o.shipment, courierEvents: [], cancellation: o.cancellation, returnRequest: o.returnRequest,
    customerNote: o.customerNote, whatsappOptIn: o.whatsappOptIn, updatedAt: o.updatedAt,
    actions: {
      transitions: ADMIN_TRANSITIONS[o.status] ?? [],
      canCancel: CANCELLABLE_BY_ADMIN.includes(o.status),
      canEditShipment: SHIPMENT_EDITABLE.includes(o.status),
      canResolveReturn: o.status === 'return_requested',
      canRefund: o.payment.method === 'razorpay' && paid && ['cancelled', 'returned'].includes(o.status) && refundable > 0,
      canRecordManualRefund: o.payment.method === 'cod' && paid && ['cancelled', 'returned'].includes(o.status) && refundable > 0,
      canRecordCodPayment: o.payment.method === 'cod' && o.payment.status === 'cod_pending' && ['shipped', 'out_for_delivery', 'delivered'].includes(o.status),
    },
    transactions: o.transactions,
    notifications: d.notifications.filter((n) => n.orderId === o.id).map((n) => ({ id: n.id, event: n.event, channel: n.channel, status: n.status, reason: n.reason, createdAt: n.createdAt })),
  };
}

function cancelOrder(d: DemoDB, o: DOrder, actor: Actor, reason: string, allowed: string[]) {
  if (!allowed.includes(o.status)) throw err(409, 'INVALID_TRANSITION', `An order that is "${STATUS_LABELS[o.status]}" can no longer be cancelled.`);
  const at = nowIso();
  if (o.payment.status === 'awaiting_payment' || o.payment.status === 'cod_pending') o.payment.status = 'void';
  if (o.payment.amountPaid - o.payment.amountRefunded > 0) o.attention = { reason: 'Refund required — order was cancelled after payment.', at };
  o.status = 'cancelled';
  o.cancellation = { reason, at, by: actor };
  o.timeline.push({ status: 'cancelled', at, actor, note: reason });
  o.updatedAt = at;
  restock(d, o, 'order_released', actor);
  releaseCoupon(d, o);
  notify(d, 'cancellation', o);
}

const ORDER_NO = /^AP-\d{6}-[A-Z0-9]{5}$/;
function accessibleOrder(d: DemoDB, orderNumber: string, token?: string) {
  const o = d.orders.find((x) => x.orderNumber === orderNumber.toUpperCase());
  if (!o) return null;
  const u = customer();
  if (u && o.user === u.id) return { o, owner: true };
  if (token && token === o.trackingToken) return { o, owner: false };
  return null;
}

function placeOrder(d: DemoDB, body: Body) {
  const user = customer();
  const c = (body.customer ?? {}) as { name: string; email: string; phone: string };
  const email = user ? user.email : str(c.email).toLowerCase();
  if (body.idempotencyKey) {
    const replay = d.orders.find((o) => o.idempotencyKey === body.idempotencyKey);
    if (replay) return { order: customerOrder(d, replay), trackingToken: replay.trackingToken, payment: null };
  }
  const q = quote(d, { ...body, email, phone: c.phone });
  if (q.hasIssues || !q.lines.length) throw err(409, 'CART_CHANGED', 'Some items in your cart have changed. Please review your cart.', { quote: q });
  if (body.couponCode && q.coupon && !q.coupon.valid) throw err(422, str(q.coupon.reason), str(q.coupon.message));
  if (body.expectedTotal !== undefined && Number(body.expectedTotal) !== q.total) throw err(409, 'PRICE_CHANGED', 'Prices have changed since you loaded checkout. Please review the updated total.', { quote: q });
  if (body.paymentMethod === 'razorpay') throw err(503, 'PAYMENT_NOT_CONFIGURED', 'Online payment is switched on at launch. Please choose Cash on Delivery in this demo.');
  if (!q.paymentMethods.cod.available) throw err(422, 'COD_UNAVAILABLE', q.paymentMethods.cod.reason ?? 'Cash on Delivery is unavailable.');

  const now = nowIso();
  const id = newId('o');
  const actor: Actor = user ? { type: 'customer', id: user.id, name: user.name } : { type: 'customer', id: null, name: c.name };
  const date = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(2, 10).replace(/-/g, '');
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const suffix = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  const orderNumber = `AP-${date}-${suffix}`;
  // Reserve stock (all-or-nothing; validated by the quote above).
  for (const l of q.lines) {
    const p = d.products.find((x) => x.id === l.productId)!;
    const v = l.variantId ? p.variants.find((x) => x.id === l.variantId)! : null;
    if (v) v.stock -= l.quantity;
    p.stock = p.variants.length ? p.variants.reduce((s, x) => s + x.stock, 0) : p.stock - l.quantity;
    p.soldCount += l.quantity;
    d.adjustments.unshift({ id: newId('a'), productId: p.id, sku: l.sku, delta: -l.quantity, stockAfter: v ? v.stock : p.stock, reason: 'order_reserved', order: orderNumber, actor, note: null, createdAt: now });
  }
  if (q.couponCode) d.coupons.find((x) => x.code === q.couponCode)!.usedCount++;
  const addr = body.shippingAddress as DOrder['shippingAddress'];
  const order: DOrder = {
    id, orderNumber, user: user?.id ?? null, customer: { name: c.name, email, phone: c.phone },
    shippingAddress: { ...addr, country: 'IN' },
    items: q.lines.map((l) => ({ product: l.productId, variantId: l.variantId, name: l.name, sku: l.sku, variantLabel: l.variantLabel, image: l.image, unitPrice: l.unitPrice, compareAtPrice: l.compareAtPrice, quantity: l.quantity, lineTotal: l.lineTotal })),
    pricing: { subtotal: q.subtotal, discount: q.discount, shipping: q.shipping, codFee: q.codFee, total: q.total },
    coupon: q.couponCode ? { code: q.couponCode, discount: q.discount, released: false } : null,
    payment: { method: 'cod', status: 'cod_pending', razorpayOrderId: null, razorpayPaymentId: null, paidAt: null, amountPaid: 0, amountRefunded: 0, refundReserved: 0 },
    status: 'placed', inventoryState: 'committed',
    timeline: [{ status: 'placed', at: now, actor, note: 'Order placed (Cash on Delivery)' }],
    internalNotes: [], shipment: { courierName: null, trackingNumber: null, trackingUrl: null, shippedAt: null, deliveredAt: null },
    cancellation: null, returnRequest: null, attention: null, customerNote: str(body.customerNote) || null, whatsappOptIn: bool(body.whatsappOptIn),
    trackingToken: `demo-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(0, 32),
    idempotencyKey: str(body.idempotencyKey) || null, transactions: [], createdAt: now, updatedAt: now,
  };
  d.orders.unshift(order);
  if (user && body.saveAddress) {
    const exists = user.addresses.some((a) => a.line1.toLowerCase() === addr.line1.toLowerCase() && a.pincode === addr.pincode);
    if (!exists) user.addresses.push({ ...addr, _id: newId('ad'), country: 'IN', isDefault: user.addresses.length === 0 });
  }
  notify(d, 'order_confirmation', order);
  return { order: customerOrder(d, order), trackingToken: order.trackingToken, payment: null };
}

/* ------------------------------ Dashboard ---------------------------- */

const IST = 5.5 * 3600_000;
const istDay = (ms: number) => new Date(ms + IST).toISOString().slice(0, 10);
function startOfIstDay(now: number, daysAgo: number) {
  const d = new Date(now + IST);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysAgo) - IST;
}
const placedOrder = (o: DOrder) => o.status !== 'pending_payment' && !(o.status === 'cancelled' && o.payment.status === 'failed');

function dashboard(d: DemoDB, days: number) {
  const now = Date.now();
  const start = startOfIstDay(now, days - 1);
  const inRange = d.orders.filter((o) => placedOrder(o) && Date.parse(o.createdAt) >= start);
  const paid = d.orders.filter((o) => o.payment.paidAt && Date.parse(o.payment.paidAt) >= start && o.payment.amountPaid > 0);
  const online = paid.filter((o) => o.payment.method === 'razorpay');
  const cod = paid.filter((o) => o.payment.method === 'cod');
  const sum = (list: DOrder[]) => list.reduce((s, o) => s + o.payment.amountPaid, 0);
  const refunds = d.orders.flatMap((o) => o.transactions).filter((t) => t.type === 'refund' && t.status === 'processed' && Date.parse(t.createdAt) >= start).reduce((s, t) => s + t.amount, 0);
  const gross = sum(online) + sum(cod);
  const count = (...s: string[]) => d.orders.filter((o) => s.includes(o.status)).length;
  const active = d.products.filter((p) => p.status === 'active');
  const top = new Map<string, { sku: string; name: string; quantity: number; revenue: number }>();
  for (const o of inRange.filter((o) => o.status !== 'cancelled')) {
    for (const i of o.items) {
      const t = top.get(i.sku) ?? { sku: i.sku, name: i.name, quantity: 0, revenue: 0 };
      t.quantity += i.quantity;
      t.revenue += i.lineTotal;
      top.set(i.sku, t);
    }
  }
  return {
    range: { days, from: new Date(start).toISOString(), to: new Date(now).toISOString(), timezone: 'Asia/Kolkata' },
    kpis: {
      orders: inRange.length, grossSales: gross, refunds, netSales: gross - refunds, onlineSales: sum(online), codCollected: sum(cod),
      paidOrders: paid.length, averageOrderValue: paid.length ? Math.round(gross / paid.length) : 0,
    },
    pipeline: {
      awaitingPayment: count('pending_payment'), pending: count('placed', 'payment_confirmed'), awaitingShipment: count('processing', 'packed'),
      inTransit: count('shipped', 'out_for_delivery'), completed: count('delivered'), returns: count('return_requested'), cancelled: count('cancelled'),
      needsAttention: d.orders.filter((o) => o.attention).length,
    },
    inventory: {
      lowStock: active.filter((p) => p.stock > 0 && p.stock <= p.lowStockThreshold).length,
      outOfStock: active.filter((p) => p.stock === 0).length,
      items: active.filter((p) => p.stock <= p.lowStockThreshold).sort((a, b) => a.stock - b.stock).slice(0, 8)
        .map((p) => ({ id: p.id, name: p.name, sku: p.sku, stock: p.stock, lowStockThreshold: p.lowStockThreshold, image: p.images[0]?.url ?? null })),
    },
    recentOrders: d.orders.filter(placedOrder).slice(0, 8).map(orderSummary),
    trend: Array.from({ length: days }, (_, i) => {
      const day = istDay(startOfIstDay(now, days - 1 - i));
      return {
        date: day,
        sales: paid.filter((o) => istDay(Date.parse(o.payment.paidAt!)) === day).reduce((s, o) => s + o.payment.amountPaid, 0),
        orders: inRange.filter((o) => istDay(Date.parse(o.createdAt)) === day).length,
      };
    }),
    topProducts: [...top.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5),
    statusLabels: STATUS_LABELS,
  };
}

/* ------------------------------ Router ------------------------------- */

type Handler = (ctx: { d: DemoDB; params: Record<string, string>; q: Query; body: Body }) => unknown;
const routes: [string, RegExp, string[], Handler][] = [];
function route(method: string, pattern: string, handler: Handler) {
  const names: string[] = [];
  const re = new RegExp(`^${pattern.replace(/:([a-zA-Z]+)/g, (_, n) => (names.push(n), '([^/]+)'))}$`);
  routes.push([method, re, names, handler]);
}

/* Auth */
route('GET', '/auth/csrf', () => ({ csrfToken: 'demo' }));
route('GET', '/auth/me', () => ({ user: customer() ? publicUser(customer()!) : null }));
route('POST', '/auth/register', ({ d, body }) => {
  const email = str(body.email).trim().toLowerCase();
  if (d.users.some((u) => u.email === email)) throw err(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
  const u: DUser = { id: newId('u'), name: str(body.name), email, phone: str(body.phone) || null, role: 'customer', passwordHash: demoHash(str(body.password)), isActive: true, whatsappOptIn: false, addresses: [], wishlist: [], createdAt: nowIso(), lastLoginAt: nowIso() };
  d.users.push(u);
  setSession(CUSTOMER_KEY, u.id);
  return { user: publicUser(u) };
});
route('POST', '/auth/login', ({ d, body }) => {
  const u = d.users.find((x) => x.email === str(body.email).trim().toLowerCase());
  if (!u || u.passwordHash !== demoHash(str(body.password))) throw err(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
  if (u.role !== 'customer') throw err(403, 'USE_ADMIN_LOGIN', 'Staff accounts must sign in through the admin portal.');
  if (!u.isActive) throw err(403, 'ACCOUNT_DISABLED', 'This account has been disabled. Please contact support.');
  u.lastLoginAt = nowIso();
  setSession(CUSTOMER_KEY, u.id);
  return { user: publicUser(u) };
});
route('POST', '/auth/logout', () => (setSession(CUSTOMER_KEY, null), { ok: true }));
route('POST', '/auth/forgot-password', () => ({ ok: true, message: 'If an account exists for that email, a reset link has been sent.' }));
route('POST', '/auth/reset-password', () => {
  throw err(400, 'INVALID_RESET_TOKEN', 'Password reset emails are not sent in this demo.');
});
route('POST', '/auth/change-password', ({ body }) => {
  const u = customer();
  if (!u) throw err(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
  if (u.passwordHash !== demoHash(str(body.currentPassword))) throw err(400, 'INVALID_PASSWORD', 'Your current password is incorrect.', { currentPassword: 'Incorrect password' });
  u.passwordHash = demoHash(str(body.newPassword));
  return { ok: true };
});
route('POST', '/auth/admin/login', ({ d, body }) => {
  const u = d.users.find((x) => x.email === str(body.email).trim().toLowerCase());
  if (!u || u.role === 'customer' || u.passwordHash !== demoHash(str(body.password))) throw err(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
  u.lastLoginAt = nowIso();
  setSession(ADMIN_KEY, u.id);
  return { user: publicUser(u), permissions: permissionsFor(u.role) };
});
route('POST', '/auth/admin/logout', () => (setSession(ADMIN_KEY, null), { ok: true }));
route('GET', '/auth/admin/me', () => {
  const u = requireAdmin();
  return { user: publicUser(u), permissions: permissionsFor(u.role) };
});

/* Storefront */
const publicSettings = (d: DemoDB) => ({ ...d.settings, payments: { razorpay: { enabled: false, mode: null }, cod: d.settings.cod.enabled } });
route('GET', '/store/settings', ({ d }) => publicSettings(d));
route('GET', '/home', ({ d }) => {
  const active = activeCategoryIds(d);
  const ok = d.products.filter((p) => sellable(d, p, active));
  const combos = d.categories.find((c) => c.slug === 'budget-combos');
  const comboIds = combos ? withChildren(d, combos.id) : [];
  const by = (list: DProduct[]) => list.slice(0, 8).map((p) => card(d, p));
  const newest = (a: DProduct, b: DProduct) => b.createdAt.localeCompare(a.createdAt);
  return {
    newArrivals: by(ok.filter((p) => p.isNewArrival).sort(newest)),
    bestSellers: by(ok.filter((p) => p.soldCount > 0).sort((a, b) => b.soldCount - a.soldCount)),
    featured: by(ok.filter((p) => p.isFeatured).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))),
    budgetCombos: by(ok.filter((p) => comboIds.includes(p.categoryId)).sort(newest)),
    specialOffers: by(ok.filter((p) => listing(p).isOnSale)),
    categories: categoryTree(d),
    hero: d.settings.hero,
  };
});
route('GET', '/categories', ({ d }) => ({ items: categoryTree(d) }));
route('GET', '/categories/:slug', ({ d, params }) => {
  const c = d.categories.find((x) => x.slug === params.slug);
  const active = activeCategoryIds(d);
  if (!c || !active.has(c.id)) throw notFound('Category');
  const parent = c.parent ? d.categories.find((x) => x.id === c.parent) : null;
  return {
    ...c, productCount: 0,
    parent: parent ? { id: parent.id, name: parent.name, slug: parent.slug } : null,
    children: d.categories.filter((x) => x.parent === c.id && active.has(x.id)).sort((a, b) => a.displayOrder - b.displayOrder).map((x) => ({ id: x.id, name: x.name, slug: x.slug, image: x.image })),
  };
});
route('GET', '/products', ({ d, q }) => listProducts(d, q));
route('GET', '/products/lookup', ({ d, q }) => {
  const ids = str(q.ids).split(',');
  return { items: d.products.filter((p) => ids.includes(p.id) && sellable(d, p)).map((p) => card(d, p)) };
});
route('GET', '/products/:slug', ({ d, params }) => {
  const p = d.products.find((x) => x.slug === params.slug);
  if (!p || !sellable(d, p)) throw notFound('Product');
  return detail(d, p);
});
route('GET', '/products/:slug/related', ({ d, params }) => {
  const p = d.products.find((x) => x.slug === params.slug);
  if (!p || !sellable(d, p)) throw notFound('Product');
  const ok = d.products.filter((x) => x.id !== p.id && sellable(d, x));
  const same = ok.filter((x) => x.categoryId === p.categoryId).sort((a, b) => b.soldCount - a.soldCount);
  const more = ok.filter((x) => x.isFeatured && !same.includes(x));
  return { items: [...same, ...more].slice(0, 8).map((x) => card(d, x)) };
});
route('POST', '/cart/quote', ({ d, body }) => {
  const q = quote(d, { ...body, email: customer()?.email ?? body.email });
  const { couponCode: _c, ...rest } = q;
  void _c;
  return rest;
});
route('POST', '/checkout/orders', ({ d, body }) => placeOrder(d, body));
route('POST', '/payments/razorpay/verify', () => {
  throw err(503, 'PAYMENT_NOT_CONFIGURED', 'Online payment is switched on at launch.');
});
route('POST', '/payments/razorpay/retry', () => {
  throw err(503, 'PAYMENT_NOT_CONFIGURED', 'Online payment is switched on at launch.');
});
route('GET', '/track/:orderNumber', ({ d, params, q }) => {
  const r = ORDER_NO.test(params.orderNumber.toUpperCase()) ? accessibleOrder(d, params.orderNumber, str(q.token) || undefined) : null;
  if (!r) throw notFound('Order');
  return { order: customerOrder(d, r.o, !r.owner) };
});
route('POST', '/track/:orderNumber/cancel', ({ d, params, body }) => {
  const r = accessibleOrder(d, params.orderNumber, str(body.token) || undefined);
  if (!r) throw notFound('Order');
  const u = customer();
  cancelOrder(d, r.o, u ? { type: 'customer', id: u.id, name: u.name } : { type: 'customer', id: null, name: 'Guest' }, str(body.reason), CANCELLABLE_BY_CUSTOMER);
  return { order: customerOrder(d, r.o, !r.owner) };
});
route('POST', '/track/:orderNumber/return', ({ d, params, body }) => {
  const r = accessibleOrder(d, params.orderNumber, str(body.token) || undefined);
  if (!r) throw notFound('Order');
  const o = r.o;
  const days = d.settings.returns.windowDays;
  if (o.status !== 'delivered' || !o.shipment.deliveredAt) throw err(409, 'INVALID_TRANSITION', 'Returns can be requested only for delivered orders.');
  if (days <= 0 || Date.now() - Date.parse(o.shipment.deliveredAt) > days * 86400_000) throw err(409, 'RETURN_WINDOW_CLOSED', `The ${days}-day return window for this order has closed.`);
  if (str(body.reason).trim().length < 10) throw err(400, 'VALIDATION_ERROR', 'Some fields are invalid.', { reason: 'Please describe the issue (at least 10 characters)' });
  const at = nowIso();
  const u = customer();
  o.status = 'return_requested';
  o.returnRequest = { reason: str(body.reason), requestedAt: at };
  o.timeline.push({ status: 'return_requested', at, actor: { type: 'customer', id: u?.id ?? null, name: u?.name ?? 'Guest' }, note: 'Return requested' });
  return { order: customerOrder(d, o, !r.owner) };
});
route('POST', '/contact', ({ d, body }) => {
  if (body.website) return { ok: true };
  d.messages.unshift({ id: newId('m'), name: str(body.name), email: str(body.email), phone: str(body.phone) || null, subject: str(body.subject), message: str(body.message), status: 'new', createdAt: nowIso() });
  return { ok: true };
});

/* Account */
function me() {
  const u = customer();
  if (!u) throw err(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
  return u;
}
route('GET', '/account/profile', () => ({ user: publicUser(me()), addresses: me().addresses }));
route('PATCH', '/account/profile', ({ body }) => {
  const u = me();
  u.name = str(body.name) || u.name;
  u.phone = str(body.phone) || null;
  if (typeof body.whatsappOptIn === 'boolean') u.whatsappOptIn = body.whatsappOptIn;
  return { user: publicUser(u) };
});
route('GET', '/account/addresses', () => ({ items: me().addresses }));
route('POST', '/account/addresses', ({ body }) => {
  const u = me();
  const makeDefault = !!body.isDefault || u.addresses.length === 0;
  if (makeDefault) u.addresses.forEach((a) => (a.isDefault = false));
  u.addresses.push({ ...(body as unknown as DUser['addresses'][number]), _id: newId('ad'), country: 'IN', isDefault: makeDefault });
  return { items: u.addresses };
});
route('PUT', '/account/addresses/:id', ({ params, body }) => {
  const u = me();
  const i = u.addresses.findIndex((a) => a._id === params.id);
  if (i < 0) throw notFound('Address');
  if (body.isDefault) u.addresses.forEach((a) => (a.isDefault = false));
  u.addresses[i] = { ...u.addresses[i], ...(body as object), _id: params.id, isDefault: body.isDefault === undefined ? u.addresses[i].isDefault : !!body.isDefault };
  return { items: u.addresses };
});
route('DELETE', '/account/addresses/:id', ({ params }) => {
  const u = me();
  const removed = u.addresses.find((a) => a._id === params.id);
  if (!removed) throw notFound('Address');
  u.addresses = u.addresses.filter((a) => a._id !== params.id);
  if (removed.isDefault && u.addresses[0]) u.addresses[0].isDefault = true;
  return { items: u.addresses };
});
route('GET', '/account/wishlist', ({ d }) => {
  const u = me();
  return { items: d.products.filter((p) => u.wishlist.includes(p.id) && sellable(d, p)).map((p) => card(d, p)), productIds: u.wishlist };
});
route('PUT', '/account/wishlist', ({ d, body }) => {
  const u = me();
  u.wishlist = ((body.productIds as string[]) ?? []).filter((id) => d.products.some((p) => p.id === id));
  return { productIds: u.wishlist };
});
route('GET', '/account/orders', ({ d, q }) => {
  const u = me();
  const page = paginate(d.orders.filter((o) => o.user === u.id), q, 20);
  return { items: page.items.map((o) => customerOrder(d, o)), meta: page.meta };
});
route('GET', '/account/orders/:orderNumber', ({ d, params }) => {
  const u = me();
  const o = d.orders.find((x) => x.orderNumber === params.orderNumber.toUpperCase() && x.user === u.id);
  if (!o) throw notFound('Order');
  return { order: customerOrder(d, o) };
});

/* Admin: dashboard & products */
route('GET', '/admin/dashboard', ({ d, q }) => (requireAdmin('dashboard:read'), dashboard(d, [7, 30, 90].includes(num(q.range, 30)) ? num(q.range, 30) : 30)));
route('GET', '/admin/products', ({ d, q }) => {
  requireAdmin('products:read');
  const term = str(q.q).toLowerCase();
  let list = d.products.filter((p) => !term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || p.tags.some((t) => t.includes(term)) || p.variants.some((v) => v.sku.toLowerCase().includes(term)));
  if (q.category) list = list.filter((p) => p.categoryId === q.category);
  if (q.status) list = list.filter((p) => p.status === q.status);
  if (q.stock === 'out') list = list.filter((p) => p.stock === 0);
  if (q.stock === 'in') list = list.filter((p) => p.stock > 0);
  if (q.stock === 'low') list = list.filter((p) => p.stock > 0 && p.stock <= p.lowStockThreshold);
  const sorts: Record<string, (a: DProduct, b: DProduct) => number> = {
    newest: (a, b) => b.createdAt.localeCompare(a.createdAt), oldest: (a, b) => a.createdAt.localeCompare(b.createdAt), name: (a, b) => a.name.localeCompare(b.name),
    price_asc: (a, b) => listing(a).sellingPrice - listing(b).sellingPrice, price_desc: (a, b) => listing(b).sellingPrice - listing(a).sellingPrice,
    stock_asc: (a, b) => a.stock - b.stock, stock_desc: (a, b) => b.stock - a.stock, popular: (a, b) => b.soldCount - a.soldCount,
  };
  list.sort(sorts[str(q.sort)] ?? sorts.newest);
  const page = paginate(list, q, 25);
  return { items: page.items.map((p) => adminProduct(d, p)), meta: page.meta };
});
route('GET', '/admin/products/:id', ({ d, params }) => {
  requireAdmin('products:read');
  const p = d.products.find((x) => x.id === params.id);
  if (!p) throw notFound('Product');
  return adminProduct(d, p);
});
function saveProduct(d: DemoDB, body: Body, existing: DProduct | null) {
  const u = requireAdmin('products:write');
  const sku = str(body.sku).toUpperCase();
  const variantsIn = (body.variants as (Partial<DVariant> & { _id?: string })[]) ?? [];
  const skus = [sku, ...variantsIn.map((v) => str(v.sku).toUpperCase())];
  const clash = d.products.find((p) => p.id !== existing?.id && (skus.includes(p.sku) || p.variants.some((v) => skus.includes(v.sku))));
  if (clash) throw err(409, 'SKU_TAKEN', `SKU is already used by "${clash.name}".`, { sku: 'Already in use' });
  const slugBase = str(body.slug) || str(body.name).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let slug = existing && !body.slug ? existing.slug : slugBase;
  for (let i = 2; d.products.some((p) => p.slug === slug && p.id !== existing?.id); i++) slug = `${slugBase}-${i}`;
  const actor = adminActor(u);
  const now = nowIso();
  const variants: DVariant[] = variantsIn.map((v) => {
    const prev = v._id ? existing?.variants.find((x) => x.id === v._id) : undefined;
    const id = prev?.id ?? newId('v');
    const stock = prev ? prev.stock : num(v.stock, 0);
    if (!prev && stock > 0) d.adjustments.unshift({ id: newId('a'), productId: existing?.id ?? 'pending', sku: str(v.sku).toUpperCase(), delta: stock, stockAfter: stock, reason: 'initial_stock', order: null, actor, note: null, createdAt: now });
    return { id, sku: str(v.sku).toUpperCase(), label: str(v.label), price: v.price ?? null, salePrice: v.salePrice ?? null, stock, isActive: v.isActive !== false };
  });
  const stock = variants.length ? variants.reduce((s, v) => s + v.stock, 0) : existing ? (existing.variants.length ? 0 : existing.stock) : num(body.stock, 0);
  const p: DProduct = {
    id: existing?.id ?? newId('p'), name: str(body.name), slug, sku, description: str(body.description), shortDescription: str(body.shortDescription),
    categoryId: str(body.category), tags: (body.tags as string[]) ?? [], images: (body.images as DProduct['images']) ?? [],
    price: num(body.price), salePrice: body.salePrice == null ? null : num(body.salePrice), stock, lowStockThreshold: num(body.lowStockThreshold, 5),
    attributes: (body.attributes as DProduct['attributes']) ?? [], variants, isFeatured: !!body.isFeatured, isNewArrival: !!body.isNewArrival,
    status: (str(body.status) || 'draft') as DProduct['status'], soldCount: existing?.soldCount ?? 0, isSample: existing?.isSample ?? false,
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  };
  d.adjustments.forEach((a) => a.productId === 'pending' && (a.productId = p.id));
  if (!existing && !variants.length && stock > 0) d.adjustments.unshift({ id: newId('a'), productId: p.id, sku, delta: stock, stockAfter: stock, reason: 'initial_stock', order: null, actor, note: null, createdAt: now });
  if (existing) d.products[d.products.findIndex((x) => x.id === existing.id)] = p;
  else d.products.unshift(p);
  return adminProduct(d, p);
}
route('POST', '/admin/products', ({ d, body }) => saveProduct(d, body, null));
route('PUT', '/admin/products/:id', ({ d, params, body }) => {
  const p = d.products.find((x) => x.id === params.id);
  if (!p) throw notFound('Product');
  return saveProduct(d, body, p);
});
route('PATCH', '/admin/products/:id/status', ({ d, params, body }) => {
  requireAdmin('products:write');
  const p = d.products.find((x) => x.id === params.id);
  if (!p) throw notFound('Product');
  p.status = str(body.status) as DProduct['status'];
  p.updatedAt = nowIso();
  return adminProduct(d, p);
});
route('DELETE', '/admin/products/:id', ({ d, params }) => {
  requireAdmin('products:delete');
  const p = d.products.find((x) => x.id === params.id);
  if (!p) throw notFound('Product');
  if (d.orders.some((o) => o.items.some((i) => i.product === p.id))) throw err(409, 'PRODUCT_HAS_ORDERS', 'This product appears on existing orders, so it cannot be deleted. Archive it instead.');
  d.products = d.products.filter((x) => x.id !== p.id);
  return { deleted: true };
});

/* Admin: categories, media, inventory */
route('GET', '/admin/categories', ({ d }) => {
  requireAdmin('categories:read');
  return {
    items: [...d.categories].sort((a, b) => a.displayOrder - b.displayOrder).map((c) => ({
      ...c,
      productCount: d.products.filter((p) => p.categoryId === c.id).length,
      activeProductCount: d.products.filter((p) => p.categoryId === c.id && p.status === 'active').length,
    })),
  };
});
function saveCategory(d: DemoDB, body: Body, existing: DCategory | null) {
  requireAdmin('categories:write');
  const base = str(body.slug) || str(body.name).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const slug = existing && !body.slug ? existing.slug : base;
  if (d.categories.some((c) => c.slug === slug && c.id !== existing?.id)) throw err(409, 'SLUG_TAKEN', 'A category with this slug already exists.', { slug: 'Already in use' });
  const parent = body.parent ? str(body.parent) : null;
  if (parent && d.categories.find((c) => c.id === parent)?.parent) throw err(400, 'BAD_REQUEST', 'Sub-categories cannot have their own sub-categories.', { parent: 'Choose a top-level category' });
  const c: DCategory = {
    id: existing?.id ?? newId('c'), name: str(body.name), slug, description: str(body.description), image: (body.image as DCategory['image']) ?? existing?.image ?? null,
    parent, isActive: body.isActive !== false, displayOrder: num(body.displayOrder), createdAt: existing?.createdAt ?? nowIso(), updatedAt: nowIso(),
  };
  if (existing) d.categories[d.categories.findIndex((x) => x.id === existing.id)] = c;
  else d.categories.push(c);
  return c;
}
route('POST', '/admin/categories', ({ d, body }) => saveCategory(d, body, null));
route('PUT', '/admin/categories/:id', ({ d, params, body }) => {
  const c = d.categories.find((x) => x.id === params.id);
  if (!c) throw notFound('Category');
  return saveCategory(d, body, c);
});
route('DELETE', '/admin/categories/:id', ({ d, params, q }) => {
  requireAdmin('categories:delete');
  const c = d.categories.find((x) => x.id === params.id);
  if (!c) throw notFound('Category');
  if (d.categories.some((x) => x.parent === c.id)) throw err(409, 'CATEGORY_HAS_CHILDREN', 'Move or delete the sub-categories first.');
  const inCat = d.products.filter((p) => p.categoryId === c.id);
  if (inCat.length && !q.reassignTo) throw err(409, 'CATEGORY_HAS_PRODUCTS', `This category contains ${inCat.length} product(s). Choose another category to move them to before deleting.`);
  inCat.forEach((p) => (p.categoryId = str(q.reassignTo)));
  d.categories = d.categories.filter((x) => x.id !== c.id);
  return { deleted: true, movedProducts: inCat.length };
});
route('POST', '/admin/uploads/images', () => {
  requireAdmin('media:upload');
  throw err(503, 'UPLOADS_NOT_CONFIGURED', 'Image uploads are switched off in this demo — they go to Cloudinary once it is connected at launch.');
});
route('GET', '/admin/inventory', ({ d, q }) => {
  requireAdmin('inventory:read');
  const term = str(q.q).toLowerCase();
  let list = d.products.filter((p) => p.status !== 'archived' && (!term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || p.variants.some((v) => v.sku.toLowerCase().includes(term))));
  if (q.stock === 'out') list = list.filter((p) => p.stock === 0);
  if (q.stock === 'in') list = list.filter((p) => p.stock > 0);
  if (q.stock === 'low') list = list.filter((p) => p.stock > 0 && p.stock <= p.lowStockThreshold);
  list.sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name));
  const page = paginate(list, q, 25);
  return {
    items: page.items.map((p) => ({
      id: p.id, name: p.name, sku: p.sku, status: p.status, stock: p.stock, lowStockThreshold: p.lowStockThreshold, image: p.images[0]?.url ?? null,
      category: d.categories.find((c) => c.id === p.categoryId)?.name ?? null, stockState: p.stock === 0 ? 'out' : p.stock <= p.lowStockThreshold ? 'low' : 'in',
      variants: p.variants.map((v) => ({ id: v.id, sku: v.sku, label: v.label, stock: v.stock, isActive: v.isActive })),
    })),
    meta: page.meta,
    reasons: ['restock', 'correction', 'damaged', 'lost', 'other'],
  };
});
route('POST', '/admin/inventory/:id/adjust', ({ d, params, body }) => {
  const u = requireAdmin('inventory:write');
  const p = d.products.find((x) => x.id === params.id);
  if (!p) throw notFound('Product');
  const v = body.variantId ? p.variants.find((x) => x.id === body.variantId) : null;
  if (p.variants.length && !v) throw err(409, 'VARIANT_REQUIRED', 'Choose which variant to adjust.');
  const current = v ? v.stock : p.stock;
  const delta = body.mode === 'set' ? num(body.quantity) - current : num(body.quantity);
  if (current + delta < 0) throw err(409, 'NEGATIVE_STOCK', `Stock cannot go below zero (currently ${current}).`, { quantity: 'Too large' });
  if (v) v.stock += delta;
  p.stock = p.variants.length ? p.variants.reduce((s, x) => s + x.stock, 0) : p.stock + delta;
  const after = v ? v.stock : p.stock;
  if (delta) d.adjustments.unshift({ id: newId('a'), productId: p.id, sku: v?.sku ?? p.sku, delta, stockAfter: after, reason: str(body.reason), order: null, actor: adminActor(u), note: str(body.note) || null, createdAt: nowIso() });
  return { stock: after, delta };
});
route('GET', '/admin/inventory/adjustments', ({ d, q }) => {
  requireAdmin('inventory:read');
  let list = d.adjustments;
  if (q.product) list = list.filter((a) => a.productId === q.product);
  if (q.reason) list = list.filter((a) => a.reason === q.reason);
  const page = paginate([...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), q, 30);
  return {
    items: page.items.map((a) => {
      const p = d.products.find((x) => x.id === a.productId);
      return { ...a, product: p ? { id: p.id, name: p.name } : null };
    }),
    meta: page.meta,
  };
});

/* Admin: orders */
function findOrder(d: DemoDB, id: string) {
  const o = d.orders.find((x) => x.id === id);
  if (!o) throw notFound('Order');
  return o;
}
route('GET', '/admin/orders', ({ d, q }) => {
  requireAdmin('orders:read');
  const term = str(q.q).trim().toLowerCase();
  let list = d.orders.filter((o) => !term || o.orderNumber.toLowerCase().startsWith(term) || o.customer.email.includes(term) || o.customer.name.toLowerCase().includes(term) || o.customer.phone.includes(term) || o.shipment.trackingNumber?.toLowerCase() === term);
  if (q.status) list = list.filter((o) => o.status === q.status);
  if (q.paymentStatus) list = list.filter((o) => o.payment.status === q.paymentStatus);
  if (q.paymentMethod) list = list.filter((o) => o.payment.method === q.paymentMethod);
  if (bool(q.attention)) list = list.filter((o) => o.attention);
  if (q.from) list = list.filter((o) => istDay(Date.parse(o.createdAt)) >= str(q.from));
  if (q.to) list = list.filter((o) => istDay(Date.parse(o.createdAt)) <= str(q.to));
  const page = paginate(list, q, 25);
  return { items: page.items.map(orderSummary), meta: page.meta };
});
route('GET', '/admin/orders/:id', ({ d, params }) => (requireAdmin('orders:read'), adminOrder(d, findOrder(d, params.id))));
route('POST', '/admin/orders/:id/status', ({ d, params, body }) => {
  const u = requireAdmin('orders:write');
  const o = findOrder(d, params.id);
  const to = str(body.status);
  if (['cancelled', 'payment_confirmed', 'refunded', 'returned'].includes(to)) throw err(400, 'BAD_REQUEST', 'Use the dedicated action for this status.');
  if (!(ADMIN_TRANSITIONS[o.status] ?? []).includes(to)) throw err(409, 'INVALID_TRANSITION', `Cannot change status from "${STATUS_LABELS[o.status]}" to "${STATUS_LABELS[to]}".`);
  const at = nowIso();
  const shipment = body.shipment as { courierName: string; trackingNumber: string; trackingUrl?: string } | undefined;
  if (to === 'shipped') {
    if (shipment) Object.assign(o.shipment, { courierName: shipment.courierName, trackingNumber: shipment.trackingNumber, trackingUrl: shipment.trackingUrl ?? null });
    if (!o.shipment.courierName || !o.shipment.trackingNumber) throw err(422, 'SHIPMENT_REQUIRED', 'Add the courier name and tracking number before marking the order as shipped.');
    o.shipment.shippedAt = at;
  }
  if (to === 'delivered') o.shipment.deliveredAt = at;
  if (to === 'return_requested') o.returnRequest = { reason: str(body.note) || 'Requested via support', requestedAt: at };
  o.status = to;
  o.timeline.push({ status: to, at, actor: adminActor(u), note: str(body.note) || undefined });
  o.updatedAt = at;
  if (to === 'shipped') notify(d, 'shipment', o);
  if (to === 'out_for_delivery' || to === 'delivered') notify(d, 'delivery_update', o);
  return adminOrder(d, o);
});
route('PUT', '/admin/orders/:id/shipment', ({ d, params, body }) => {
  const u = requireAdmin('orders:write');
  const o = findOrder(d, params.id);
  if (!SHIPMENT_EDITABLE.includes(o.status)) throw err(409, 'INVALID_STATE', 'Tracking details can only be edited while the order is being processed or in transit.');
  Object.assign(o.shipment, { courierName: str(body.courierName), trackingNumber: str(body.trackingNumber), trackingUrl: str(body.trackingUrl) || null });
  o.internalNotes.push({ note: `Tracking set: ${str(body.courierName)} ${str(body.trackingNumber)}`, at: nowIso(), by: u.name });
  return adminOrder(d, o);
});
route('POST', '/admin/orders/:id/notes', ({ d, params, body }) => {
  const u = requireAdmin('orders:write');
  const o = findOrder(d, params.id);
  o.internalNotes.push({ note: str(body.note), at: nowIso(), by: u.name });
  return adminOrder(d, o);
});
route('POST', '/admin/orders/:id/clear-attention', ({ d, params }) => {
  const u = requireAdmin('orders:write');
  const o = findOrder(d, params.id);
  o.attention = null;
  o.internalNotes.push({ note: 'Attention flag cleared', at: nowIso(), by: u.name });
  return adminOrder(d, o);
});
route('POST', '/admin/orders/:id/cancel', ({ d, params, body }) => {
  const u = requireAdmin('orders:cancel');
  const o = findOrder(d, params.id);
  cancelOrder(d, o, adminActor(u), str(body.reason), CANCELLABLE_BY_ADMIN);
  return adminOrder(d, o);
});
route('POST', '/admin/orders/:id/return', ({ d, params, body }) => {
  const u = requireAdmin('orders:write');
  const o = findOrder(d, params.id);
  if (o.status !== 'return_requested') throw err(409, 'INVALID_TRANSITION', 'This order has no open return request.');
  const at = nowIso();
  const approve = !!body.approve;
  o.status = approve ? 'returned' : 'delivered';
  o.returnRequest = { ...o.returnRequest!, resolvedAt: at, resolution: approve ? 'approved' : 'rejected' };
  if (approve && o.payment.amountPaid - o.payment.amountRefunded > 0) o.attention = { reason: 'Refund required — return received.', at };
  o.timeline.push({ status: o.status, at, actor: adminActor(u), note: str(body.note) || (approve ? 'Return received' : 'Return request declined') });
  if (approve && body.restock !== false) restock(d, o, 'return_restock', adminActor(u));
  return adminOrder(d, o);
});
route('POST', '/admin/orders/:id/cod-collected', ({ d, params, body }) => {
  const u = requireAdmin('orders:write');
  const o = findOrder(d, params.id);
  if (!(o.payment.method === 'cod' && o.payment.status === 'cod_pending' && ['shipped', 'out_for_delivery', 'delivered'].includes(o.status))) {
    throw err(409, 'INVALID_STATE', 'COD payment can be recorded only for shipped/delivered COD orders that are not yet paid.');
  }
  const at = nowIso();
  Object.assign(o.payment, { status: 'paid', paidAt: at, amountPaid: o.pricing.total });
  o.transactions.push({ id: newId('t'), provider: 'cod', type: 'payment', status: 'recorded', amount: o.pricing.total, providerOrderId: null, providerPaymentId: null, providerRefundId: null, method: 'cod', verifiedVia: ['manual'], errorDescription: null, reference: str(body.reference) || null, createdAt: at });
  o.internalNotes.push({ note: `COD payment recorded${body.reference ? ` (ref: ${str(body.reference)})` : ''}`, at, by: u.name });
  return adminOrder(d, o);
});
route('POST', '/admin/orders/:id/refunds', () => {
  requireAdmin('orders:refund');
  throw err(503, 'PAYMENT_NOT_CONFIGURED', 'Razorpay refunds are issued through Razorpay once it is connected at launch — this demo has no real payments.');
});
route('POST', '/admin/orders/:id/manual-refunds', ({ d, params, body }) => {
  const u = requireAdmin('orders:refund');
  const o = findOrder(d, params.id);
  const amount = num(body.amount);
  if (o.payment.method !== 'cod') throw err(422, 'REFUND_NOT_ALLOWED', 'Online payments must be refunded through Razorpay.');
  if (!['cancelled', 'returned'].includes(o.status) || o.payment.amountRefunded + amount > o.payment.amountPaid) throw err(409, 'REFUND_NOT_ALLOWED', 'Refund amount exceeds what can still be refunded.');
  const at = nowIso();
  o.payment.amountRefunded += amount;
  o.payment.status = o.payment.amountRefunded >= o.payment.amountPaid ? 'refunded' : 'partially_refunded';
  o.transactions.push({ id: newId('t'), provider: 'manual', type: 'refund', status: 'processed', amount, providerOrderId: null, providerPaymentId: null, providerRefundId: null, method: null, verifiedVia: ['manual'], errorDescription: null, reference: str(body.reference), createdAt: at });
  if (o.payment.status === 'refunded') {
    o.status = 'refunded';
    o.attention = null;
    o.timeline.push({ status: 'refunded', at, actor: { type: 'system', id: null, name: 'System' }, note: 'Refund processed' });
  }
  o.internalNotes.push({ note: `Manual refund recorded ₹${(amount / 100).toFixed(2)} (ref: ${str(body.reference)})`, at, by: u.name });
  notify(d, 'refund', o);
  return { refund: { status: 'processed', amount }, order: adminOrder(d, o) };
});

/* Admin: customers, coupons, logs, settings */
route('GET', '/admin/customers', ({ d, q }) => {
  requireAdmin('customers:read');
  const term = str(q.q).toLowerCase();
  let list = d.users.filter((u) => u.role === 'customer' && (!term || u.name.toLowerCase().includes(term) || u.email.includes(term) || (u.phone ?? '').includes(term)));
  if (q.status) list = list.filter((u) => u.isActive === (q.status === 'active'));
  const page = paginate(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), q, 25);
  return {
    items: page.items.map((u) => {
      const os = d.orders.filter((o) => o.user === u.id && o.status !== 'pending_payment');
      return { id: u.id, name: u.name, email: u.email, phone: u.phone, isActive: u.isActive, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, orders: os.length, totalSpent: os.reduce((s, o) => s + o.payment.amountPaid - o.payment.amountRefunded, 0), lastOrderAt: os[0]?.createdAt ?? null };
    }),
    meta: page.meta,
  };
});
route('GET', '/admin/customers/:id', ({ d, params }) => {
  requireAdmin('customers:read');
  const u = d.users.find((x) => x.id === params.id && x.role === 'customer');
  if (!u) throw notFound('Customer');
  const os = d.orders.filter((o) => o.user === u.id);
  const counted = os.filter((o) => o.status !== 'pending_payment');
  return {
    id: u.id, name: u.name, email: u.email, phone: u.phone, isActive: u.isActive, whatsappOptIn: u.whatsappOptIn, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, addresses: u.addresses,
    stats: { orders: counted.length, totalSpent: counted.reduce((s, o) => s + o.payment.amountPaid - o.payment.amountRefunded, 0), lastOrderAt: counted[0]?.createdAt ?? null },
    orders: os.map(orderSummary),
  };
});
route('PATCH', '/admin/customers/:id/status', ({ d, params, body }) => {
  requireAdmin('customers:write');
  const u = d.users.find((x) => x.id === params.id && x.role === 'customer');
  if (!u) throw notFound('Customer');
  u.isActive = !!body.isActive;
  return { id: u.id, isActive: u.isActive };
});
const couponState = (c: DemoDB['coupons'][number]) => {
  const now = Date.now();
  if (!c.isActive) return 'inactive';
  if (c.expiresAt && Date.parse(c.expiresAt) <= now) return 'expired';
  if (c.startsAt && Date.parse(c.startsAt) > now) return 'scheduled';
  if (c.usageLimit != null && c.usedCount >= c.usageLimit) return 'exhausted';
  return 'active';
};
route('GET', '/admin/coupons', ({ d, q }) => {
  requireAdmin('coupons:read');
  const page = paginate(d.coupons, q, 100);
  return { items: page.items.map((c) => ({ ...c, state: couponState(c) })), meta: page.meta };
});
function saveCoupon(d: DemoDB, body: Body, existing: DemoDB['coupons'][number] | null) {
  requireAdmin('coupons:write');
  const code = str(body.code).toUpperCase();
  if (d.coupons.some((c) => c.code === code && c.id !== existing?.id)) throw err(409, 'CODE_TAKEN', 'A coupon with this code already exists.', { code: 'Already exists' });
  const c = {
    id: existing?.id ?? newId('k'), code, description: str(body.description), type: (body.type as 'percent' | 'fixed') ?? 'percent', value: num(body.value),
    maxDiscount: (body.maxDiscount as number | null) ?? null, minOrderValue: num(body.minOrderValue), startsAt: (body.startsAt as string | null) ?? null,
    expiresAt: (body.expiresAt as string | null) ?? null, usageLimit: (body.usageLimit as number | null) ?? null, perCustomerLimit: (body.perCustomerLimit as number | null) ?? null,
    usedCount: existing?.usedCount ?? 0, isActive: body.isActive !== false, createdAt: existing?.createdAt ?? nowIso(),
  };
  if (existing) d.coupons[d.coupons.findIndex((x) => x.id === existing.id)] = c;
  else d.coupons.unshift(c);
  return { ...c, state: couponState(c) };
}
route('POST', '/admin/coupons', ({ d, body }) => saveCoupon(d, body, null));
route('PUT', '/admin/coupons/:id', ({ d, params, body }) => {
  const c = d.coupons.find((x) => x.id === params.id);
  if (!c) throw notFound('Coupon');
  return saveCoupon(d, body, c);
});
route('DELETE', '/admin/coupons/:id', ({ d, params }) => {
  requireAdmin('coupons:write');
  const c = d.coupons.find((x) => x.id === params.id);
  if (!c) throw notFound('Coupon');
  if (c.usedCount > 0) throw err(409, 'COUPON_IN_USE', 'This coupon has been used on orders. Deactivate it instead of deleting.');
  d.coupons = d.coupons.filter((x) => x.id !== c.id);
  return { deleted: true };
});
route('GET', '/admin/notifications', ({ d, q }) => {
  requireAdmin('notifications:read');
  let list = d.notifications;
  if (q.status) list = list.filter((n) => n.status === q.status);
  if (q.channel) list = list.filter((n) => n.channel === q.channel);
  const page = paginate(list, q, 30);
  return { items: page.items.map((n) => ({ ...n, order: n.orderNumber })), meta: page.meta };
});
route('GET', '/admin/messages', ({ d, q }) => {
  requireAdmin('messages:read');
  const list = q.status ? d.messages.filter((m) => m.status === q.status) : d.messages;
  const page = paginate(list, q, 20);
  return { items: page.items, meta: { ...page.meta, unread: d.messages.filter((m) => m.status === 'new').length } };
});
route('PATCH', '/admin/messages/:id', ({ d, params, body }) => {
  requireAdmin('messages:write');
  const m = d.messages.find((x) => x.id === params.id);
  if (!m) throw notFound('Message');
  m.status = str(body.status) as typeof m.status;
  return { id: m.id, status: m.status };
});
const DEMO_REASON = 'Demo site — connected at launch with the owner’s own account.';
const integrations = () => ({
  razorpay: { configured: false, reason: DEMO_REASON },
  cloudinary: { configured: false, reason: DEMO_REASON },
  email: { configured: false, reason: `${DEMO_REASON} Until then emails are logged as skipped.` },
  whatsapp: { configured: false, reason: 'No WhatsApp Business provider is integrated yet.' },
  courier: { configured: false, reason: 'No courier API is integrated. Tracking updates are entered manually.' },
});
route('GET', '/admin/settings', ({ d }) => (requireAdmin('settings:read'), { settings: d.settings, integrations: integrations() }));
route('PUT', '/admin/settings', ({ d, body }) => {
  requireAdmin('settings:write');
  d.settings = { ...d.settings, ...(body as Partial<typeof d.settings>) };
  return { settings: d.settings, integrations: integrations() };
});

/* ------------------------------ Entry -------------------------------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function demoRequest<T>(method: string, path: string, query?: Query, body?: unknown): Promise<T> {
  // A short, realistic delay so loading states are visible as they would be live.
  await sleep(method === 'GET' ? 120 : 220);
  const d = load();
  for (const [m, re, names, handler] of routes) {
    if (m !== method) continue;
    const match = re.exec(path);
    if (!match) continue;
    const params = Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(match[i + 1])]));
    const result = handler({ d, params, q: query ?? {}, body: body instanceof FormData ? {} : ((body ?? {}) as Body) });
    if (method !== 'GET') save();
    return structuredClone(result) as T;
  }
  throw err(404, 'NOT_FOUND', `No route for ${method} ${path}`);
}

export { DEMO_ACCOUNTS };

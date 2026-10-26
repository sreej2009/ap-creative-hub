/**
 * DEMO ONLY — sample catalogue and clearly sample orders for the static
 * GitHub Pages demo. Nothing here is used by the real production build.
 * Money is integer paise, like the real API.
 */

export const BASE = import.meta.env.BASE_URL;
const img = (name: string) => `${BASE}samples/${name}.svg`;

export type Role = 'customer' | 'staff' | 'admin';
export interface Actor {
  type: 'system' | 'customer' | 'admin' | 'staff';
  id: string | null;
  name?: string;
}

export interface DCategory {
  id: string;
  name: string;
  slug: string;
  description: string;
  image: { url: string; alt?: string } | null;
  parent: string | null;
  isActive: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface DVariant {
  id: string;
  sku: string;
  label: string;
  price: number | null;
  salePrice: number | null;
  stock: number;
  isActive: boolean;
}

export interface DProduct {
  id: string;
  name: string;
  slug: string;
  sku: string;
  description: string;
  shortDescription: string;
  categoryId: string;
  tags: string[];
  images: { url: string; alt?: string; publicId?: string }[];
  price: number;
  salePrice: number | null;
  stock: number;
  lowStockThreshold: number;
  attributes: { name: string; value: string }[];
  variants: DVariant[];
  isFeatured: boolean;
  isNewArrival: boolean;
  status: 'draft' | 'active' | 'archived';
  soldCount: number;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DAddress {
  _id: string;
  label?: string;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  isDefault: boolean;
}

export interface DUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  passwordHash: string;
  isActive: boolean;
  whatsappOptIn: boolean;
  addresses: DAddress[];
  wishlist: string[];
  createdAt: string;
  lastLoginAt: string | null;
}

export interface DOrderItem {
  product: string;
  variantId: string | null;
  name: string;
  sku: string;
  variantLabel: string | null;
  image: string | null;
  unitPrice: number;
  compareAtPrice: number | null;
  quantity: number;
  lineTotal: number;
}

export interface DTxn {
  id: string;
  provider: 'razorpay' | 'cod' | 'manual';
  type: 'payment' | 'refund';
  status: string;
  amount: number;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  providerRefundId: string | null;
  method: string | null;
  verifiedVia: string[];
  errorDescription: string | null;
  reference: string | null;
  createdAt: string;
}

export interface DOrder {
  id: string;
  orderNumber: string;
  user: string | null;
  customer: { name: string; email: string; phone: string };
  shippingAddress: { fullName: string; phone: string; line1: string; line2?: string; landmark?: string; city: string; state: string; pincode: string; country: string };
  items: DOrderItem[];
  pricing: { subtotal: number; discount: number; shipping: number; codFee: number; total: number };
  coupon: { code: string; discount: number; released: boolean } | null;
  payment: {
    method: 'razorpay' | 'cod';
    status: string;
    razorpayOrderId: string | null;
    razorpayPaymentId: string | null;
    paidAt: string | null;
    amountPaid: number;
    amountRefunded: number;
    refundReserved: number;
  };
  status: string;
  inventoryState: 'reserved' | 'committed' | 'released';
  timeline: { status: string; at: string; actor: Actor; note?: string }[];
  internalNotes: { note: string; at: string; by: string }[];
  shipment: { courierName: string | null; trackingNumber: string | null; trackingUrl: string | null; shippedAt: string | null; deliveredAt: string | null };
  cancellation: { reason: string; at: string; by: Actor } | null;
  returnRequest: { reason: string; requestedAt: string; resolvedAt?: string | null; resolution?: string | null } | null;
  attention: { reason: string; at: string } | null;
  customerNote: string | null;
  whatsappOptIn: boolean;
  trackingToken: string;
  idempotencyKey: string | null;
  transactions: DTxn[];
  createdAt: string;
  updatedAt: string;
}

export interface DCoupon {
  id: string;
  code: string;
  description: string;
  type: 'percent' | 'fixed';
  value: number;
  maxDiscount: number | null;
  minOrderValue: number;
  startsAt: string | null;
  expiresAt: string | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  usedCount: number;
  isActive: boolean;
  createdAt: string;
}

export interface DAdjustment {
  id: string;
  productId: string;
  sku: string;
  delta: number;
  stockAfter: number;
  reason: string;
  order: string | null;
  actor: { type: string; name?: string };
  note: string | null;
  createdAt: string;
}

export interface DMessage {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string;
  message: string;
  status: 'new' | 'read' | 'resolved';
  createdAt: string;
}

export interface DNotification {
  id: string;
  event: string;
  channel: 'email' | 'whatsapp';
  recipient: string;
  status: 'sent' | 'failed' | 'skipped';
  reason: string | null;
  subject: string | null;
  orderId: string | null;
  orderNumber: string | null;
  createdAt: string;
}

export interface DSettings {
  announcement: string;
  hero: { eyebrow: string; title: string; subtitle: string; ctaLabel: string; ctaHref: string; imageUrl: string };
  shipping: { flatFee: number; freeShippingThreshold: number; estimatedDays: string };
  cod: { enabled: boolean; fee: number; maxOrderValue: number };
  returns: { windowDays: number };
  contact: { email: string; phone: string; whatsapp: string; instagram: string; address: string; hours: string };
}

export interface DemoDB {
  version: 1;
  seq: number;
  categories: DCategory[];
  products: DProduct[];
  orders: DOrder[];
  users: DUser[];
  coupons: DCoupon[];
  adjustments: DAdjustment[];
  messages: DMessage[];
  notifications: DNotification[];
  settings: DSettings;
}

/** Non-cryptographic hash — the demo keeps "accounts" only in the visitor's own browser. */
export function demoHash(password: string) {
  let h = 0x811c9dc5;
  for (const ch of `ap-demo:${password}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

export const DEMO_PASSWORD = 'Demo@2026';
export const DEMO_ACCOUNTS = {
  admin: 'owner@demo.store',
  staff: 'staff@demo.store',
  customer: 'kavya@demo.store',
};

const slugify = (s: string) =>
  s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const CATEGORIES: { slug: string; name: string; description: string; image: string; parent?: string; order: number }[] = [
  { slug: 'accessories-jewellery', name: 'Accessories & Jewellery', description: 'Everyday sparkle — clips, chains, earrings and bracelets.', image: 'cat-jewellery', order: 1 },
  { slug: 'clips', name: 'Clips', description: 'Claw clips, pearl pins and bows for every hair day.', image: 'clip', parent: 'accessories-jewellery', order: 1 },
  { slug: 'chains', name: 'Chains', description: 'Dainty pendants and layered necklaces.', image: 'chain', parent: 'accessories-jewellery', order: 2 },
  { slug: 'earrings', name: 'Earrings', description: 'Studs, hoops, drops and jhumkas.', image: 'earrings', parent: 'accessories-jewellery', order: 3 },
  { slug: 'bracelets', name: 'Bracelets', description: 'Charm bracelets, kadas and stackables.', image: 'bracelet', parent: 'accessories-jewellery', order: 4 },
  { slug: 'one-gram-gold', name: 'One Gram Gold', description: 'Festive one-gram gold jewellery with a rich finish.', image: 'gold', order: 2 },
  { slug: 'budget-combos', name: 'Budget Combos', description: 'Curated sets that look luxe for less.', image: 'combo', order: 3 },
  { slug: 'games-gifts', name: 'Games & Gifts', description: 'Fun games and thoughtful gift hampers.', image: 'gift', order: 4 },
];

type SP = {
  name: string;
  category: string;
  price: number;
  sale?: number;
  stock: number;
  image: string;
  description: string;
  attrs: [string, string][];
  tags: string[];
  featured?: boolean;
  newArrival?: boolean;
  variants?: { label: string; stock: number }[];
};

const PRODUCTS: SP[] = [
  { name: 'Pearl Bow Hair Clip Set', category: 'clips', price: 249, sale: 199, stock: 40, image: 'clip', description: 'A set of three faux-pearl bow clips with a soft gold-tone finish. Lightweight and gentle on hair.', attrs: [['Material', 'Alloy'], ['Colour', 'Gold']], tags: ['hair', 'pearl', 'bow'], featured: true, newArrival: true },
  { name: 'Butterfly Claw Clips (Pack of 4)', category: 'clips', price: 299, stock: 25, image: 'clip', description: 'Matte pastel claw clips that hold thick hair all day.', attrs: [['Material', 'Acrylic'], ['Colour', 'Multicolour']], tags: ['hair', 'claw clip'], newArrival: true },
  { name: 'Dainty Heart Pendant Chain', category: 'chains', price: 399, sale: 349, stock: 0, image: 'chain', description: 'A delicate heart pendant on an adjustable 16–18" chain. Anti-tarnish coating.', attrs: [['Material', 'Brass'], ['Occasion', 'Everyday']], tags: ['pendant', 'heart'], featured: true, variants: [{ label: 'Gold', stock: 12 }, { label: 'Silver', stock: 8 }, { label: 'Rose Gold', stock: 3 }] },
  { name: 'Layered Coin Necklace', category: 'chains', price: 549, stock: 14, image: 'chain', description: 'Two-layer necklace with tiny coin charms — the perfect boho stack.', attrs: [['Material', 'Brass'], ['Colour', 'Gold']], tags: ['layered', 'coin'] },
  { name: 'Pearl Drop Earrings', category: 'earrings', price: 299, stock: 30, image: 'earrings', description: 'Classic teardrop pearls on gold-tone hooks. Hypoallergenic posts.', attrs: [['Material', 'Alloy'], ['Colour', 'Gold'], ['Occasion', 'Party']], tags: ['pearl', 'drops'], featured: true },
  { name: 'Oxidised Jhumka Earrings', category: 'earrings', price: 349, sale: 299, stock: 4, image: 'earrings', description: 'Handcrafted oxidised silver-tone jhumkas with a filigree dome.', attrs: [['Material', 'Oxidised Silver'], ['Colour', 'Silver'], ['Occasion', 'Festive']], tags: ['jhumka', 'ethnic'], newArrival: true },
  { name: 'Crystal Huggie Hoops', category: 'earrings', price: 279, stock: 22, image: 'earrings', description: 'Small hoops lined with sparkling crystals. Snap-closure.', attrs: [['Material', 'Alloy'], ['Colour', 'Silver']], tags: ['hoops', 'crystal'] },
  { name: 'Evil Eye Charm Bracelet', category: 'bracelets', price: 249, stock: 35, image: 'bracelet', description: 'Adjustable chain bracelet with a blue evil-eye charm for good vibes.', attrs: [['Material', 'Brass'], ['Colour', 'Gold']], tags: ['evil eye', 'charm'], featured: true },
  { name: 'Adjustable Kada Bangle', category: 'bracelets', price: 449, stock: 3, image: 'bracelet', description: 'Sleek open kada with an adjustable fit. Stacks beautifully.', attrs: [['Material', 'Brass'], ['Colour', 'Gold']], tags: ['kada', 'bangle'] },
  { name: 'One Gram Gold Lakshmi Coin Necklace', category: 'one-gram-gold', price: 1299, sale: 1099, stock: 8, image: 'gold', description: 'Traditional coin necklace in one-gram gold plating with Lakshmi motifs. Comes in a gift pouch.', attrs: [['Material', 'One Gram Gold'], ['Occasion', 'Festive']], tags: ['temple', 'coin', 'festive'], featured: true, newArrival: true },
  { name: 'One Gram Gold Bridal Bangles (Set of 2)', category: 'one-gram-gold', price: 1599, stock: 6, image: 'gold', description: 'Intricately carved bangles with a rich gold finish. Available in common sizes.', attrs: [['Material', 'One Gram Gold'], ['Occasion', 'Bridal']], tags: ['bangles', 'bridal'], variants: [{ label: 'Size 2.4', stock: 3 }, { label: 'Size 2.6', stock: 4 }, { label: 'Size 2.8', stock: 2 }] },
  { name: 'One Gram Gold Stud Earrings', category: 'one-gram-gold', price: 599, stock: 18, image: 'gold', description: 'Floral studs with a ruby-red stone centre. Screw-back closure.', attrs: [['Material', 'One Gram Gold'], ['Occasion', 'Everyday']], tags: ['studs'] },
  { name: 'Everyday Essentials Combo', category: 'budget-combos', price: 599, sale: 499, stock: 20, image: 'combo', description: 'Earrings + pendant chain + hair clip — a complete everyday look at a combo price.', attrs: [['Colour', 'Gold']], tags: ['combo', 'value'], featured: true },
  { name: 'Festive Glam Gift Box', category: 'budget-combos', price: 799, stock: 10, image: 'combo', description: 'Jhumkas, a kada and a velvet pouch, packed in a keepsake box.', attrs: [['Occasion', 'Festive']], tags: ['combo', 'gift'], newArrival: true },
  { name: 'Mini Ludo Travel Game', category: 'games-gifts', price: 199, stock: 50, image: 'game', description: 'Pocket-size magnetic Ludo board for trips and family evenings.', attrs: [['Age', '5+']], tags: ['game', 'travel'] },
  { name: 'Personalised Gift Hamper', category: 'games-gifts', price: 999, sale: 899, stock: 7, image: 'gift', description: 'A jewellery piece, a scented candle and a handwritten note — wrapped and ready to gift.', attrs: [['Occasion', 'Birthday']], tags: ['hamper', 'gift'], featured: true },
];

export const DEFAULT_SETTINGS: DSettings = {
  announcement: 'Free shipping on orders above ₹999 · COD available',
  hero: {
    eyebrow: 'New season edit',
    title: 'Little sparkles for every day',
    subtitle: 'Handpicked jewellery, one-gram gold, hair accessories and thoughtful gifts — styled by A&P.',
    ctaLabel: 'Shop the collection',
    ctaHref: '/shop',
    imageUrl: '/samples/hero.svg', // rendered as the layered inline illustration
  },
  shipping: { flatFee: 7900, freeShippingThreshold: 99900, estimatedDays: '4–7 business days' },
  cod: { enabled: true, fee: 4900, maxOrderValue: 500000 },
  returns: { windowDays: 7 },
  contact: { email: '', phone: '', whatsapp: '', instagram: 'https://www.instagram.com/', address: '', hours: 'Mon–Sat, 10am–7pm IST' },
};

/* Sample customers (fictional) used by the sample orders. */
const CUSTOMERS = [
  { name: 'Kavya Menon', email: 'kavya@demo.store', phone: '9876500011', city: 'Chennai', state: 'Tamil Nadu', pincode: '600040' },
  { name: 'Ananya Iyer', email: 'ananya@demo.store', phone: '9876500022', city: 'Bengaluru', state: 'Karnataka', pincode: '560034' },
  { name: 'Divya Raj', email: 'divya@demo.store', phone: '9876500033', city: 'Coimbatore', state: 'Tamil Nadu', pincode: '641002' },
  { name: 'Meera Krishnan', email: 'meera@demo.store', phone: '9876500044', city: 'Kochi', state: 'Kerala', pincode: '682016' },
  { name: 'Lakshmi Priya', email: 'lakshmi@demo.store', phone: '9876500055', city: 'Madurai', state: 'Tamil Nadu', pincode: '625001' },
];

const SYSTEM: Actor = { type: 'system', id: null, name: 'System' };

export function unitPrice(p: Pick<DProduct, 'price' | 'salePrice'>, v?: DVariant | null) {
  const resolve = (price: number, sale: number | null | undefined) =>
    sale != null && sale < price ? { unitPrice: sale, compareAtPrice: price } : { unitPrice: price, compareAtPrice: null };
  if (!v) return resolve(p.price, p.salePrice);
  if (v.price != null) return resolve(v.price, v.salePrice);
  return resolve(p.price, v.salePrice ?? p.salePrice);
}

const iso = (ms: number) => new Date(ms).toISOString();

export function createSeed(now = Date.now()): DemoDB {
  let seq = 1000;
  const id = (prefix: string) => `${prefix}${(seq++).toString(36)}`;
  const day = 86400_000;
  const hour = 3600_000;

  const catIds = new Map<string, string>();
  const categories: DCategory[] = CATEGORIES.map((c) => {
    const cid = id('c');
    catIds.set(c.slug, cid);
    return {
      id: cid,
      name: c.name,
      slug: c.slug,
      description: c.description,
      image: { url: img(c.image), alt: c.name },
      parent: c.parent ? catIds.get(c.parent)! : null,
      isActive: true,
      displayOrder: c.order,
      createdAt: iso(now - 60 * day),
      updatedAt: iso(now - 60 * day),
    };
  });

  const adjustments: DAdjustment[] = [];
  const products: DProduct[] = PRODUCTS.map((p, i) => {
    const pid = id('p');
    const sku = `SAMPLE-${String(i + 1).padStart(3, '0')}`;
    const variants: DVariant[] = (p.variants ?? []).map((v, vi) => ({ id: id('v'), sku: `${sku}-${vi + 1}`, label: v.label, price: null, salePrice: null, stock: v.stock, isActive: true }));
    const stock = variants.length ? variants.reduce((s, v) => s + v.stock, 0) : p.stock;
    const created = now - (50 - i * 2) * day;
    for (const row of variants.length ? variants.map((v) => ({ sku: v.sku, qty: v.stock })) : [{ sku, qty: stock }]) {
      if (row.qty > 0) adjustments.push({ id: id('a'), productId: pid, sku: row.sku, delta: row.qty, stockAfter: row.qty, reason: 'initial_stock', order: null, actor: { type: 'system', name: 'Seed script' }, note: 'Sample data', createdAt: iso(created) });
    }
    return {
      id: pid,
      name: p.name,
      slug: slugify(p.name),
      sku,
      description: `${p.description}\n\nSample product for demonstration — replace with your real catalogue before launch.`,
      shortDescription: `${p.description.split('.')[0]}.`,
      categoryId: catIds.get(p.category)!,
      tags: p.tags,
      images: [
        { url: img(p.image), alt: p.name },
        { url: img(`${p.image}-alt`), alt: `${p.name} — detail` },
      ],
      price: p.price * 100,
      salePrice: p.sale ? p.sale * 100 : null,
      stock,
      lowStockThreshold: 5,
      attributes: p.attrs.map(([name, value]) => ({ name, value })),
      variants,
      isFeatured: !!p.featured,
      isNewArrival: !!p.newArrival,
      status: 'active',
      soldCount: 0,
      isSample: true,
      createdAt: iso(created),
      updatedAt: iso(created),
    };
  });

  const settings = structuredClone(DEFAULT_SETTINGS);
  const users: DUser[] = [
    { id: id('u'), name: 'Store Owner (demo)', email: 'owner@demo.store', phone: null, role: 'admin', passwordHash: demoHash(DEMO_PASSWORD), isActive: true, whatsappOptIn: false, addresses: [], wishlist: [], createdAt: iso(now - 70 * day), lastLoginAt: null },
    { id: id('u'), name: 'Store Staff (demo)', email: 'staff@demo.store', phone: null, role: 'staff', passwordHash: demoHash(DEMO_PASSWORD), isActive: true, whatsappOptIn: false, addresses: [], wishlist: [], createdAt: iso(now - 70 * day), lastLoginAt: null },
    ...CUSTOMERS.map((c, i) => ({
      id: id('u'),
      name: c.name,
      email: c.email,
      phone: c.phone,
      role: 'customer' as Role,
      passwordHash: demoHash(DEMO_PASSWORD),
      isActive: true,
      whatsappOptIn: i % 2 === 0,
      addresses: [{ _id: id('ad'), label: 'Home', fullName: c.name, phone: c.phone, line1: `${12 + i * 7}, Rose Garden Street`, city: c.city, state: c.state, pincode: c.pincode, country: 'IN', isDefault: true }],
      wishlist: [],
      createdAt: iso(now - (40 - i * 5) * day),
      lastLoginAt: iso(now - i * day),
    })),
  ];

  const coupons: DCoupon[] = [
    { id: id('k'), code: 'WELCOME10', description: 'Sample: 10% off first order', type: 'percent', value: 10, maxDiscount: 20000, minOrderValue: 49900, startsAt: null, expiresAt: null, usageLimit: null, perCustomerLimit: 1, usedCount: 0, isActive: true, createdAt: iso(now - 45 * day) },
    { id: id('k'), code: 'FESTIVE150', description: 'Sample: ₹150 off on ₹999+', type: 'fixed', value: 15000, maxDiscount: null, minOrderValue: 99900, startsAt: null, expiresAt: iso(now + 30 * day), usageLimit: 200, perCustomerLimit: 2, usedCount: 0, isActive: true, createdAt: iso(now - 20 * day) },
  ];

  // ---- Sample orders spread over the last 30 days (fictional) ----
  const PATH_COD = ['placed', 'processing', 'packed', 'shipped', 'out_for_delivery', 'delivered'];
  const PATH_ONLINE = ['pending_payment', 'payment_confirmed', 'processing', 'packed', 'shipped', 'out_for_delivery', 'delivered'];
  const COURIERS = ['Delhivery', 'DTDC', 'India Post', 'Blue Dart'];
  const plans: { days: number; c: number; items: [number, number, number?][]; method: 'cod' | 'razorpay'; status: string; coupon?: string; ret?: boolean }[] = [
    { days: 28, c: 0, items: [[4, 1], [7, 1]], method: 'razorpay', status: 'delivered' },
    { days: 25, c: 1, items: [[9, 1]], method: 'razorpay', status: 'delivered' },
    { days: 22, c: 2, items: [[0, 2], [14, 1]], method: 'cod', status: 'delivered' },
    { days: 19, c: 3, items: [[12, 1]], method: 'razorpay', status: 'delivered', coupon: 'WELCOME10' },
    { days: 17, c: 4, items: [[5, 2]], method: 'cod', status: 'delivered', ret: true },
    { days: 14, c: 0, items: [[2, 1, 0], [4, 1]], method: 'razorpay', status: 'delivered' },
    { days: 12, c: 1, items: [[15, 1]], method: 'cod', status: 'cancelled' },
    { days: 10, c: 2, items: [[10, 1, 1]], method: 'razorpay', status: 'delivered', coupon: 'FESTIVE150' },
    { days: 7, c: 3, items: [[7, 2], [0, 1]], method: 'cod', status: 'out_for_delivery' },
    { days: 5, c: 4, items: [[13, 1]], method: 'razorpay', status: 'shipped' },
    { days: 3, c: 0, items: [[9, 1], [11, 1]], method: 'razorpay', status: 'packed' },
    { days: 2, c: 2, items: [[3, 1]], method: 'cod', status: 'processing' },
    { days: 1, c: 1, items: [[12, 2]], method: 'cod', status: 'placed' },
    { days: 0, c: 3, items: [[4, 1], [6, 1]], method: 'razorpay', status: 'payment_confirmed' },
  ];
  const customerUsers = users.filter((u) => u.role === 'customer');
  const orders: DOrder[] = [];
  const notifications: DNotification[] = [];
  let n = 0;
  for (const plan of plans) {
    n++;
    const cu = CUSTOMERS[plan.c];
    const user = customerUsers[plan.c];
    const created = now - plan.days * day - (n % 5) * 3 * hour - 2 * hour;
    const items: DOrderItem[] = plan.items.map(([pi, qty, vi]) => {
      const p = products[pi];
      const v = vi != null ? p.variants[vi] : null;
      const price = unitPrice(p, v);
      if (plan.status !== 'cancelled') p.soldCount += qty;
      return { product: p.id, variantId: v?.id ?? null, name: p.name, sku: v?.sku ?? p.sku, variantLabel: v?.label ?? null, image: p.images[0].url, unitPrice: price.unitPrice, compareAtPrice: price.compareAtPrice, quantity: qty, lineTotal: price.unitPrice * qty };
    });
    const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
    const coupon = plan.coupon ? coupons.find((k) => k.code === plan.coupon)! : null;
    const discount = coupon ? (coupon.type === 'percent' ? Math.min(Math.floor((subtotal * coupon.value) / 100), coupon.maxDiscount ?? Infinity) : Math.min(coupon.value, subtotal)) : 0;
    if (coupon) coupon.usedCount++;
    const shipping = subtotal - discount >= settings.shipping.freeShippingThreshold ? 0 : settings.shipping.flatFee;
    const codFee = plan.method === 'cod' ? settings.cod.fee : 0;
    const total = subtotal - discount + shipping + codFee;
    const path = plan.method === 'cod' ? PATH_COD : PATH_ONLINE;
    const stopAt = plan.status === 'cancelled' ? 1 : path.indexOf(plan.status) + 1;
    const timeline: DOrder['timeline'] = [];
    let t = created;
    const customerActor: Actor = { type: 'customer', id: user.id, name: cu.name };
    const staffActor: Actor = { type: 'admin', id: users[0].id, name: 'Store Owner (demo)' };
    path.slice(0, stopAt).forEach((s, i) => {
      if (i > 0) t += (s === 'payment_confirmed' ? 0.05 : s === 'shipped' ? 20 : s === 'delivered' ? 40 : 6) * hour;
      timeline.push({
        status: s,
        at: iso(Math.min(t, now - 10 * 60_000)),
        actor: i === 0 ? customerActor : s === 'payment_confirmed' ? SYSTEM : staffActor,
        note: i === 0 ? (plan.method === 'cod' ? 'Order placed (Cash on Delivery)' : 'Order created — awaiting payment') : s === 'payment_confirmed' ? 'Payment received' : undefined,
      });
    });
    const reached = (s: string) => timeline.some((e) => e.status === s);
    const courier = COURIERS[n % COURIERS.length];
    const shippedAt = timeline.find((e) => e.status === 'shipped')?.at ?? null;
    const deliveredAt = timeline.find((e) => e.status === 'delivered')?.at ?? null;
    let status = plan.status;
    let cancellation: DOrder['cancellation'] = null;
    let returnRequest: DOrder['returnRequest'] = null;
    if (plan.status === 'cancelled') {
      cancellation = { reason: 'Ordered the wrong colour', at: iso(created + 2 * hour), by: customerActor };
      timeline.push({ status: 'cancelled', at: cancellation.at, actor: customerActor, note: cancellation.reason });
    }
    if (plan.ret && deliveredAt) {
      status = 'return_requested';
      returnRequest = { reason: 'One earring arrived with a bent hook.', requestedAt: iso(Date.parse(deliveredAt) + 20 * hour) };
      timeline.push({ status: 'return_requested', at: returnRequest.requestedAt, actor: customerActor, note: 'Return requested' });
    }
    const onlinePaid = plan.method === 'razorpay' && reached('payment_confirmed');
    const codPaid = plan.method === 'cod' && reached('delivered');
    const paidAt = onlinePaid ? timeline.find((e) => e.status === 'payment_confirmed')!.at : codPaid ? deliveredAt : null;
    const orderNumber = `AP-${new Date(created + 5.5 * hour).toISOString().slice(2, 10).replace(/-/g, '')}-${'DEMO' + 'ABCDEFGHJKMNPQRSTUVWXYZ'[n]}`;
    const oid = id('o');
    const txns: DTxn[] = [];
    if (onlinePaid) {
      txns.push({ id: id('t'), provider: 'razorpay', type: 'payment', status: 'captured', amount: total, providerOrderId: `order_demo${n}`, providerPaymentId: `pay_demo${n}`, providerRefundId: null, method: 'upi', verifiedVia: ['signature+api', 'webhook'], errorDescription: null, reference: 'Sample — no real payment', createdAt: paidAt! });
    }
    if (codPaid) {
      txns.push({ id: id('t'), provider: 'cod', type: 'payment', status: 'recorded', amount: total, providerOrderId: null, providerPaymentId: null, providerRefundId: null, method: 'cod', verifiedVia: ['manual'], errorDescription: null, reference: 'Courier remittance (sample)', createdAt: paidAt! });
    }
    orders.push({
      id: oid,
      orderNumber,
      user: user.id,
      customer: { name: cu.name, email: cu.email, phone: cu.phone },
      shippingAddress: { fullName: cu.name, phone: cu.phone, line1: user.addresses[0].line1, city: cu.city, state: cu.state, pincode: cu.pincode, country: 'IN' },
      items,
      pricing: { subtotal, discount, shipping, codFee, total },
      coupon: coupon ? { code: coupon.code, discount, released: false } : null,
      payment: {
        method: plan.method,
        status: plan.status === 'cancelled' ? 'void' : onlinePaid || codPaid ? 'paid' : plan.method === 'cod' ? 'cod_pending' : 'awaiting_payment',
        razorpayOrderId: plan.method === 'razorpay' ? `order_demo${n}` : null,
        razorpayPaymentId: onlinePaid ? `pay_demo${n}` : null,
        paidAt,
        amountPaid: onlinePaid || codPaid ? total : 0,
        amountRefunded: 0,
        refundReserved: 0,
      },
      status,
      inventoryState: plan.status === 'cancelled' ? 'released' : 'committed',
      timeline,
      internalNotes: [],
      shipment: {
        courierName: shippedAt ? courier : null,
        trackingNumber: shippedAt ? `${courier.slice(0, 3).toUpperCase()}${100000 + n * 7919}` : null,
        trackingUrl: null,
        shippedAt,
        deliveredAt,
      },
      cancellation,
      returnRequest,
      attention: null,
      customerNote: n === 3 ? 'Please gift wrap' : null,
      whatsappOptIn: user.whatsappOptIn,
      trackingToken: `demo-${oid}`,
      idempotencyKey: null,
      transactions: txns,
      createdAt: iso(created),
      updatedAt: timeline[timeline.length - 1].at,
    });
    for (const e of [plan.method === 'cod' ? 'order_confirmation' : 'payment_confirmation', ...(shippedAt ? ['shipment'] : [])]) {
      notifications.push({ id: id('n'), event: e, channel: 'email', recipient: cu.email, status: 'skipped', reason: 'email_provider_not_configured', subject: null, orderId: oid, orderNumber, createdAt: iso(created + hour) });
    }
    // Keep stock consistent: sample sales came out of the seeded stock.
    if (plan.status !== 'cancelled') {
      for (const it of items) {
        const p = products.find((x) => x.id === it.product)!;
        const v = it.variantId ? p.variants.find((x) => x.id === it.variantId) : null;
        if (v) v.stock = Math.max(0, v.stock - it.quantity);
        p.stock = Math.max(0, p.variants.length ? p.variants.reduce((s, x) => s + x.stock, 0) : p.stock - it.quantity);
        adjustments.push({ id: id('a'), productId: p.id, sku: it.sku, delta: -it.quantity, stockAfter: v ? v.stock : p.stock, reason: 'order_reserved', order: orderNumber, actor: customerActor, note: null, createdAt: iso(created) });
      }
    }
  }
  orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const messages: DMessage[] = [
    { id: id('m'), name: 'Nithya S.', email: 'nithya@demo.store', phone: null, subject: 'Bulk order for a wedding', message: 'Hi! Can I get 25 sets of the pearl bow clips as return gifts? Please share a price.', status: 'new', createdAt: iso(now - 6 * hour) },
    { id: id('m'), name: 'Harini K.', email: 'harini@demo.store', phone: '9876500066', subject: 'Size query', message: 'Are the bridal bangles available in size 2.10?', status: 'read', createdAt: iso(now - 3 * day) },
  ];

  return { version: 1, seq, categories, products, orders, users, coupons, adjustments, messages, notifications, settings };
}

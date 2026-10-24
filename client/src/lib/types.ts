/* API response shapes. Money is always integer paise. */

export interface ImageRef {
  url: string;
  publicId?: string;
  alt?: string;
  width?: number;
  height?: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: 'customer' | 'staff' | 'admin';
  whatsappOptIn: boolean;
  createdAt: string;
}

export interface Address {
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
  country?: string;
  isDefault: boolean;
}

export interface ProductCard {
  id: string;
  name: string;
  slug: string;
  image: ImageRef | null;
  hoverImage: ImageRef | null;
  price: number;
  compareAtPrice: number | null;
  hasVariants: boolean;
  priceVaries: boolean;
  inStock: boolean;
  lowStock: boolean;
  isNewArrival: boolean;
  isFeatured: boolean;
  category: { name: string; slug: string } | null;
}

export interface ProductVariant {
  id: string;
  sku: string;
  label: string;
  price: number;
  compareAtPrice: number | null;
  stock: number;
  inStock: boolean;
}

export interface ProductDetail {
  id: string;
  name: string;
  slug: string;
  sku: string;
  description: string;
  shortDescription: string;
  images: ImageRef[];
  price: number;
  compareAtPrice: number | null;
  stock: number;
  inStock: boolean;
  lowStock: boolean;
  attributes: { name: string; value: string }[];
  variants: ProductVariant[];
  tags: string[];
  isNewArrival: boolean;
  isFeatured: boolean;
  category: { id: string; name: string; slug: string } | null;
  parentCategory: { id: string; name: string; slug: string } | null;
}

export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface ProductList {
  items: ProductCard[];
  meta: PageMeta;
  category: { id: string; name: string; slug: string } | null;
  facets: { attributes: { name: string; values: string[] }[]; price: { min: number; max: number } | null };
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  image: ImageRef | null;
  parent: string | null;
  isActive: boolean;
  displayOrder: number;
  productCount: number;
  activeProductCount?: number;
  children?: Category[];
}

export interface CategoryDetail extends Omit<Category, 'parent' | 'children'> {
  parent: { id: string; name: string; slug: string } | null;
  children: { id: string; name: string; slug: string; image: ImageRef | null }[];
}

export interface StoreSettings {
  announcement: string;
  hero: { eyebrow: string; title: string; subtitle: string; ctaLabel: string; ctaHref: string; imageUrl: string };
  shipping: { flatFee: number; freeShippingThreshold: number; estimatedDays: string };
  cod: { enabled: boolean; fee: number; maxOrderValue: number };
  returns: { windowDays: number };
  contact: { email: string; phone: string; whatsapp: string; instagram: string; address: string; hours: string };
  payments: { razorpay: { enabled: boolean; mode: 'test' | 'live' | null }; cod: boolean };
}

export interface HomeData {
  categories: Category[];
  newArrivals: ProductCard[];
  bestSellers: ProductCard[];
  featured: ProductCard[];
  budgetCombos: ProductCard[];
  specialOffers: ProductCard[];
  hero: StoreSettings['hero'];
}

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
  coupon: { code: string; valid: true; discount: number; description: string } | { code: string; valid: false; message: string; reason: string } | null;
  shippingInfo: { flatFee: number; freeShippingThreshold: number; amountToFreeShipping: number };
  paymentMethods: { razorpay: { available: boolean; reason?: string }; cod: { available: boolean; reason?: string; fee: number } };
}

export type OrderStatus =
  | 'pending_payment'
  | 'placed'
  | 'payment_confirmed'
  | 'processing'
  | 'packed'
  | 'shipped'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'return_requested'
  | 'returned'
  | 'refunded';

export type PaymentStatus = 'awaiting_payment' | 'cod_pending' | 'paid' | 'failed' | 'void' | 'refund_pending' | 'partially_refunded' | 'refunded';

export interface OrderItem {
  productId: string;
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

export interface Pricing {
  subtotal: number;
  discount: number;
  shipping: number;
  codFee: number;
  total: number;
}

export interface Shipment {
  courierName?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
}

export interface CustomerOrder {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  statusLabel: string;
  createdAt: string;
  items: OrderItem[];
  pricing: Pricing;
  coupon: { code: string; discount: number } | null;
  payment: { method: 'razorpay' | 'cod'; status: PaymentStatus; paidAt: string | null; amountPaid: number; amountRefunded: number };
  customer: { name: string; email: string | null; phone: string };
  shippingAddress: Partial<Address>;
  timeline: { status: OrderStatus; label: string; at: string; by: string; note: string | null }[];
  shipment: Shipment;
  courierEvents: { at: string; status: string; location?: string; description?: string; source: string }[];
  cancellation: { reason: string; at: string } | null;
  returnRequest: { reason: string; requestedAt: string; resolvedAt?: string | null; resolution?: string | null } | null;
  reservationExpiresAt: string | null;
  actions: { canCancel: boolean; canRequestReturn: boolean; canPay: boolean };
}

export interface RazorpayCheckout {
  provider: 'razorpay';
  keyId: string;
  mode: 'test' | 'live';
  razorpayOrderId: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: { name: string; email: string; contact: string };
  expiresAt: string | null;
}

export interface PlacedOrder {
  order: CustomerOrder;
  trackingToken: string;
  payment: RazorpayCheckout | null;
}

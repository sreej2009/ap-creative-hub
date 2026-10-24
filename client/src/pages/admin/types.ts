import type { ImageRef, OrderStatus, PageMeta, PaymentStatus, Pricing, Shipment } from '../../lib/types';

export interface AdminOrderSummary {
  id: string;
  orderNumber: string;
  createdAt: string;
  customer: { name: string; email: string; phone: string };
  isGuest: boolean;
  itemCount: number;
  total: number;
  status: OrderStatus;
  statusLabel: string;
  payment: { method: 'razorpay' | 'cod'; status: PaymentStatus };
  attention: { reason: string; at: string } | null;
  city: string;
}

export interface Actor {
  type: 'system' | 'customer' | 'admin' | 'staff';
  id: string | null;
  name?: string;
}

export interface AdminOrder extends AdminOrderSummary {
  user: string | null;
  shippingAddress: { fullName: string; phone: string; line1: string; line2?: string; landmark?: string; city: string; state: string; pincode: string };
  items: { product: string; variantId: string | null; name: string; sku: string; variantLabel?: string; image?: string; unitPrice: number; compareAtPrice?: number | null; quantity: number; lineTotal: number }[];
  pricing: Pricing;
  coupon: { code: string; discount: number; released: boolean } | null;
  payment: {
    method: 'razorpay' | 'cod';
    status: PaymentStatus;
    razorpayOrderId?: string | null;
    razorpayPaymentId?: string | null;
    paidAt?: string | null;
    amountPaid: number;
    amountRefunded: number;
    refundReserved: number;
  };
  inventoryState: 'reserved' | 'committed' | 'released';
  reservationExpiresAt: string | null;
  timeline: { status: OrderStatus; label: string; at: string; actor: Actor; note?: string }[];
  internalNotes: { note: string; at: string; by: string }[];
  shipment: Shipment;
  courierEvents: { at: string; status: string; location?: string; source: string }[];
  cancellation: { reason: string; at: string; by: Actor } | null;
  returnRequest: { reason: string; requestedAt: string; resolvedAt?: string; resolution?: string } | null;
  customerNote: string | null;
  whatsappOptIn: boolean;
  actions: {
    transitions: OrderStatus[];
    canCancel: boolean;
    canEditShipment: boolean;
    canResolveReturn: boolean;
    canRefund: boolean;
    canRecordManualRefund: boolean;
    canRecordCodPayment: boolean;
  };
  transactions: {
    id: string;
    provider: string;
    type: 'payment' | 'refund';
    status: string;
    amount: number;
    providerOrderId?: string | null;
    providerPaymentId?: string | null;
    providerRefundId?: string | null;
    method?: string | null;
    verifiedVia: string[];
    errorDescription?: string | null;
    reference?: string | null;
    createdAt: string;
  }[];
  notifications: { id: string; event: string; channel: string; status: 'sent' | 'failed' | 'skipped'; reason: string | null; createdAt: string }[];
}

export interface AdminProduct {
  id: string;
  name: string;
  slug: string;
  sku: string;
  description: string;
  shortDescription: string;
  category: { id: string; name: string | null };
  tags: string[];
  images: ImageRef[];
  price: number;
  salePrice: number | null;
  sellingPrice: number;
  stock: number;
  lowStockThreshold: number;
  stockState: 'in' | 'low' | 'out';
  attributes: { name: string; value: string }[];
  variants: { id: string; sku: string; label: string; price: number | null; salePrice: number | null; stock: number; isActive: boolean }[];
  isFeatured: boolean;
  isNewArrival: boolean;
  status: 'draft' | 'active' | 'archived';
  soldCount: number;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Paged<T> {
  items: T[];
  meta: PageMeta;
}

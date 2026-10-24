import { Schema, model, type Types } from 'mongoose';

export const ORDER_STATUSES = [
  'pending_payment',
  'placed',
  'payment_confirmed',
  'processing',
  'packed',
  'shipped',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'return_requested',
  'returned',
  'refunded',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = [
  'awaiting_payment', // online order created, payment not yet verified
  'cod_pending', // cash on delivery, not yet collected
  'paid',
  'failed', // online order expired/cancelled without a successful payment
  'void', // COD order cancelled before collection
  'refund_pending',
  'partially_refunded',
  'refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ['razorpay', 'cod'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type ActorType = 'system' | 'customer' | 'admin' | 'staff';
export interface Actor {
  type: ActorType;
  id?: Types.ObjectId | null;
  name?: string;
}

export interface OrderItem {
  product: Types.ObjectId;
  variantId?: Types.ObjectId | null;
  name: string;
  sku: string;
  variantLabel?: string;
  image?: string;
  unitPrice: number;
  compareAtPrice?: number | null;
  quantity: number;
  lineTotal: number;
}

export interface TimelineEntry {
  status: OrderStatus;
  at: Date;
  actor: Actor;
  /** Customer-visible note. */
  note?: string;
}

export interface CourierEvent {
  at: Date;
  status: string;
  location?: string;
  description?: string;
  /** Integration that reported the event; never entered manually. */
  source: string;
}

export interface IOrder {
  orderNumber: string;
  user?: Types.ObjectId | null;
  customer: { name: string; email: string; phone: string };
  shippingAddress: {
    fullName: string;
    phone: string;
    line1: string;
    line2?: string;
    landmark?: string;
    city: string;
    state: string;
    pincode: string;
    country: string;
  };
  items: OrderItem[];
  pricing: { subtotal: number; discount: number; shipping: number; codFee: number; total: number };
  coupon?: { couponId: Types.ObjectId; code: string; discount: number; usageKeys: string[]; released: boolean } | null;
  payment: {
    method: PaymentMethod;
    status: PaymentStatus;
    razorpayOrderId?: string | null;
    razorpayPaymentId?: string | null;
    paidAt?: Date | null;
    amountPaid: number;
    amountRefunded: number;
    /** Refund amount currently in flight with the provider; prevents concurrent over-refunds. */
    refundReserved: number;
  };
  status: OrderStatus;
  inventoryState: 'reserved' | 'committed' | 'released';
  reservationExpiresAt?: Date | null;
  timeline: TimelineEntry[];
  internalNotes: { note: string; at: Date; by: Actor }[];
  shipment: {
    courierName?: string | null;
    trackingNumber?: string | null;
    trackingUrl?: string | null;
    shippedAt?: Date | null;
    deliveredAt?: Date | null;
  };
  courierEvents: CourierEvent[];
  cancellation?: { reason: string; at: Date; by: Actor } | null;
  returnRequest?: { reason: string; requestedAt: Date; resolvedAt?: Date | null; resolution?: string | null } | null;
  /** Flags orders that need a human decision, e.g. a payment that arrived after the reservation expired. */
  attention?: { reason: string; at: Date } | null;
  customerNote?: string;
  whatsappOptIn: boolean;
  trackingSalt: string;
  idempotencyKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const ActorSchema = new Schema<Actor>(
  { type: { type: String, required: true }, id: { type: Schema.Types.ObjectId, default: null }, name: String },
  { _id: false },
);

const OrderItemSchema = new Schema<OrderItem>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId, default: null },
    name: { type: String, required: true },
    sku: { type: String, required: true },
    variantLabel: String,
    image: String,
    unitPrice: { type: Number, required: true },
    compareAtPrice: { type: Number, default: null },
    quantity: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true },
  },
  { _id: false },
);

const OrderSchema = new Schema<IOrder>(
  {
    orderNumber: { type: String, required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    customer: {
      name: { type: String, required: true },
      email: { type: String, required: true, lowercase: true },
      phone: { type: String, required: true },
    },
    shippingAddress: {
      fullName: { type: String, required: true },
      phone: { type: String, required: true },
      line1: { type: String, required: true },
      line2: String,
      landmark: String,
      city: { type: String, required: true },
      state: { type: String, required: true },
      pincode: { type: String, required: true },
      country: { type: String, default: 'IN' },
    },
    items: { type: [OrderItemSchema], required: true },
    pricing: {
      subtotal: { type: Number, required: true },
      discount: { type: Number, required: true, default: 0 },
      shipping: { type: Number, required: true, default: 0 },
      codFee: { type: Number, required: true, default: 0 },
      total: { type: Number, required: true },
    },
    coupon: {
      type: new Schema(
        {
          couponId: { type: Schema.Types.ObjectId, ref: 'Coupon' },
          code: String,
          discount: Number,
          usageKeys: [String],
          released: { type: Boolean, default: false },
        },
        { _id: false },
      ),
      default: null,
    },
    payment: {
      method: { type: String, enum: ['razorpay', 'cod'], required: true },
      status: { type: String, enum: PAYMENT_STATUSES, required: true },
      razorpayOrderId: { type: String, default: null },
      razorpayPaymentId: { type: String, default: null },
      paidAt: { type: Date, default: null },
      amountPaid: { type: Number, default: 0 },
      amountRefunded: { type: Number, default: 0 },
      refundReserved: { type: Number, default: 0 },
    },
    status: { type: String, enum: ORDER_STATUSES, required: true },
    inventoryState: { type: String, enum: ['reserved', 'committed', 'released'], required: true },
    reservationExpiresAt: { type: Date, default: null },
    timeline: [
      new Schema<TimelineEntry>(
        { status: String, at: Date, actor: ActorSchema, note: { type: String, maxlength: 500 } },
        { _id: false },
      ),
    ],
    internalNotes: [
      new Schema({ note: { type: String, maxlength: 2000 }, at: Date, by: ActorSchema }, { _id: true }),
    ],
    shipment: {
      courierName: { type: String, default: null },
      trackingNumber: { type: String, default: null },
      trackingUrl: { type: String, default: null },
      shippedAt: { type: Date, default: null },
      deliveredAt: { type: Date, default: null },
    },
    courierEvents: [
      new Schema<CourierEvent>(
        { at: Date, status: String, location: String, description: String, source: { type: String, required: true } },
        { _id: false },
      ),
    ],
    cancellation: {
      type: new Schema({ reason: String, at: Date, by: ActorSchema }, { _id: false }),
      default: null,
    },
    returnRequest: {
      type: new Schema(
        { reason: String, requestedAt: Date, resolvedAt: Date, resolution: String },
        { _id: false },
      ),
      default: null,
    },
    attention: { type: new Schema({ reason: String, at: Date }, { _id: false }), default: null },
    customerNote: { type: String, maxlength: 500 },
    whatsappOptIn: { type: Boolean, default: false },
    trackingSalt: { type: String, required: true, select: false },
    idempotencyKey: { type: String },
  },
  { timestamps: true },
);

OrderSchema.index({ orderNumber: 1 }, { unique: true });
OrderSchema.index({ idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
OrderSchema.index({ user: 1, createdAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ 'payment.status': 1, createdAt: -1 });
OrderSchema.index({ 'payment.razorpayOrderId': 1 }, { sparse: true });
OrderSchema.index({ status: 1, reservationExpiresAt: 1 });
OrderSchema.index({ 'customer.email': 1 });
OrderSchema.index({ 'payment.paidAt': 1 });

export const Order = model<IOrder>('Order', OrderSchema);

import { Schema, model, type Types } from 'mongoose';

/**
 * Ledger of payment-provider interactions. Card numbers, CVVs, UPI PINs and
 * similar credentials are never received or stored — only provider IDs,
 * amounts, statuses and the payment method category.
 */
export interface IPaymentTransaction {
  order: Types.ObjectId;
  provider: 'razorpay' | 'cod' | 'manual';
  type: 'payment' | 'refund';
  providerOrderId?: string | null;
  providerPaymentId?: string | null;
  providerRefundId?: string | null;
  amount: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'failed' | 'pending' | 'processed' | 'recorded';
  method?: string | null;
  verifiedVia: string[];
  errorCode?: string | null;
  errorDescription?: string | null;
  reference?: string | null;
  createdBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentTransactionSchema = new Schema<IPaymentTransaction>(
  {
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    provider: { type: String, enum: ['razorpay', 'cod', 'manual'], required: true },
    type: { type: String, enum: ['payment', 'refund'], required: true },
    providerOrderId: { type: String, default: null },
    providerPaymentId: { type: String, default: null },
    providerRefundId: { type: String, default: null },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    status: { type: String, required: true },
    method: { type: String, default: null },
    verifiedVia: { type: [String], default: [] },
    errorCode: { type: String, default: null },
    errorDescription: { type: String, default: null },
    reference: { type: String, default: null, maxlength: 200 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

PaymentTransactionSchema.index(
  { providerPaymentId: 1 },
  { unique: true, partialFilterExpression: { type: 'payment', providerPaymentId: { $type: 'string' } } },
);
PaymentTransactionSchema.index(
  { providerRefundId: 1 },
  { unique: true, partialFilterExpression: { providerRefundId: { $type: 'string' } } },
);

export const PaymentTransaction = model<IPaymentTransaction>('PaymentTransaction', PaymentTransactionSchema);

/** Processed webhook deliveries, keyed by the provider's event id for idempotency. */
export interface IWebhookEvent {
  provider: string;
  eventId: string;
  event: string;
  status: 'processing' | 'processed' | 'ignored' | 'failed';
  error?: string;
  receivedAt: Date;
  processedAt?: Date;
}

const WebhookEventSchema = new Schema<IWebhookEvent>({
  provider: { type: String, required: true },
  eventId: { type: String, required: true },
  event: { type: String, required: true },
  status: { type: String, required: true },
  error: String,
  receivedAt: { type: Date, default: () => new Date() },
  processedAt: Date,
});
WebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
WebhookEventSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export const WebhookEvent = model<IWebhookEvent>('WebhookEvent', WebhookEventSchema);

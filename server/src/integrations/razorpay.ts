import Razorpay from 'razorpay';
import { env } from '../config/env.js';
import { hmac, safeEqual } from '../lib/util.js';
import { logger } from '../lib/logger.js';

/**
 * Thin, typed wrapper around the Razorpay server SDK. The rest of the code
 * depends on the PaymentGateway interface so tests can inject a mock
 * without touching the network.
 */

export interface GatewayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt?: string;
  status: string;
}

export interface GatewayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  method?: string;
  captured?: boolean;
  error_code?: string | null;
  error_description?: string | null;
}

export interface GatewayRefund {
  id: string;
  payment_id: string;
  amount: number;
  status: 'pending' | 'processed' | 'failed';
}

export interface PaymentGateway {
  readonly mode: 'test' | 'live';
  readonly keyId: string;
  createOrder(input: { amount: number; currency: string; receipt: string; notes?: Record<string, string> }): Promise<GatewayOrder>;
  fetchPayment(paymentId: string): Promise<GatewayPayment>;
  fetchOrderPayments(orderId: string): Promise<GatewayPayment[]>;
  capturePayment(paymentId: string, amount: number, currency: string): Promise<GatewayPayment>;
  refundPayment(paymentId: string, input: { amount: number; notes?: Record<string, string> }): Promise<GatewayRefund>;
}

export type GatewayStatus =
  | { configured: true; mode: 'test' | 'live'; webhookConfigured: boolean }
  | { configured: false; reason: string };

export function razorpayStatus(): GatewayStatus {
  const { RAZORPAY_KEY_ID: keyId, RAZORPAY_KEY_SECRET: secret } = env;
  if (!keyId || !secret) return { configured: false, reason: 'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not set.' };
  const mode = keyId.startsWith('rzp_live_') ? 'live' : keyId.startsWith('rzp_test_') ? 'test' : null;
  if (!mode) return { configured: false, reason: 'RAZORPAY_KEY_ID must start with rzp_test_ or rzp_live_.' };
  if (mode === 'live' && !env.RAZORPAY_ALLOW_LIVE) {
    return { configured: false, reason: 'Live Razorpay keys are present but RAZORPAY_ALLOW_LIVE is not "true". Live mode stays disabled until the owner approves it.' };
  }
  return { configured: true, mode, webhookConfigured: Boolean(env.RAZORPAY_WEBHOOK_SECRET) };
}

class RazorpayGateway implements PaymentGateway {
  private client: Razorpay;
  constructor(
    public readonly keyId: string,
    secret: string,
    public readonly mode: 'test' | 'live',
  ) {
    this.client = new Razorpay({ key_id: keyId, key_secret: secret });
  }
  async createOrder(input: { amount: number; currency: string; receipt: string; notes?: Record<string, string> }) {
    const o = await this.client.orders.create({
      amount: input.amount,
      currency: input.currency,
      receipt: input.receipt,
      notes: input.notes,
    });
    return { id: o.id, amount: Number(o.amount), currency: o.currency, receipt: o.receipt ?? undefined, status: o.status };
  }
  async fetchPayment(paymentId: string) {
    return (await this.client.payments.fetch(paymentId)) as unknown as GatewayPayment;
  }
  async fetchOrderPayments(orderId: string) {
    const res = (await this.client.orders.fetchPayments(orderId)) as unknown as { items: GatewayPayment[] };
    return res.items ?? [];
  }
  async capturePayment(paymentId: string, amount: number, currency: string) {
    return (await this.client.payments.capture(paymentId, amount, currency)) as unknown as GatewayPayment;
  }
  async refundPayment(paymentId: string, input: { amount: number; notes?: Record<string, string> }) {
    const r = await this.client.payments.refund(paymentId, { amount: input.amount, notes: input.notes });
    return { id: r.id, payment_id: r.payment_id, amount: Number(r.amount), status: r.status as GatewayRefund['status'] };
  }
}

let override: PaymentGateway | null | undefined;
let cached: PaymentGateway | null | undefined;

/** Returns the configured gateway or null when Razorpay is not (validly) configured. */
export function getPaymentGateway(): PaymentGateway | null {
  if (override !== undefined) return override;
  if (cached !== undefined) return cached;
  const status = razorpayStatus();
  if (!status.configured) {
    logger.warn(`Razorpay disabled: ${status.reason}`);
    return (cached = null);
  }
  return (cached = new RazorpayGateway(env.RAZORPAY_KEY_ID!, env.RAZORPAY_KEY_SECRET!, status.mode));
}

/** Test hook: inject a mock gateway (or null to simulate "not configured"). Pass undefined to reset. */
export function setPaymentGatewayForTests(gateway: PaymentGateway | null | undefined) {
  override = gateway;
}

/** Checkout signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export function verifyCheckoutSignature(razorpayOrderId: string, paymentId: string, signature: string): boolean {
  const secret = env.RAZORPAY_KEY_SECRET;
  if (!secret || !signature) return false;
  return safeEqual(hmac(secret, `${razorpayOrderId}|${paymentId}`), signature);
}

/** Webhook signature: HMAC_SHA256(raw request body, webhook_secret). */
export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
  const secret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = hmac(secret, rawBody.toString('utf8'));
  return safeEqual(expected, signature);
}

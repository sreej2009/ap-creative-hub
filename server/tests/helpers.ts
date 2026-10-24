import crypto from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { inject, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { GatewayPayment, GatewayRefund, PaymentGateway } from '../src/integrations/razorpay.js';
import { setPaymentGatewayForTests } from '../src/integrations/razorpay.js';
import { setEmailTransportForTests } from '../src/integrations/email.js';
import { setMediaStorageForTests } from '../src/integrations/cloudinary.js';
import { setTransactionSupportForTests } from '../src/lib/transaction.js';
import { Category } from '../src/models/Category.js';
import { Product } from '../src/models/Product.js';
import { User, type Role } from '../src/models/User.js';
import { hashPassword } from '../src/services/auth.service.js';
import { listingPricing } from '../src/lib/pricing.js';
import { invalidateSettingsCache } from '../src/services/settings.service.js';
import { notifications } from '../src/services/notification.service.js';

export const PASSWORD = 'Sparkle2024!';

export async function connectTestDb() {
  const uri = inject('mongoUri');
  const dbName = `t_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
  await mongoose.connect(uri, { dbName });
  await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));
}

export async function resetDb() {
  await notifications.flush();
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
  invalidateSettingsCache();
  setTransactionSupportForTests(undefined);
}

export async function disconnectTestDb() {
  await notifications.flush();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  setPaymentGatewayForTests(undefined);
  setEmailTransportForTests(undefined);
  setMediaStorageForTests(undefined);
}

/** Supertest agent that keeps cookies and echoes the CSRF token like the real client. */
export class TestClient {
  agent: ReturnType<typeof request.agent>;
  csrf = '';

  constructor(app = createApp()) {
    this.agent = request.agent(app);
  }

  static async create(app?: ReturnType<typeof createApp>) {
    const c = new TestClient(app);
    const res = await c.agent.get('/api/v1/auth/csrf');
    c.csrf = res.body.csrfToken;
    return c;
  }

  private capture(res: request.Response) {
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const csrf = cookies.find((c) => c.startsWith('aph_csrf='));
    if (csrf) this.csrf = decodeURIComponent(csrf.split(';')[0].slice('aph_csrf='.length));
    return res;
  }

  async get(url: string) {
    return this.capture(await this.agent.get(url));
  }
  async post(url: string, body?: unknown) {
    return this.capture(await this.agent.post(url).set('X-CSRF-Token', this.csrf).send(body as object));
  }
  async put(url: string, body?: unknown) {
    return this.capture(await this.agent.put(url).set('X-CSRF-Token', this.csrf).send(body as object));
  }
  async patch(url: string, body?: unknown) {
    return this.capture(await this.agent.patch(url).set('X-CSRF-Token', this.csrf).send(body as object));
  }
  async delete(url: string) {
    return this.capture(await this.agent.delete(url).set('X-CSRF-Token', this.csrf));
  }
}

let seq = 0;
const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

export async function createUser(role: Role = 'customer', overrides: Partial<{ email: string; name: string; password: string }> = {}) {
  return User.create({
    name: overrides.name ?? `${role} ${uid()}`,
    email: overrides.email ?? `${role}.${uid()}@example.com`,
    passwordHash: await hashPassword(overrides.password ?? PASSWORD),
    role,
  });
}

export async function loginAs(role: Role, app?: ReturnType<typeof createApp>) {
  const user = await createUser(role);
  const client = await TestClient.create(app);
  const path = role === 'customer' ? '/api/v1/auth/login' : '/api/v1/auth/admin/login';
  const res = await client.post(path, { email: user.email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { client, user };
}

export async function createCategory(overrides: Partial<{ name: string; slug: string; isActive: boolean; parent: mongoose.Types.ObjectId }> = {}) {
  const name = overrides.name ?? `Category ${uid()}`;
  return Category.create({ name, slug: overrides.slug ?? `cat-${uid()}`, isActive: overrides.isActive ?? true, parent: overrides.parent ?? null });
}

export async function createProduct(
  overrides: Partial<{
    name: string;
    sku: string;
    price: number;
    salePrice: number | null;
    stock: number;
    status: 'draft' | 'active' | 'archived';
    category: mongoose.Types.ObjectId;
    variants: { sku: string; label: string; stock: number; price?: number | null; salePrice?: number | null; isActive?: boolean }[];
  }> = {},
) {
  const category = overrides.category ?? (await createCategory())._id;
  const price = overrides.price ?? 49900;
  const salePrice = overrides.salePrice ?? null;
  const variants = (overrides.variants ?? []).map((v) => ({ isActive: true, ...v, _id: new mongoose.Types.ObjectId() }));
  const stock = variants.length ? variants.reduce((s, v) => s + v.stock, 0) : (overrides.stock ?? 10);
  const id = uid();
  return Product.create({
    name: overrides.name ?? `Product ${id}`,
    slug: `product-${id}`,
    sku: overrides.sku ?? `SKU-${id}`.toUpperCase(),
    category,
    price,
    salePrice,
    stock,
    variants,
    status: overrides.status ?? 'active',
    ...listingPricing({ price, salePrice, variants }),
  });
}

export const address = {
  fullName: 'Priya Sharma',
  phone: '9876543210',
  line1: '12, Rose Garden Street',
  city: 'Chennai',
  state: 'Tamil Nadu',
  pincode: '600001',
};

export function checkoutBody(
  items: { productId: string; variantId?: string; quantity: number }[],
  overrides: Record<string, unknown> = {},
) {
  return {
    items,
    customer: { name: 'Priya Sharma', email: 'priya@example.com', phone: '9876543210' },
    shippingAddress: address,
    paymentMethod: 'cod',
    idempotencyKey: crypto.randomUUID(),
    ...overrides,
  };
}

/** In-memory stand-in for the Razorpay API. No network calls are made. */
export function mockGateway() {
  const payments = new Map<string, GatewayPayment>();
  const gateway = {
    mode: 'test' as const,
    keyId: 'rzp_test_mockkey000000',
    createOrder: vi.fn(async (input: { amount: number; currency: string; receipt: string }) => ({
      id: `order_${crypto.randomBytes(7).toString('hex')}`,
      amount: input.amount,
      currency: input.currency,
      receipt: input.receipt,
      status: 'created',
    })),
    fetchPayment: vi.fn(async (id: string) => {
      const p = payments.get(id);
      if (!p) throw new Error('payment not found');
      return { ...p };
    }),
    fetchOrderPayments: vi.fn(async (orderId: string) => [...payments.values()].filter((p) => p.order_id === orderId)),
    capturePayment: vi.fn(async (id: string) => {
      const p = payments.get(id)!;
      p.status = 'captured';
      return { ...p };
    }),
    refundPayment: vi.fn(async (paymentId: string, input: { amount: number }): Promise<GatewayRefund> => ({
      id: `rfnd_${crypto.randomBytes(7).toString('hex')}`,
      payment_id: paymentId,
      amount: input.amount,
      status: 'processed',
    })),
    /** Test helper: records a payment as Razorpay would after checkout. */
    simulatePayment(orderId: string, amount: number, status: GatewayPayment['status'] = 'captured') {
      const id = `pay_${crypto.randomBytes(7).toString('hex')}`;
      payments.set(id, { id, order_id: orderId, amount, currency: 'INR', status, method: 'upi' });
      return id;
    },
  };
  setPaymentGatewayForTests(gateway satisfies PaymentGateway);
  return gateway;
}

export const signCheckout = (orderId: string, paymentId: string) =>
  crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!).update(`${orderId}|${paymentId}`).digest('hex');

export const signWebhook = (body: string) =>
  crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!).update(body).digest('hex');

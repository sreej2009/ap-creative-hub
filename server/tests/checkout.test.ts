import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { setPaymentGatewayForTests } from '../src/integrations/razorpay.js';
import { Coupon, CouponUsage } from '../src/models/Coupon.js';
import { StoreSettings } from '../src/models/misc.js';
import { Order } from '../src/models/Order.js';
import { User } from '../src/models/User.js';
import { computeDiscount } from '../src/services/coupon.service.js';
import { invalidateSettingsCache } from '../src/services/settings.service.js';
import { TestClient, checkoutBody, connectTestDb, createProduct, createUser, disconnectTestDb, loginAs, mockGateway, resetDb } from './helpers.js';

const app = createApp();

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await resetDb();
  // Defaults: flat ₹79 shipping, free above ₹999, COD fee ₹49 up to ₹5,000.
  invalidateSettingsCache();
});

describe('checkout totals', () => {
  it('computes subtotal, shipping and COD fee on the server', async () => {
    const p = await createProduct({ price: 30000, salePrice: 25000, stock: 10 });
    const c = await TestClient.create(app);
    const res = await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(p._id), quantity: 2 }]));
    expect(res.status).toBe(201);
    expect(res.body.order.pricing).toEqual({ subtotal: 50000, discount: 0, shipping: 7900, codFee: 4900, total: 62800 });
    expect(res.body.order.items[0]).toMatchObject({ unitPrice: 25000, compareAtPrice: 30000, quantity: 2, lineTotal: 50000 });
    expect(res.body.order.status).toBe('placed');
    expect(res.body.order.payment.status).toBe('cod_pending');
  });

  it('gives free shipping above the threshold', async () => {
    const p = await createProduct({ price: 50000, stock: 10 });
    const c = await TestClient.create(app);
    const q = await c.post('/api/v1/cart/quote', { items: [{ productId: String(p._id), quantity: 2 }] });
    expect(q.body).toMatchObject({ subtotal: 100000, shipping: 0, total: 100000 });
    const below = await c.post('/api/v1/cart/quote', { items: [{ productId: String(p._id), quantity: 1 }] });
    expect(below.body).toMatchObject({ shipping: 7900, shippingInfo: { amountToFreeShipping: 49900 } });
  });

  it('ignores client-supplied prices and totals', async () => {
    const p = await createProduct({ price: 99900, stock: 3 });
    const c = await TestClient.create(app);
    const res = await c.post(
      '/api/v1/checkout/orders',
      checkoutBody([{ productId: String(p._id), quantity: 1, unitPrice: 100 } as never], { pricing: { total: 100 }, total: 100 }),
    );
    expect(res.status).toBe(201);
    expect(res.body.order.pricing.total).toBe(99900 + 4900);
  });

  it('rejects the order when the price changed since the customer saw it', async () => {
    const p = await createProduct({ price: 20000, stock: 3 });
    const c = await TestClient.create(app);
    const res = await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(p._id), quantity: 1 }], { expectedTotal: 15000 }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRICE_CHANGED');
    expect(res.body.error.details.quote.total).toBe(20000 + 7900 + 4900);
  });

  it('blocks COD when disabled or above the COD limit', async () => {
    const p = await createProduct({ price: 600000, stock: 3 });
    const c = await TestClient.create(app);
    const tooBig = await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(p._id), quantity: 1 }]));
    expect(tooBig.status).toBe(422);
    expect(tooBig.body.error.code).toBe('COD_UNAVAILABLE');

    await StoreSettings.updateOne({ _id: 'store' }, { 'cod.enabled': false });
    invalidateSettingsCache();
    const small = await createProduct({ price: 10000, stock: 3 });
    const disabled = await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(small._id), quantity: 1 }]));
    expect(disabled.status).toBe(422);
  });

  it('is idempotent for retried submissions', async () => {
    const p = await createProduct({ price: 10000, stock: 5 });
    const c = await TestClient.create(app);
    const body = checkoutBody([{ productId: String(p._id), quantity: 1 }]);
    const [a, b] = await Promise.all([c.post('/api/v1/checkout/orders', body), c.post('/api/v1/checkout/orders', body)]);
    expect([a.status, b.status].sort()).toEqual([201, 201]);
    expect(a.body.order.orderNumber).toBe(b.body.order.orderNumber);
    expect(await Order.countDocuments()).toBe(1);
  });

  it('refuses online payment with a clear message when Razorpay is not configured', async () => {
    setPaymentGatewayForTests(null);
    const p = await createProduct({ price: 10000, stock: 5 });
    const c = await TestClient.create(app);
    const q = await c.post('/api/v1/cart/quote', { items: [{ productId: String(p._id), quantity: 1 }] });
    expect(q.body.paymentMethods.razorpay).toEqual({ available: false, reason: 'Online payment is not configured yet.' });
    const res = await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(p._id), quantity: 1 }], { paymentMethod: 'razorpay' }));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PAYMENT_NOT_CONFIGURED');
    expect(await Order.countDocuments()).toBe(0);
    expect((await (await import('../src/models/Product.js')).Product.findById(p._id))!.stock).toBe(5);
    setPaymentGatewayForTests(undefined);
  });

  it('links orders to the signed-in customer and uses the account email', async () => {
    const { client, user } = await loginAs('customer', app);
    const p = await createProduct({ price: 10000, stock: 5 });
    const res = await client.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(p._id), quantity: 1 }], { saveAddress: true }));
    expect(res.status).toBe(201);
    const order = await Order.findOne({ orderNumber: res.body.order.orderNumber }).lean();
    expect(String(order!.user)).toBe(String(user._id));
    expect(order!.customer.email).toBe(user.email);
    const profile = await client.get('/api/v1/account/profile');
    expect(profile.body.addresses).toHaveLength(1);
  });
});

describe('coupons', () => {
  const coupon = (o: Record<string, unknown> = {}) =>
    Coupon.create({ code: 'WELCOME10', type: 'percent', value: 10, minOrderValue: 0, perCustomerLimit: 1, ...o });

  it('computes percentage and fixed discounts with caps', () => {
    expect(computeDiscount({ type: 'percent', value: 10, maxDiscount: null }, 50000)).toBe(5000);
    expect(computeDiscount({ type: 'percent', value: 50, maxDiscount: 10000 }, 50000)).toBe(10000);
    expect(computeDiscount({ type: 'fixed', value: 20000, maxDiscount: null }, 15000)).toBe(15000);
    expect(computeDiscount({ type: 'percent', value: 15, maxDiscount: null }, 999)).toBe(149);
  });

  it('applies a valid coupon server-side and records usage', async () => {
    await coupon();
    const p = await createProduct({ price: 50000, stock: 5 });
    const c = await TestClient.create(app);
    const res = await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(p._id), quantity: 1 }], { couponCode: 'welcome10' }));
    expect(res.status).toBe(201);
    expect(res.body.order.pricing).toMatchObject({ subtotal: 50000, discount: 5000, shipping: 7900 });
    expect(res.body.order.coupon).toEqual({ code: 'WELCOME10', discount: 5000 });
    expect((await Coupon.findOne({ code: 'WELCOME10' }))!.usedCount).toBe(1);
  });

  it('enforces expiry, start date, minimum order and active flag', async () => {
    const p = await createProduct({ price: 20000, stock: 5 });
    const c = await TestClient.create(app);
    const quote = (code: string) => c.post('/api/v1/cart/quote', { items: [{ productId: String(p._id), quantity: 1 }], couponCode: code });

    await coupon({ code: 'OLD', expiresAt: new Date(Date.now() - 1000) });
    await coupon({ code: 'SOON', startsAt: new Date(Date.now() + 86400_000) });
    await coupon({ code: 'BIG', minOrderValue: 50000 });
    await coupon({ code: 'OFF', isActive: false });

    expect((await quote('OLD')).body.coupon).toMatchObject({ valid: false, reason: 'COUPON_EXPIRED' });
    expect((await quote('SOON')).body.coupon).toMatchObject({ valid: false });
    expect((await quote('BIG')).body.coupon).toMatchObject({ valid: false, reason: 'COUPON_MIN_ORDER' });
    expect((await quote('OFF')).body.coupon).toMatchObject({ valid: false, reason: 'COUPON_INVALID' });
    expect((await quote('NOPE')).body.coupon).toMatchObject({ valid: false });

    const order = await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(p._id), quantity: 1 }], { couponCode: 'OLD' }));
    expect(order.status).toBe(422);
  });

  it('enforces the per-customer limit by email and phone', async () => {
    await coupon({ code: 'ONCE' });
    const p = await createProduct({ price: 20000, stock: 10 });
    const c = await TestClient.create(app);
    const first = await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(p._id), quantity: 1 }], { couponCode: 'ONCE' }));
    expect(first.status).toBe(201);
    // Same phone, different email — still blocked.
    const second = await c.post(
      '/api/v1/checkout/orders',
      checkoutBody([{ productId: String(p._id), quantity: 1 }], { couponCode: 'ONCE', customer: { name: 'Pooja', email: 'other@example.com', phone: '9876543210' } }),
    );
    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe('COUPON_ALREADY_USED');
  });

  it('cannot exceed the global usage limit under concurrency', async () => {
    await coupon({ code: 'FIRST3', usageLimit: 3, perCustomerLimit: null });
    const p = await createProduct({ price: 20000, stock: 50 });
    const results = await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        const c = await TestClient.create(app);
        return c.post(
          '/api/v1/checkout/orders',
          checkoutBody([{ productId: String(p._id), quantity: 1 }], {
            couponCode: 'FIRST3',
            customer: { name: 'Buyer', email: `buyer${i}@example.com`, phone: `98765432${10 + i}` },
          }),
        );
      }),
    );
    const withCoupon = results.filter((r) => r.status === 201);
    expect(withCoupon).toHaveLength(3);
    expect((await Coupon.findOne({ code: 'FIRST3' }))!.usedCount).toBe(3);
  });

  it('returns the coupon use when an unpaid order is cancelled', async () => {
    mockGateway();
    await coupon({ code: 'BACK', usageLimit: 1 });
    const p = await createProduct({ price: 20000, stock: 5 });
    const c = await TestClient.create(app);
    const res = await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(p._id), quantity: 1 }], { couponCode: 'BACK', paymentMethod: 'razorpay' }));
    expect(res.status).toBe(201);
    expect((await Coupon.findOne({ code: 'BACK' }))!.usedCount).toBe(1);
    const cancel = await c.post(`/api/v1/track/${res.body.order.orderNumber}/cancel`, { reason: 'Changed my mind', token: res.body.trackingToken });
    expect(cancel.status).toBe(200);
    expect((await Coupon.findOne({ code: 'BACK' }))!.usedCount).toBe(0);
    expect(await CouponUsage.countDocuments({ count: { $gt: 0 } })).toBe(0);
    setPaymentGatewayForTests(undefined);
  });

  it('lets only admins manage coupons and validates input', async () => {
    const { client } = await loginAs('admin', app);
    const bad = await client.post('/api/v1/admin/coupons', { code: 'X', type: 'percent', value: 150 });
    expect(bad.status).toBe(400);
    const ok = await client.post('/api/v1/admin/coupons', { code: 'DIWALI15', type: 'percent', value: 15, maxDiscount: 20000, minOrderValue: 49900 });
    expect(ok.status).toBe(201);
    expect(ok.body.state).toBe('active');
    const dup = await client.post('/api/v1/admin/coupons', { code: 'diwali15', type: 'fixed', value: 5000 });
    expect(dup.status).toBe(409);
  });
});

describe('create an account at checkout', () => {
  it('creates the account, signs the guest in and puts the order on it', async () => {
    const p = await createProduct({ price: 50000, stock: 5 });
    const c = await TestClient.create(app);
    const res = await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(p._id), quantity: 1 }], { accountPassword: 'Earrings2026' }));
    expect(res.status).toBe(201);
    expect(res.body.accountCreated).toBe(true);

    const user = await User.findOne({ email: 'priya@example.com' });
    expect(user).toMatchObject({ name: 'Priya Sharma', phone: '9876543210', role: 'customer' });
    expect(user!.addresses).toHaveLength(1);
    const order = await Order.findOne({ orderNumber: res.body.order.orderNumber });
    expect(String(order!.user)).toBe(String(user!._id));

    // Already signed in on this browser…
    const mine = await c.get('/api/v1/account/orders');
    expect(mine.status).toBe(200);
    expect(mine.body.items.map((o: { orderNumber: string }) => o.orderNumber)).toEqual([res.body.order.orderNumber]);

    // …and can sign in later with the same email and password.
    const later = await TestClient.create(app);
    expect((await later.post('/api/v1/auth/login', { email: 'priya@example.com', password: 'Earrings2026' })).status).toBe(200);
    expect((await later.get('/api/v1/account/orders')).body.items).toHaveLength(1);
  });

  it('refuses an email that already has an account, without placing the order', async () => {
    await createUser('customer', { email: 'priya@example.com' });
    const p = await createProduct({ stock: 5 });
    const c = await TestClient.create(app);
    const res = await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(p._id), quantity: 1 }], { accountPassword: 'Earrings2026' }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
    expect(await Order.countDocuments()).toBe(0);
  });

  it('rejects a weak password and creates nothing', async () => {
    const p = await createProduct({ stock: 5 });
    const c = await TestClient.create(app);
    const res = await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(p._id), quantity: 1 }], { accountPassword: 'short' }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.accountPassword).toBeDefined();
    expect(await User.countDocuments({ email: 'priya@example.com' })).toBe(0);
    expect(await Order.countDocuments()).toBe(0);
  });

  it('ignores the password for a customer who is already signed in', async () => {
    const p = await createProduct({ stock: 5 });
    const { client, user } = await loginAs('customer', app);
    const res = await client.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(p._id), quantity: 1 }], { accountPassword: 'Earrings2026' }));
    expect(res.status).toBe(201);
    expect(res.body.accountCreated).toBe(false);
    expect(await User.countDocuments({ email: 'priya@example.com' })).toBe(0);
    expect(String((await Order.findOne({ orderNumber: res.body.order.orderNumber }))!.user)).toBe(String(user._id));
  });

  it('replays a retried request instead of failing on the new account', async () => {
    const p = await createProduct({ stock: 5 });
    const body = checkoutBody([{ productId: String(p._id), quantity: 1 }], { accountPassword: 'Earrings2026' });
    const first = await (await TestClient.create(app)).post('/api/v1/checkout/orders', body);
    expect(first.status).toBe(201);
    const retry = await (await TestClient.create(app)).post('/api/v1/checkout/orders', body);
    expect(retry.status).toBeLessThan(300);
    expect(retry.body.order.orderNumber).toBe(first.body.order.orderNumber);
    expect(await Order.countDocuments()).toBe(1);
    expect(await User.countDocuments({ email: 'priya@example.com' })).toBe(1);
  });
});


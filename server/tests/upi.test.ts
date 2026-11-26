import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { expireStaleOrders } from '../src/jobs/index.js';
import { StoreSettings } from '../src/models/misc.js';
import { Order } from '../src/models/Order.js';
import { PaymentTransaction } from '../src/models/PaymentTransaction.js';
import { Product } from '../src/models/Product.js';
import { invalidateSettingsCache } from '../src/services/settings.service.js';
import { TestClient, checkoutBody, connectTestDb, createProduct, disconnectTestDb, loginAs, resetDb } from './helpers.js';

const app = createApp();

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await resetDb();
  await StoreSettings.updateOne({ _id: 'store' }, { upi: { enabled: true, vpa: 'apstore@okaxis', payeeName: 'A&P Creative Hub' } });
  invalidateSettingsCache();
});

const payer = { payerName: 'Priya Sharma', payerUpiId: 'priya@oksbi', utr: '412345678901' };

async function placeUpiOrder(stock = 5, quantity = 2) {
  const p = await createProduct({ price: 50000, stock });
  const c = await TestClient.create(app);
  const res = await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(p._id), quantity }], { paymentMethod: 'upi' }));
  expect(res.status).toBe(201);
  return { c, product: p, orderNumber: res.body.order.orderNumber as string, token: res.body.trackingToken as string, body: res.body };
}

describe('manual UPI payments', () => {
  it('is offered only when the store has a UPI ID set', async () => {
    const p = await createProduct({ price: 50000, stock: 5 });
    const c = await TestClient.create(app);
    const on = await c.post('/api/v1/cart/quote', { items: [{ productId: String(p._id), quantity: 1 }] });
    expect(on.body.paymentMethods.upi).toEqual({ available: true });
    const pub = await c.get('/api/v1/store/settings');
    expect(pub.body.payments.upi).toEqual({ enabled: true, vpa: 'apstore@okaxis', payeeName: 'A&P Creative Hub' });

    await StoreSettings.updateOne({ _id: 'store' }, { 'upi.enabled': false });
    invalidateSettingsCache();
    const off = await c.post('/api/v1/cart/quote', { items: [{ productId: String(p._id), quantity: 1 }] });
    expect(off.body.paymentMethods.upi.available).toBe(false);
    const res = await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(p._id), quantity: 1 }], { paymentMethod: 'upi' }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UPI_UNAVAILABLE');
  });

  it('holds stock while unpaid, then waits for staff after the customer submits the UTR', async () => {
    const { c, product, orderNumber, token, body } = await placeUpiOrder();
    expect(body.order).toMatchObject({ status: 'pending_payment', payment: { method: 'upi', status: 'awaiting_payment' } });
    expect(body.order.actions).toMatchObject({ canSubmitUpi: true, canPay: false });
    expect((await Product.findById(product._id))!.stock).toBe(3);

    const bad = await c.post('/api/v1/payments/upi/submit', { orderNumber, token, ...payer, utr: '12345' });
    expect(bad.status).toBe(400);

    const res = await c.post('/api/v1/payments/upi/submit', { orderNumber, token, ...payer, utr: '4123 4567 8901' });
    expect(res.status).toBe(200);
    expect(res.body.order).toMatchObject({
      status: 'pending_payment',
      payment: { status: 'verification_pending', upi: { utrLast4: '8901' } },
      actions: { canSubmitUpi: false, canCancel: false },
    });

    const saved = await Order.findOne({ orderNumber }).lean();
    expect(saved!.payment.upi).toMatchObject(payer);
    expect(saved!.reservationExpiresAt).toBeNull();
    expect(saved!.attention?.reason).toContain('412345678901');

    // Submitting twice is refused; the customer cannot cancel a "paid" order themselves.
    expect((await c.post('/api/v1/payments/upi/submit', { orderNumber, token, ...payer })).body.error.code).toBe('ALREADY_SUBMITTED');
    expect((await c.post(`/api/v1/track/${orderNumber}/cancel`, { token, reason: 'changed my mind' })).status).toBe(409);

    // The expiry job must not cancel an order whose payment is being verified.
    await expireStaleOrders(new Date(Date.now() + 24 * 3600_000));
    expect((await Order.findOne({ orderNumber }).lean())!.status).toBe('pending_payment');
  });

  it('marks the order paid when staff confirm', async () => {
    const { c, product, orderNumber, token } = await placeUpiOrder();
    await c.post('/api/v1/payments/upi/submit', { orderNumber, token, ...payer });
    const order = await Order.findOne({ orderNumber }).lean();

    const { client: admin } = await loginAs('admin', app);
    const before = await admin.get(`/api/v1/admin/orders/${order!._id}`);
    expect(before.body.actions.canVerifyUpi).toBe(true);
    expect(before.body.payment.upi).toMatchObject(payer);

    const res = await admin.post(`/api/v1/admin/orders/${order!._id}/upi/confirm`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'payment_confirmed', payment: { status: 'paid', amountPaid: 100000 }, attention: null, inventoryState: 'committed' });
    expect(res.body.actions.canVerifyUpi).toBe(false);
    const fresh = await Product.findById(product._id).lean();
    expect(fresh).toMatchObject({ stock: 3, soldCount: 2 });
    const txn = await PaymentTransaction.findOne({ order: order!._id }).lean();
    expect(txn).toMatchObject({ provider: 'upi', type: 'payment', amount: 100000, status: 'recorded' });

    // Confirming again is a no-op error, not a double payment.
    expect((await admin.post(`/api/v1/admin/orders/${order!._id}/upi/confirm`)).status).toBe(409);
  });

  it('cancels the order and releases stock when staff reject', async () => {
    const { c, product, orderNumber, token } = await placeUpiOrder();
    await c.post('/api/v1/payments/upi/submit', { orderNumber, token, ...payer });
    const order = await Order.findOne({ orderNumber }).lean();
    const { client: admin } = await loginAs('admin', app);
    const res = await admin.post(`/api/v1/admin/orders/${order!._id}/upi/reject`, { reason: 'No payment with this UTR' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'cancelled', payment: { status: 'void' }, attention: null });
    expect((await Product.findById(product._id))!.stock).toBe(5);
    const track = await c.get(`/api/v1/track/${orderNumber}?token=${encodeURIComponent(token)}`);
    expect(track.body.order.cancellation.reason).toContain('No payment with this UTR');
  });

  it('refuses a UTR already used on another order', async () => {
    const first = await placeUpiOrder();
    await first.c.post('/api/v1/payments/upi/submit', { orderNumber: first.orderNumber, token: first.token, ...payer });
    const second = await placeUpiOrder();
    const res = await second.c.post('/api/v1/payments/upi/submit', { orderNumber: second.orderNumber, token: second.token, ...payer });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('UTR_ALREADY_USED');
  });

  it('refuses submissions after the payment window closes, and needs the order token', async () => {
    const { c, orderNumber, token } = await placeUpiOrder();
    expect((await c.post('/api/v1/payments/upi/submit', { orderNumber, ...payer })).status).toBe(404);
    await Order.updateOne({ orderNumber }, { reservationExpiresAt: new Date(Date.now() - 1000) });
    const res = await c.post('/api/v1/payments/upi/submit', { orderNumber, token, ...payer });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAYMENT_WINDOW_EXPIRED');
  });

  it('validates the UPI settings', async () => {
    const { client: admin } = await loginAs('admin', app);
    const current = (await admin.get('/api/v1/admin/settings')).body;
    const settings = current.settings ?? current;
    const { _id, updatedAt, updatedBy, ...rest } = settings;
    void _id;
    void updatedAt;
    void updatedBy;
    const missing = await admin.put('/api/v1/admin/settings', { ...rest, upi: { enabled: true, vpa: '', payeeName: 'A&P' } });
    expect(missing.status).toBe(400);
    const invalid = await admin.put('/api/v1/admin/settings', { ...rest, upi: { enabled: true, vpa: 'not a upi id', payeeName: 'A&P' } });
    expect(invalid.status).toBe(400);
    const ok = await admin.put('/api/v1/admin/settings', { ...rest, upi: { enabled: true, vpa: 'NewID@okhdfcbank', payeeName: 'A&P' } });
    expect(ok.status).toBe(200);
    expect((await StoreSettings.findById('store').lean())!.upi.vpa).toBe('newid@okhdfcbank');
  });
});

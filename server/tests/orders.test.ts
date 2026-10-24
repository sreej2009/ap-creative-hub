import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { setEmailTransportForTests } from '../src/integrations/email.js';
import { setPaymentGatewayForTests } from '../src/integrations/razorpay.js';
import { ADMIN_TRANSITIONS, canTransition } from '../src/lib/orderStatus.js';
import { Notification } from '../src/models/misc.js';
import { Order } from '../src/models/Order.js';
import { PaymentTransaction } from '../src/models/PaymentTransaction.js';
import { Product } from '../src/models/Product.js';
import { notifications } from '../src/services/notification.service.js';
import {
  TestClient,
  checkoutBody,
  connectTestDb,
  createProduct,
  disconnectTestDb,
  loginAs,
  mockGateway,
  resetDb,
  signCheckout,
} from './helpers.js';

const app = createApp();

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(resetDb);
afterEach(() => {
  setPaymentGatewayForTests(undefined);
  setEmailTransportForTests(undefined);
});

async function placeCod(client?: TestClient, stock = 5) {
  const p = await createProduct({ price: 20000, stock });
  const c = client ?? (await TestClient.create(app));
  const res = await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(p._id), quantity: 2 }]));
  expect(res.status).toBe(201);
  const order = await Order.findOne({ orderNumber: res.body.order.orderNumber }).lean();
  return { c, p, token: res.body.trackingToken as string, orderNumber: res.body.order.orderNumber as string, id: String(order!._id) };
}

async function placePaidOnline() {
  const gateway = mockGateway();
  const p = await createProduct({ price: 20000, stock: 5 });
  const c = await TestClient.create(app);
  const res = await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(p._id), quantity: 1 }], { paymentMethod: 'razorpay' }));
  const { payment } = res.body;
  const payId = gateway.simulatePayment(payment.razorpayOrderId, payment.amount);
  await c.post('/api/v1/payments/razorpay/verify', {
    orderNumber: res.body.order.orderNumber,
    razorpay_order_id: payment.razorpayOrderId,
    razorpay_payment_id: payId,
    razorpay_signature: signCheckout(payment.razorpayOrderId, payId),
  });
  const order = await Order.findOne({ orderNumber: res.body.order.orderNumber }).lean();
  return { gateway, c, p, id: String(order!._id), orderNumber: order!.orderNumber, token: res.body.trackingToken as string, payId };
}

describe('status transition rules', () => {
  it('only allows defined forward transitions', () => {
    expect(canTransition('placed', 'processing')).toBe(true);
    expect(canTransition('placed', 'delivered')).toBe(false);
    expect(canTransition('delivered', 'processing')).toBe(false);
    expect(canTransition('cancelled', 'processing')).toBe(false);
    for (const targets of Object.values(ADMIN_TRANSITIONS)) {
      expect(targets).not.toContain('payment_confirmed');
      expect(targets).not.toContain('refunded');
      expect(targets).not.toContain('cancelled');
    }
  });

  it('moves an order through fulfilment, recording timestamp, actor and note', async () => {
    const sent: string[] = [];
    setEmailTransportForTests({ send: async (m) => (sent.push(m.subject), { messageId: 'm' }) });
    const { id, orderNumber, token } = await placeCod();
    const { client, user } = await loginAs('staff', app);

    const skip = await client.post(`/api/v1/admin/orders/${id}/status`, { status: 'shipped' });
    expect(skip.status).toBe(409);
    expect(skip.body.error.code).toBe('INVALID_TRANSITION');

    expect((await client.post(`/api/v1/admin/orders/${id}/status`, { status: 'processing' })).status).toBe(200);
    expect((await client.post(`/api/v1/admin/orders/${id}/status`, { status: 'packed', note: 'Packed with love' })).status).toBe(200);

    const noTracking = await client.post(`/api/v1/admin/orders/${id}/status`, { status: 'shipped' });
    expect(noTracking.status).toBe(422);
    expect(noTracking.body.error.code).toBe('SHIPMENT_REQUIRED');

    const shipped = await client.post(`/api/v1/admin/orders/${id}/status`, {
      status: 'shipped',
      shipment: { courierName: 'Delhivery', trackingNumber: 'DLV123456', trackingUrl: 'https://www.delhivery.com/track/package/DLV123456' },
    });
    expect(shipped.status).toBe(200);
    expect(shipped.body.shipment).toMatchObject({ courierName: 'Delhivery', trackingNumber: 'DLV123456' });

    const delivered = await client.post(`/api/v1/admin/orders/${id}/status`, { status: 'delivered' });
    expect(delivered.body.status).toBe('delivered');

    const order = await Order.findById(id).lean();
    const packed = order!.timeline.find((t) => t.status === 'packed')!;
    expect(packed.note).toBe('Packed with love');
    expect(String(packed.actor.id)).toBe(String(user._id));
    expect(packed.actor.type).toBe('staff');
    expect(packed.at).toBeInstanceOf(Date);
    expect(order!.shipment.deliveredAt).toBeTruthy();

    // Customer tracking reflects the updates; staff names are not exposed.
    const pub = await (await TestClient.create(app)).get(`/api/v1/track/${orderNumber}?token=${token}`);
    expect(pub.body.order.timeline.map((t: { status: string }) => t.status)).toEqual(['placed', 'processing', 'packed', 'shipped', 'delivered']);
    expect(pub.body.order.timeline[2]).toMatchObject({ note: 'Packed with love', by: 'A&P team' });
    expect(JSON.stringify(pub.body)).not.toContain(user.name);

    await notifications.flush();
    expect(sent.some((s) => s.includes('shipped'))).toBe(true);
    expect(sent.some((s) => s.includes('delivered'))).toBe(true);
  });

  it('does not allow admins to fake payment confirmation or refunds via status', async () => {
    const { id } = await placeCod();
    const { client } = await loginAs('admin', app);
    for (const status of ['payment_confirmed', 'refunded', 'returned', 'cancelled']) {
      const res = await client.post(`/api/v1/admin/orders/${id}/status`, { status });
      expect(res.status, status).toBe(400);
    }
  });
});

describe('order privacy and tracking', () => {
  it('shows customers only their own orders', async () => {
    const alice = await loginAs('customer', app);
    const bob = await loginAs('customer', app);
    const { orderNumber } = await placeCod(alice.client);

    expect((await alice.client.get(`/api/v1/account/orders/${orderNumber}`)).status).toBe(200);
    expect((await bob.client.get(`/api/v1/account/orders/${orderNumber}`)).status).toBe(404);
    expect((await bob.client.get(`/api/v1/track/${orderNumber}`)).status).toBe(404);
    const bobList = await bob.client.get('/api/v1/account/orders');
    expect(bobList.body.items).toHaveLength(0);
  });

  it('requires the secret token for guest tracking and masks contact details', async () => {
    const { orderNumber, token } = await placeCod();
    const stranger = await TestClient.create(app);
    expect((await stranger.get(`/api/v1/track/${orderNumber}`)).status).toBe(404);
    expect((await stranger.get(`/api/v1/track/${orderNumber}?token=${'x'.repeat(32)}`)).status).toBe(404);
    expect((await stranger.get(`/api/v1/track/AP-000000-AAAAA?token=${token}`)).status).toBe(404);

    const ok = await stranger.get(`/api/v1/track/${orderNumber}?token=${token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.order.customer.email).toBeNull();
    expect(ok.body.order.customer.phone).toBe('******3210');
    expect(ok.body.order.shippingAddress.line1).toBeUndefined();
  });

  it('only shows courier events that came from an integration', async () => {
    const { orderNumber, token } = await placeCod();
    const res = await (await TestClient.create(app)).get(`/api/v1/track/${orderNumber}?token=${token}`);
    expect(res.body.order.courierEvents).toEqual([]);
  });
});

describe('cancellation rules', () => {
  it('lets customers cancel before processing and restores stock exactly once', async () => {
    const { c, p, orderNumber, token, id } = await placeCod(undefined, 5);
    expect((await Product.findById(p._id))!.stock).toBe(3);
    const res = await c.post(`/api/v1/track/${orderNumber}/cancel`, { reason: 'Ordered by mistake', token });
    expect(res.status).toBe(200);
    expect(res.body.order).toMatchObject({ status: 'cancelled', payment: { status: 'void' } });
    expect((await Product.findById(p._id))!.stock).toBe(5);

    const again = await c.post(`/api/v1/track/${orderNumber}/cancel`, { reason: 'Again', token });
    expect(again.status).toBe(409);
    const { client } = await loginAs('admin', app);
    expect((await client.post(`/api/v1/admin/orders/${id}/cancel`, { reason: 'dup' })).status).toBe(409);
    expect((await Product.findById(p._id))!.stock).toBe(5);
  });

  it('stops customers cancelling once the order is being processed, but admins can until shipped', async () => {
    const { c, orderNumber, token, id } = await placeCod();
    const { client } = await loginAs('admin', app);
    await client.post(`/api/v1/admin/orders/${id}/status`, { status: 'processing' });
    const denied = await c.post(`/api/v1/track/${orderNumber}/cancel`, { reason: 'Too late?', token });
    expect(denied.status).toBe(409);
    const adminCancel = await client.post(`/api/v1/admin/orders/${id}/cancel`, { reason: 'Customer called support' });
    expect(adminCancel.status).toBe(200);
    expect(adminCancel.body.status).toBe('cancelled');

    const shippedOrder = await placeCod();
    await client.post(`/api/v1/admin/orders/${shippedOrder.id}/status`, { status: 'processing' });
    await client.post(`/api/v1/admin/orders/${shippedOrder.id}/status`, { status: 'packed' });
    await client.post(`/api/v1/admin/orders/${shippedOrder.id}/status`, { status: 'shipped', shipment: { courierName: 'DTDC', trackingNumber: 'D1234' } });
    const tooLate = await client.post(`/api/v1/admin/orders/${shippedOrder.id}/cancel`, { reason: 'x' + 'y'.repeat(5) });
    expect(tooLate.status).toBe(409);
  });

  it('flags a refund when a paid order is cancelled', async () => {
    const { c, orderNumber, token, id } = await placePaidOnline();
    const res = await c.post(`/api/v1/track/${orderNumber}/cancel`, { reason: 'No longer needed', token });
    expect(res.status).toBe(200);
    const order = await Order.findById(id).lean();
    expect(order).toMatchObject({ status: 'cancelled', payment: { status: 'paid' } });
    expect(order!.attention?.reason).toMatch(/refund required/i);
  });
});

describe('refunds', () => {
  it('refunds cancelled online orders through the payment provider only', async () => {
    const { gateway, c, orderNumber, token, id, payId } = await placePaidOnline();
    const { client } = await loginAs('admin', app);

    const notYet = await client.post(`/api/v1/admin/orders/${id}/refunds`, { reason: 'Customer request' });
    expect(notYet.status).toBe(409); // not cancelled/returned yet

    await c.post(`/api/v1/track/${orderNumber}/cancel`, { reason: 'Changed mind', token });
    const tooMuch = await client.post(`/api/v1/admin/orders/${id}/refunds`, { amount: 9_999_999, reason: 'Oops' });
    expect(tooMuch.status).toBe(409);

    const res = await client.post(`/api/v1/admin/orders/${id}/refunds`, { reason: 'Cancelled by customer' });
    expect(res.status).toBe(200);
    expect(gateway.refundPayment).toHaveBeenCalledWith(payId, expect.objectContaining({ amount: 27900 }));
    expect(res.body.order).toMatchObject({ status: 'refunded', payment: { status: 'refunded', amountRefunded: 27900 } });
    expect(res.body.order.attention).toBeNull();

    const twice = await client.post(`/api/v1/admin/orders/${id}/refunds`, { reason: 'Again' });
    expect(twice.status).toBe(409);
    expect(gateway.refundPayment).toHaveBeenCalledTimes(1);
  });

  it('finalises pending refunds from the webhook exactly once', async () => {
    const { gateway, c, orderNumber, token, id } = await placePaidOnline();
    gateway.refundPayment.mockImplementationOnce(async (paymentId: string, input: { amount: number }) => ({ id: 'rfnd_pending1', payment_id: paymentId, amount: input.amount, status: 'pending' as const }));
    await c.post(`/api/v1/track/${orderNumber}/cancel`, { reason: 'Changed mind', token });
    const { client } = await loginAs('admin', app);
    const res = await client.post(`/api/v1/admin/orders/${id}/refunds`, { reason: 'Cancelled' });
    expect(res.body.order.payment.status).toBe('refund_pending');

    const { signWebhook } = await import('./helpers.js');
    const body = JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_pending1', payment_id: 'x', amount: 27900, status: 'processed' } } } });
    for (const eventId of ['evt_r1', 'evt_r2']) {
      await c.agent
        .post('/api/v1/payments/razorpay/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', signWebhook(body))
        .set('X-Razorpay-Event-Id', eventId)
        .send(body);
    }
    const order = await Order.findById(id).lean();
    expect(order).toMatchObject({ status: 'refunded', payment: { amountRefunded: 27900, refundReserved: 0 } });
  });

  it('only allows refunds by admins, not staff', async () => {
    const { id } = await placePaidOnline();
    const { client } = await loginAs('staff', app);
    expect((await client.post(`/api/v1/admin/orders/${id}/refunds`, { reason: 'x'.repeat(5) })).status).toBe(403);
  });

  it('records COD collection and manual COD refunds after a return', async () => {
    const { c, orderNumber, token, id, p } = await placeCod(undefined, 5);
    const { client } = await loginAs('admin', app);
    const early = await client.post(`/api/v1/admin/orders/${id}/cod-collected`, {});
    expect(early.status).toBe(409);

    for (const status of ['processing', 'packed']) await client.post(`/api/v1/admin/orders/${id}/status`, { status });
    await client.post(`/api/v1/admin/orders/${id}/status`, { status: 'shipped', shipment: { courierName: 'India Post', trackingNumber: 'EE123456789IN' } });
    await client.post(`/api/v1/admin/orders/${id}/status`, { status: 'delivered' });
    const collected = await client.post(`/api/v1/admin/orders/${id}/cod-collected`, { reference: 'Remittance 42' });
    expect(collected.body.payment).toMatchObject({ status: 'paid', amountPaid: 40000 + 7900 + 4900 });

    // Online refund API refuses COD orders
    const ret = await c.post(`/api/v1/track/${orderNumber}/return`, { reason: 'The clasp arrived broken.', token });
    expect(ret.status).toBe(200);
    expect(ret.body.order.status).toBe('return_requested');
    const resolved = await client.post(`/api/v1/admin/orders/${id}/return`, { approve: true, restock: true });
    expect(resolved.body.status).toBe('returned');
    expect((await Product.findById(p._id))!.stock).toBe(5);

    const viaRazorpay = await client.post(`/api/v1/admin/orders/${id}/refunds`, { reason: 'Returned' });
    expect(viaRazorpay.status).toBe(422);
    const manual = await client.post(`/api/v1/admin/orders/${id}/manual-refunds`, { amount: 52800, reference: 'UPI ref 998877' });
    expect(manual.status).toBe(200);
    expect(manual.body.order).toMatchObject({ status: 'refunded', payment: { status: 'refunded' } });
    const txn = await PaymentTransaction.findOne({ order: id, type: 'refund' }).lean();
    expect(txn).toMatchObject({ provider: 'manual', reference: 'UPI ref 998877' });
  });

  it('rejects return requests outside the return window', async () => {
    const { c, orderNumber, token, id } = await placeCod();
    const { client } = await loginAs('admin', app);
    for (const status of ['processing', 'packed']) await client.post(`/api/v1/admin/orders/${id}/status`, { status });
    await client.post(`/api/v1/admin/orders/${id}/status`, { status: 'shipped', shipment: { courierName: 'DTDC', trackingNumber: 'D9999' } });
    await client.post(`/api/v1/admin/orders/${id}/status`, { status: 'delivered' });
    await Order.updateOne({ _id: id }, { 'shipment.deliveredAt': new Date(Date.now() - 30 * 86400_000) });
    const res = await c.post(`/api/v1/track/${orderNumber}/return`, { reason: 'Too late to return this?', token });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RETURN_WINDOW_CLOSED');
  });
});

describe('notifications and admin tools', () => {
  it('logs skipped notifications honestly when no provider is configured', async () => {
    setEmailTransportForTests(null);
    const { id } = await placeCod();
    await notifications.flush();
    const logs = await Notification.find({ order: id }).lean();
    expect(logs.find((l) => l.channel === 'email')).toMatchObject({ event: 'order_confirmation', status: 'skipped', reason: 'email_provider_not_configured' });
    expect(logs.find((l) => l.channel === 'whatsapp')).toMatchObject({ status: 'skipped', reason: 'no_customer_opt_in' });
    expect(logs.some((l) => l.status === 'sent')).toBe(false);
  });

  it('searches, filters and safely exports orders', async () => {
    await placeCod();
    const p = await createProduct({ name: '=HYPERLINK("x")', stock: 5 });
    const c = await TestClient.create(app);
    await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(p._id), quantity: 1 }], { customer: { name: '=cmd|calc', email: 'evil@example.com', phone: '9123456780' } }));
    const { client } = await loginAs('admin', app);

    const all = await client.get('/api/v1/admin/orders');
    expect(all.body.meta.total).toBe(2);
    const byEmail = await client.get('/api/v1/admin/orders?q=evil@example');
    expect(byEmail.body.items).toHaveLength(1);
    const byStatus = await client.get('/api/v1/admin/orders?status=placed&paymentStatus=cod_pending');
    expect(byStatus.body.items).toHaveLength(2);
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    expect((await client.get(`/api/v1/admin/orders?from=${today}&to=${today}`)).body.items).toHaveLength(2);
    expect((await client.get('/api/v1/admin/orders?from=2000-01-01&to=2000-01-02')).body.items).toHaveLength(0);

    const csv = await client.get('/api/v1/admin/orders/export');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain("'=cmd|calc");
    expect(csv.text).not.toMatch(/,=cmd/);
  });

  it('builds dashboard metrics from real records only', async () => {
    const { client } = await loginAs('admin', app);
    const empty = await client.get('/api/v1/admin/dashboard?range=7');
    expect(empty.body.kpis).toMatchObject({ orders: 0, netSales: 0 });
    expect(empty.body.trend).toHaveLength(7);

    await placeCod(); // not paid yet: counts as an order, not as sales
    await placePaidOnline();
    const dash = await client.get('/api/v1/admin/dashboard?range=7');
    expect(dash.body.kpis).toMatchObject({ orders: 2, onlineSales: 27900, codCollected: 0, netSales: 27900 });
    expect(dash.body.pipeline.pending).toBe(2);
    expect(dash.body.recentOrders).toHaveLength(2);
    expect(dash.body.trend.at(-1)).toMatchObject({ sales: 27900, orders: 2 });
  });
});

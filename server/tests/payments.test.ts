import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { setPaymentGatewayForTests } from '../src/integrations/razorpay.js';
import { verifyCheckoutSignature, verifyWebhookSignature } from '../src/integrations/razorpay.js';
import { expireStaleOrders } from '../src/jobs/index.js';
import { InventoryAdjustment } from '../src/models/InventoryAdjustment.js';
import { Order } from '../src/models/Order.js';
import { PaymentTransaction, WebhookEvent } from '../src/models/PaymentTransaction.js';
import { Product } from '../src/models/Product.js';
import {
  TestClient,
  checkoutBody,
  connectTestDb,
  createProduct,
  disconnectTestDb,
  mockGateway,
  resetDb,
  signCheckout,
  signWebhook,
} from './helpers.js';

/*
 * All Razorpay interactions in this file use an in-memory mock gateway.
 * Signatures are computed with real HMAC-SHA256 using test-only secrets.
 * No requests are sent to Razorpay.
 */

const app = createApp();
let gateway: ReturnType<typeof mockGateway>;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await resetDb();
  gateway = mockGateway();
});
afterEach(() => setPaymentGatewayForTests(undefined));

async function placeOnlineOrder(stock = 5, price = 20000) {
  const p = await createProduct({ price, stock });
  const c = await TestClient.create(app);
  const res = await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(p._id), quantity: 1 }], { paymentMethod: 'razorpay' }));
  expect(res.status).toBe(201);
  return { c, p, res, payment: res.body.payment, orderNumber: res.body.order.orderNumber as string };
}

function webhook(event: string, payload: object, eventId = `evt_${Math.random().toString(36).slice(2)}`) {
  const body = JSON.stringify({ event, payload });
  return { body, eventId, signature: signWebhook(body) };
}

async function sendWebhook(c: TestClient, w: { body: string; eventId: string; signature: string }) {
  return c.agent
    .post('/api/v1/payments/razorpay/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Razorpay-Signature', w.signature)
    .set('X-Razorpay-Event-Id', w.eventId)
    .send(w.body);
}

describe('signature verification', () => {
  it('validates checkout and webhook HMAC signatures', () => {
    expect(verifyCheckoutSignature('order_1', 'pay_1', signCheckout('order_1', 'pay_1'))).toBe(true);
    expect(verifyCheckoutSignature('order_1', 'pay_2', signCheckout('order_1', 'pay_1'))).toBe(false);
    expect(verifyCheckoutSignature('order_1', 'pay_1', '')).toBe(false);
    const body = Buffer.from('{"event":"x"}');
    expect(verifyWebhookSignature(body, signWebhook('{"event":"x"}'))).toBe(true);
    expect(verifyWebhookSignature(body, signWebhook('{"event":"y"}'))).toBe(false);
  });
});

describe('Razorpay checkout', () => {
  it('creates a Razorpay order on the backend and holds stock while awaiting payment', async () => {
    const { payment, res, p } = await placeOnlineOrder(5, 20000);
    expect(gateway.createOrder).toHaveBeenCalledWith(expect.objectContaining({ amount: 27900, currency: 'INR' }));
    expect(payment).toMatchObject({ provider: 'razorpay', keyId: 'rzp_test_mockkey000000', amount: 27900, currency: 'INR' });
    expect(JSON.stringify(res.body)).not.toContain('mock_key_secret');
    expect(res.body.order.status).toBe('pending_payment');
    expect((await Product.findById(p._id))!.stock).toBe(4);
  });

  it('confirms payment only after signature + server-side verification', async () => {
    const { c, payment, orderNumber } = await placeOnlineOrder();
    const payId = gateway.simulatePayment(payment.razorpayOrderId, payment.amount);
    const res = await c.post('/api/v1/payments/razorpay/verify', {
      orderNumber,
      razorpay_order_id: payment.razorpayOrderId,
      razorpay_payment_id: payId,
      razorpay_signature: signCheckout(payment.razorpayOrderId, payId),
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ result: 'confirmed', status: 'payment_confirmed', paymentStatus: 'paid' });
    expect(gateway.fetchPayment).toHaveBeenCalledWith(payId);
    const order = await Order.findOne({ orderNumber }).lean();
    expect(order).toMatchObject({ inventoryState: 'committed', payment: { amountPaid: 27900, razorpayPaymentId: payId } });
    const txn = await PaymentTransaction.findOne({ providerPaymentId: payId }).lean();
    expect(txn!.verifiedVia).toContain('signature+api');
  });

  it('never marks an order paid because the frontend says so', async () => {
    const { c, payment, orderNumber } = await placeOnlineOrder();
    // Forged signature
    const forged = await c.post('/api/v1/payments/razorpay/verify', {
      orderNumber,
      razorpay_order_id: payment.razorpayOrderId,
      razorpay_payment_id: 'pay_fake',
      razorpay_signature: 'deadbeef',
    });
    expect(forged.status).toBe(400);
    expect(forged.body.error.code).toBe('SIGNATURE_INVALID');

    // Valid signature but Razorpay reports the payment as not captured
    const payId = gateway.simulatePayment(payment.razorpayOrderId, payment.amount, 'failed');
    const failed = await c.post('/api/v1/payments/razorpay/verify', {
      orderNumber,
      razorpay_order_id: payment.razorpayOrderId,
      razorpay_payment_id: payId,
      razorpay_signature: signCheckout(payment.razorpayOrderId, payId),
    });
    expect(failed.status).toBe(409);
    expect((await Order.findOne({ orderNumber }))!.payment.status).toBe('awaiting_payment');
  });

  it('rejects payments whose amount does not match the order', async () => {
    const { c, payment, orderNumber } = await placeOnlineOrder();
    const payId = gateway.simulatePayment(payment.razorpayOrderId, 100);
    const res = await c.post('/api/v1/payments/razorpay/verify', {
      orderNumber,
      razorpay_order_id: payment.razorpayOrderId,
      razorpay_payment_id: payId,
      razorpay_signature: signCheckout(payment.razorpayOrderId, payId),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('AMOUNT_MISMATCH');
    const order = await Order.findOne({ orderNumber }).lean();
    expect(order!.payment.status).toBe('awaiting_payment');
    expect(order!.attention?.reason).toMatch(/mismatch/i);
  });

  it('captures authorised payments when auto-capture is off', async () => {
    const { c, payment, orderNumber } = await placeOnlineOrder();
    const payId = gateway.simulatePayment(payment.razorpayOrderId, payment.amount, 'authorized');
    const res = await c.post('/api/v1/payments/razorpay/verify', {
      orderNumber,
      razorpay_order_id: payment.razorpayOrderId,
      razorpay_payment_id: payId,
      razorpay_signature: signCheckout(payment.razorpayOrderId, payId),
    });
    expect(res.status).toBe(200);
    expect(gateway.capturePayment).toHaveBeenCalledWith(payId, payment.amount, 'INR');
  });

  it('cancels the order and releases stock if the Razorpay order cannot be created', async () => {
    gateway.createOrder.mockRejectedValueOnce(new Error('Razorpay down'));
    const p = await createProduct({ stock: 3 });
    const c = await TestClient.create(app);
    const res = await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(p._id), quantity: 1 }], { paymentMethod: 'razorpay' }));
    expect(res.status).toBe(502);
    expect((await Product.findById(p._id))!.stock).toBe(3);
    expect((await Order.findOne().lean())!.status).toBe('cancelled');
  });
});

describe('webhooks', () => {
  it('rejects webhooks with an invalid signature', async () => {
    const c = await TestClient.create(app);
    const w = webhook('payment.captured', {});
    const res = await sendWebhook(c, { ...w, signature: 'bad' });
    expect(res.status).toBe(400);
    expect(await WebhookEvent.countDocuments()).toBe(0);
  });

  it('marks the order paid from a signed webhook and handles duplicate deliveries idempotently', async () => {
    const { c, payment, orderNumber, p } = await placeOnlineOrder(5);
    const payId = gateway.simulatePayment(payment.razorpayOrderId, payment.amount);
    const entity = { id: payId, order_id: payment.razorpayOrderId, amount: payment.amount, currency: 'INR', status: 'captured', method: 'upi' };
    const w = webhook('payment.captured', { payment: { entity } }, 'evt_dup_1');

    const first = await sendWebhook(c, w);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ duplicate: false, outcome: 'processed' });
    const again = await sendWebhook(c, w);
    expect(again.body.duplicate).toBe(true);

    // A different event for the same payment (e.g. order.paid) is also harmless.
    const other = await sendWebhook(c, webhook('order.paid', { payment: { entity } }, 'evt_other'));
    expect(other.status).toBe(200);

    const order = await Order.findOne({ orderNumber }).lean();
    expect(order!.status).toBe('payment_confirmed');
    expect(order!.timeline.filter((t) => t.status === 'payment_confirmed')).toHaveLength(1);
    // Stock was decremented exactly once (at order creation), never by webhooks.
    expect((await Product.findById(p._id))!.stock).toBe(4);
    expect(await InventoryAdjustment.countDocuments({ product: p._id, reason: 'order_reserved' })).toBe(1);
    expect((await Product.findById(p._id))!.soldCount).toBe(1);
  });

  it('handles the browser callback and webhook racing each other', async () => {
    const { c, payment, orderNumber } = await placeOnlineOrder();
    const payId = gateway.simulatePayment(payment.razorpayOrderId, payment.amount);
    const entity = { id: payId, order_id: payment.razorpayOrderId, amount: payment.amount, currency: 'INR', status: 'captured' };
    const [verify, hook] = await Promise.all([
      c.post('/api/v1/payments/razorpay/verify', {
        orderNumber,
        razorpay_order_id: payment.razorpayOrderId,
        razorpay_payment_id: payId,
        razorpay_signature: signCheckout(payment.razorpayOrderId, payId),
      }),
      sendWebhook(c, webhook('payment.captured', { payment: { entity } })),
    ]);
    expect(verify.status).toBe(200);
    expect(hook.status).toBe(200);
    const order = await Order.findOne({ orderNumber }).lean();
    expect(order!.timeline.filter((t) => t.status === 'payment_confirmed')).toHaveLength(1);
    expect(await PaymentTransaction.countDocuments({ providerPaymentId: payId, type: 'payment' })).toBe(1);
  });

  it('records failed payment attempts without cancelling the order', async () => {
    const { c, payment, orderNumber } = await placeOnlineOrder();
    const entity = { id: 'pay_failed1', order_id: payment.razorpayOrderId, amount: payment.amount, currency: 'INR', status: 'failed', error_description: 'Card declined' };
    const res = await sendWebhook(c, webhook('payment.failed', { payment: { entity } }));
    expect(res.status).toBe(200);
    expect((await Order.findOne({ orderNumber }))!.status).toBe('pending_payment');
    expect((await PaymentTransaction.findOne({ providerPaymentId: 'pay_failed1' }))!.status).toBe('failed');
  });

  it('flags a second, different payment for the same order', async () => {
    const { c, payment, orderNumber } = await placeOnlineOrder();
    const pay1 = gateway.simulatePayment(payment.razorpayOrderId, payment.amount);
    const pay2 = gateway.simulatePayment(payment.razorpayOrderId, payment.amount);
    for (const id of [pay1, pay2]) {
      const entity = { id, order_id: payment.razorpayOrderId, amount: payment.amount, currency: 'INR', status: 'captured' };
      await sendWebhook(c, webhook('payment.captured', { payment: { entity } }));
    }
    const order = await Order.findOne({ orderNumber }).lean();
    expect(order!.payment.razorpayPaymentId).toBe(pay1);
    expect(order!.attention?.reason).toMatch(/second payment/i);
  });
});

describe('payments after cancellation and external refunds', () => {
  it('does not reinstate an order the customer cancelled; flags it for refund instead', async () => {
    const { c, payment, orderNumber, p, res } = await placeOnlineOrder(5);
    const cancel = await c.post(`/api/v1/track/${orderNumber}/cancel`, { reason: 'Changed my mind', token: res.body.trackingToken });
    expect(cancel.status).toBe(200);
    expect((await Product.findById(p._id))!.stock).toBe(5);

    const payId = gateway.simulatePayment(payment.razorpayOrderId, payment.amount);
    const entity = { id: payId, order_id: payment.razorpayOrderId, amount: payment.amount, currency: 'INR', status: 'captured' };
    await sendWebhook(c, webhook('payment.captured', { payment: { entity } }));

    const order = await Order.findOne({ orderNumber }).lean();
    expect(order).toMatchObject({ status: 'cancelled', payment: { status: 'paid', amountPaid: payment.amount } });
    expect(order!.attention?.reason).toMatch(/already been cancelled/i);
    expect((await Product.findById(p._id))!.stock).toBe(5); // stock not re-reserved
  });

  it('records refunds issued directly in the Razorpay dashboard', async () => {
    const { c, payment, orderNumber } = await placeOnlineOrder(5);
    const payId = gateway.simulatePayment(payment.razorpayOrderId, payment.amount);
    const entity = { id: payId, order_id: payment.razorpayOrderId, amount: payment.amount, currency: 'INR', status: 'captured' };
    await sendWebhook(c, webhook('payment.captured', { payment: { entity } }));

    const refund = { id: 'rfnd_dashboard1', payment_id: payId, amount: 10000, status: 'processed' };
    const w = webhook('refund.processed', { refund: { entity: refund } }, 'evt_ext_refund');
    expect((await sendWebhook(c, w)).status).toBe(200);
    expect((await sendWebhook(c, w)).body.duplicate).toBe(true);

    const order = await Order.findOne({ orderNumber }).lean();
    expect(order!.payment).toMatchObject({ status: 'partially_refunded', amountRefunded: 10000, refundReserved: 0 });
    expect(order!.attention?.reason).toMatch(/directly in Razorpay/);
    expect(await PaymentTransaction.countDocuments({ providerRefundId: 'rfnd_dashboard1', status: 'processed' })).toBe(1);
  });
});

describe('reservation expiry', () => {
  it('releases stock once when payment never arrives', async () => {
    const { orderNumber, p } = await placeOnlineOrder(5);
    expect((await Product.findById(p._id))!.stock).toBe(4);
    await Order.updateOne({ orderNumber }, { reservationExpiresAt: new Date(Date.now() - 1000) });

    expect(await expireStaleOrders()).toBe(1);
    expect(await expireStaleOrders()).toBe(0); // second run is a no-op
    const order = await Order.findOne({ orderNumber }).lean();
    expect(order).toMatchObject({ status: 'cancelled', inventoryState: 'released', payment: { status: 'failed' } });
    expect((await Product.findById(p._id))!.stock).toBe(5);
    expect(await InventoryAdjustment.countDocuments({ product: p._id, reason: 'order_released' })).toBe(1);
  });

  it('confirms instead of expiring when Razorpay shows a captured payment (missed webhook)', async () => {
    const { orderNumber, payment, p } = await placeOnlineOrder(5);
    gateway.simulatePayment(payment.razorpayOrderId, payment.amount);
    await Order.updateOne({ orderNumber }, { reservationExpiresAt: new Date(Date.now() - 1000) });
    expect(await expireStaleOrders()).toBe(0);
    expect((await Order.findOne({ orderNumber }))!.status).toBe('payment_confirmed');
    expect((await Product.findById(p._id))!.stock).toBe(4);
  });

  it('keeps the reservation when Razorpay cannot be reached', async () => {
    const { orderNumber } = await placeOnlineOrder(5);
    gateway.fetchOrderPayments.mockRejectedValueOnce(new Error('timeout'));
    await Order.updateOne({ orderNumber }, { reservationExpiresAt: new Date(Date.now() - 1000) });
    expect(await expireStaleOrders()).toBe(0);
    expect((await Order.findOne({ orderNumber }))!.status).toBe('pending_payment');
  });

  it('reinstates a late payment when stock is still available, else flags a refund', async () => {
    const first = await placeOnlineOrder(1);
    await Order.updateOne({ orderNumber: first.orderNumber }, { reservationExpiresAt: new Date(Date.now() - 1000) });
    await expireStaleOrders();
    expect((await Product.findById(first.p._id))!.stock).toBe(1);

    const payId = gateway.simulatePayment(first.payment.razorpayOrderId, first.payment.amount);
    const entity = { id: payId, order_id: first.payment.razorpayOrderId, amount: first.payment.amount, currency: 'INR', status: 'captured' };
    await sendWebhook(first.c, webhook('payment.captured', { payment: { entity } }));
    const reinstated = await Order.findOne({ orderNumber: first.orderNumber }).lean();
    expect(reinstated).toMatchObject({ status: 'payment_confirmed', inventoryState: 'committed' });
    expect((await Product.findById(first.p._id))!.stock).toBe(0);

    // Second product: expire, sell out, then the late payment arrives.
    const second = await placeOnlineOrder(1);
    await Order.updateOne({ orderNumber: second.orderNumber }, { reservationExpiresAt: new Date(Date.now() - 1000) });
    await expireStaleOrders();
    await Product.updateOne({ _id: second.p._id }, { stock: 0 });
    const pay2 = gateway.simulatePayment(second.payment.razorpayOrderId, second.payment.amount);
    const entity2 = { id: pay2, order_id: second.payment.razorpayOrderId, amount: second.payment.amount, currency: 'INR', status: 'captured' };
    await sendWebhook(second.c, webhook('payment.captured', { payment: { entity: entity2 } }));
    const flagged = await Order.findOne({ orderNumber: second.orderNumber }).lean();
    expect(flagged).toMatchObject({ status: 'cancelled', payment: { status: 'paid' } });
    expect(flagged!.attention?.reason).toMatch(/refund required/i);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { setTransactionSupportForTests } from '../src/lib/transaction.js';
import { InventoryAdjustment } from '../src/models/InventoryAdjustment.js';
import { Order } from '../src/models/Order.js';
import { Product } from '../src/models/Product.js';
import { reserveStock } from '../src/services/inventory.service.js';
import { TestClient, checkoutBody, connectTestDb, createProduct, disconnectTestDb, loginAs, resetDb } from './helpers.js';

const app = createApp();

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(resetDb);

describe('stock validation', () => {
  it('reports stock problems in the cart quote', async () => {
    const p = await createProduct({ stock: 2 });
    const out = await createProduct({ stock: 0 });
    const c = await TestClient.create(app);
    const q = await c.post('/api/v1/cart/quote', {
      items: [
        { productId: String(p._id), quantity: 3 },
        { productId: String(out._id), quantity: 1 },
      ],
    });
    expect(q.body.lines[0]).toMatchObject({ issue: 'insufficient_stock', available: 2, maxQuantity: 2 });
    expect(q.body.lines[1].issue).toBe('out_of_stock');
    expect(q.body.hasIssues).toBe(true);
    expect(q.body.subtotal).toBe(0);
  });

  it('prevents ordering more than available and leaves stock untouched', async () => {
    const p = await createProduct({ stock: 2 });
    const c = await TestClient.create(app);
    const res = await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(p._id), quantity: 3 }]));
    expect(res.status).toBe(409);
    expect((await Product.findById(p._id))!.stock).toBe(2);
    expect(await Order.countDocuments()).toBe(0);
  });

  it('requires a variant for products that have variants and tracks variant stock', async () => {
    const p = await createProduct({ variants: [{ sku: 'CH-G', label: 'Gold', stock: 2 }, { sku: 'CH-S', label: 'Silver', stock: 1 }] });
    const c = await TestClient.create(app);
    const missing = await c.post('/api/v1/cart/quote', { items: [{ productId: String(p._id), quantity: 1 }] });
    expect(missing.body.lines[0].issue).toBe('variant_required');

    const silver = p.variants[1]._id;
    const ok = await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(p._id), variantId: String(silver), quantity: 1 }]));
    expect(ok.status).toBe(201);
    const after = await Product.findById(p._id).lean();
    expect(after!.variants.find((v) => v._id.equals(silver))!.stock).toBe(0);
    expect(after!.stock).toBe(2);

    const again = await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(p._id), variantId: String(silver), quantity: 1 }]));
    expect(again.status).toBe(409);
  });
});

describe('concurrent purchases', () => {
  async function race(stock: number, buyers: number) {
    const p = await createProduct({ stock });
    const clients = await Promise.all(Array.from({ length: buyers }, () => TestClient.create(app)));
    const results = await Promise.all(
      clients.map((c) => c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(p._id), quantity: 1 }]))),
    );
    return { p, results };
  }

  it('never oversells under concurrent checkouts (with transactions)', async () => {
    const { p, results } = await race(5, 12);
    const ok = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 409);
    expect(ok).toHaveLength(5);
    expect(rejected).toHaveLength(7);
    const after = await Product.findById(p._id).lean();
    expect(after!.stock).toBe(0);
    expect(await Order.countDocuments()).toBe(5);
    const deltas = await InventoryAdjustment.find({ product: p._id, reason: 'order_reserved' }).lean();
    expect(deltas.reduce((s, a) => s + a.delta, 0)).toBe(-5);
  });

  it('never oversells using the non-transactional fallback either', async () => {
    setTransactionSupportForTests(false);
    const { p, results } = await race(3, 10);
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    const after = await Product.findById(p._id).lean();
    expect(after!.stock).toBe(0);
    expect(await Order.countDocuments()).toBe(3);
  });

  it('rolls back every line when one line of a multi-item order is short (fallback mode)', async () => {
    setTransactionSupportForTests(false);
    const a = await createProduct({ stock: 5 });
    const b = await createProduct({ stock: 0 });
    // The cart quote would reject b up front, so call the reservation step directly
    // to simulate b selling out between the quote and the reservation.
    const lines = [
      { productId: a._id, quantity: 2, sku: a.sku },
      { productId: b._id, quantity: 1, sku: b.sku },
    ];
    await expect(reserveStock(lines, { session: null, actor: { type: 'system' } })).rejects.toMatchObject({ code: 'OUT_OF_STOCK' });
    expect((await Product.findById(a._id))!.stock).toBe(5);
    expect((await Product.findById(b._id))!.stock).toBe(0);
  });
});

describe('manual stock adjustments', () => {
  it('records adjustments with reasons and blocks negative stock', async () => {
    const { client } = await loginAs('staff', app);
    const p = await createProduct({ stock: 4 });
    const add = await client.post(`/api/v1/admin/inventory/${p._id}/adjust`, { quantity: 6, reason: 'restock', note: 'New shipment' });
    expect(add.status).toBe(200);
    expect(add.body.stock).toBe(10);

    const set = await client.post(`/api/v1/admin/inventory/${p._id}/adjust`, { mode: 'set', quantity: 7, reason: 'correction' });
    expect(set.body).toMatchObject({ stock: 7, delta: -3 });

    const tooMuch = await client.post(`/api/v1/admin/inventory/${p._id}/adjust`, { quantity: -8, reason: 'damaged' });
    expect(tooMuch.status).toBe(409);
    expect((await Product.findById(p._id))!.stock).toBe(7);

    const badReason = await client.post(`/api/v1/admin/inventory/${p._id}/adjust`, { quantity: 1, reason: 'order_reserved' });
    expect(badReason.status).toBe(400);

    const history = await client.get(`/api/v1/admin/inventory/adjustments?product=${p._id}`);
    expect(history.body.items.map((a: { reason: string }) => a.reason)).toEqual(['correction', 'restock']);
    expect(history.body.items[1]).toMatchObject({ delta: 6, stockAfter: 10, note: 'New shipment' });
  });

  it('lists low-stock and out-of-stock products', async () => {
    const { client } = await loginAs('admin', app);
    await createProduct({ name: 'Plenty', stock: 50 });
    await createProduct({ name: 'Low', stock: 2 });
    await createProduct({ name: 'None', stock: 0 });
    const low = await client.get('/api/v1/admin/inventory?stock=low');
    expect(low.body.items.map((i: { name: string }) => i.name)).toEqual(['Low']);
    const out = await client.get('/api/v1/admin/inventory?stock=out');
    expect(out.body.items.map((i: { name: string }) => i.name)).toEqual(['None']);
    const dash = await client.get('/api/v1/admin/dashboard');
    expect(dash.body.inventory).toMatchObject({ lowStock: 1, outOfStock: 1 });
  });
});

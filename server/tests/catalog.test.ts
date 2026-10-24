import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { InventoryAdjustment } from '../src/models/InventoryAdjustment.js';
import { Product } from '../src/models/Product.js';
import { MediaAsset } from '../src/models/misc.js';
import { TestClient, checkoutBody, connectTestDb, createCategory, createProduct, disconnectTestDb, loginAs, resetDb } from './helpers.js';

const app = createApp();

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(resetDb);

const productBody = (category: string, overrides: Record<string, unknown> = {}) => ({
  name: 'Pearl Drop Earrings',
  sku: 'EAR-PEARL-01',
  description: 'Lightweight pearl drops.',
  category,
  price: 29900,
  salePrice: 24900,
  stock: 12,
  lowStockThreshold: 3,
  attributes: [{ name: 'Material', value: 'Alloy' }],
  status: 'active',
  ...overrides,
});

describe('category management', () => {
  it('creates, updates and lists categories with product counts', async () => {
    const { client } = await loginAs('admin', app);
    const created = await client.post('/api/v1/admin/categories', { name: 'Earrings & Studs', description: 'Pretty things' });
    expect(created.status).toBe(201);
    expect(created.body.slug).toBe('earrings-and-studs');

    const child = await client.post('/api/v1/admin/categories', { name: 'Jhumkas', parent: created.body.id, displayOrder: 2 });
    expect(child.status).toBe(201);
    await createProduct({ category: child.body.id });

    const list = await client.get('/api/v1/admin/categories');
    expect(list.body.items.find((c: { id: string }) => c.id === child.body.id).productCount).toBe(1);

    const updated = await client.put(`/api/v1/admin/categories/${created.body.id}`, { name: 'Earrings', isActive: true, displayOrder: 1 });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Earrings');

    // Storefront tree rolls child counts up into the parent.
    const pub = await client.get('/api/v1/categories');
    expect(pub.body.items[0].productCount).toBe(1);
    expect(pub.body.items[0].children[0].slug).toBe(child.body.slug);
  });

  it('rejects duplicate slugs and deep nesting', async () => {
    const { client } = await loginAs('admin', app);
    const a = await client.post('/api/v1/admin/categories', { name: 'Chains', slug: 'chains' });
    const dup = await client.post('/api/v1/admin/categories', { name: 'Other', slug: 'chains' });
    expect(dup.status).toBe(409);
    const child = await client.post('/api/v1/admin/categories', { name: 'Thin', parent: a.body.id });
    const grandchild = await client.post('/api/v1/admin/categories', { name: 'Thinner', parent: child.body.id });
    expect(grandchild.status).toBe(400);
  });

  it('blocks deleting a category that has products unless they are reassigned', async () => {
    const { client } = await loginAs('admin', app);
    const from = await createCategory();
    const to = await createCategory();
    await createProduct({ category: from._id });

    const blocked = await client.delete(`/api/v1/admin/categories/${from._id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('CATEGORY_HAS_PRODUCTS');

    const moved = await client.delete(`/api/v1/admin/categories/${from._id}?reassignTo=${to._id}`);
    expect(moved.status).toBe(200);
    expect(moved.body.movedProducts).toBe(1);
    expect(await Product.countDocuments({ category: to._id })).toBe(1);
  });

  it('hides inactive categories and their products from the storefront', async () => {
    const cat = await createCategory({ isActive: false });
    const p = await createProduct({ category: cat._id });
    const c = await TestClient.create(app);
    expect((await c.get(`/api/v1/categories/${cat.slug}`)).status).toBe(404);
    expect((await c.get(`/api/v1/products/${p.slug}`)).status).toBe(404);
    const quote = await c.post('/api/v1/cart/quote', { items: [{ productId: String(p._id), quantity: 1 }] });
    expect(quote.body.lines[0].issue).toBe('unavailable');
  });

  it('only staff with permission can delete categories', async () => {
    const { client } = await loginAs('staff', app);
    const cat = await createCategory();
    expect((await client.delete(`/api/v1/admin/categories/${cat._id}`)).status).toBe(403);
  });
});

describe('product management', () => {
  it('creates a product with server-computed pricing and an initial stock record', async () => {
    const { client } = await loginAs('admin', app);
    const cat = await createCategory();
    const res = await client.post('/api/v1/admin/products', productBody(String(cat._id)));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ slug: 'pearl-drop-earrings', sku: 'EAR-PEARL-01', sellingPrice: 24900, stock: 12 });
    const adj = await InventoryAdjustment.findOne({ product: res.body.id }).lean();
    expect(adj).toMatchObject({ delta: 12, stockAfter: 12, reason: 'initial_stock' });
  });

  it('rejects invalid prices and duplicate SKUs (including variant SKUs)', async () => {
    const { client } = await loginAs('admin', app);
    const cat = String((await createCategory())._id);
    const badSale = await client.post('/api/v1/admin/products', productBody(cat, { salePrice: 39900 }));
    expect(badSale.status).toBe(400);
    expect(badSale.body.error.details.salePrice).toBeDefined();

    const negative = await client.post('/api/v1/admin/products', productBody(cat, { price: -100 }));
    expect(negative.status).toBe(400);
    const fractional = await client.post('/api/v1/admin/products', productBody(cat, { price: 199.5 }));
    expect(fractional.status).toBe(400);

    expect((await client.post('/api/v1/admin/products', productBody(cat))).status).toBe(201);
    const dup = await client.post('/api/v1/admin/products', productBody(cat, { name: 'Another', sku: 'ear-pearl-01' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('SKU_TAKEN');

    const variantClash = await client.post(
      '/api/v1/admin/products',
      productBody(cat, { name: 'Chain', sku: 'CHAIN-01', variants: [{ sku: 'EAR-PEARL-01', label: 'Gold', stock: 1 }] }),
    );
    expect(variantClash.status).toBe(409);

    const selfClash = await client.post(
      '/api/v1/admin/products',
      productBody(cat, { name: 'Chain', sku: 'CHAIN-02', variants: [{ sku: 'V-1', label: 'Gold', stock: 1 }, { sku: 'V-1', label: 'Silver', stock: 1 }] }),
    );
    expect(selfClash.status).toBe(400);
  });

  it('never overwrites live stock when editing a product', async () => {
    const { client } = await loginAs('admin', app);
    const cat = String((await createCategory())._id);
    const created = (await client.post('/api/v1/admin/products', productBody(cat, { stock: 10 }))).body;
    // Simulate a sale happening between loading the edit form and saving it.
    await Product.updateOne({ _id: created.id }, { $inc: { stock: -3, inventoryVersion: 1 } });
    const res = await client.put(`/api/v1/admin/products/${created.id}`, productBody(cat, { name: 'Renamed', stock: 999 }));
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed');
    expect(res.body.stock).toBe(7);
    expect(res.body.slug).toBe(created.slug); // slug stays stable
  });

  it('archived and draft products cannot be viewed or purchased', async () => {
    const archived = await createProduct({ status: 'archived' });
    const draft = await createProduct({ status: 'draft' });
    const c = await TestClient.create(app);
    expect((await c.get(`/api/v1/products/${archived.slug}`)).status).toBe(404);
    const order = await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(archived._id), quantity: 1 }]));
    expect(order.status).toBe(409);
    expect(order.body.error.code).toBe('CART_CHANGED');
    const order2 = await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(draft._id), quantity: 1 }]));
    expect(order2.status).toBe(409);
  });

  it('deletes unused products but requires archiving once a product has orders', async () => {
    const { client } = await loginAs('admin', app);
    const unused = await createProduct();
    expect((await client.delete(`/api/v1/admin/products/${unused._id}`)).status).toBe(200);
    expect(await Product.exists({ _id: unused._id })).toBeNull();

    const sold = await createProduct({ stock: 5 });
    const c = await TestClient.create(app);
    expect((await c.post('/api/v1/checkout/orders', checkoutBody([{ productId: String(sold._id), quantity: 1 }]))).status).toBe(201);
    const blocked = await client.delete(`/api/v1/admin/products/${sold._id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PRODUCT_HAS_ORDERS');
    const archived = await client.patch(`/api/v1/admin/products/${sold._id}/status`, { status: 'archived' });
    expect(archived.body.status).toBe('archived');
  });

  it('only accepts images uploaded through the admin (or bundled samples)', async () => {
    const { client } = await loginAs('admin', app);
    const cat = String((await createCategory())._id);
    const external = await client.post('/api/v1/admin/products', productBody(cat, { images: [{ url: 'https://evil.example.com/x.jpg' }] }));
    expect(external.status).toBe(400);
    const unknown = await client.post(
      '/api/v1/admin/products',
      productBody(cat, { images: [{ url: 'https://res.cloudinary.com/mock-cloud/image/upload/x.jpg', publicId: 'ap/x' }] }),
    );
    expect(unknown.status).toBe(400);
    await MediaAsset.create({ publicId: 'ap/ok', url: 'https://res.cloudinary.com/mock-cloud/image/upload/ok.jpg', status: 'temp' });
    const ok = await client.post(
      '/api/v1/admin/products',
      productBody(cat, { images: [{ url: 'https://res.cloudinary.com/mock-cloud/image/upload/ok.jpg', publicId: 'ap/ok' }] }),
    );
    expect(ok.status).toBe(201);
    expect((await MediaAsset.findOne({ publicId: 'ap/ok' }))!.status).toBe('attached');
  });

  it('looks up sellable products by id for guest wishlists', async () => {
    const active = await createProduct();
    const draft = await createProduct({ status: 'draft' });
    const c = await TestClient.create(app);
    const res = await c.get(`/api/v1/products/lookup?ids=${active._id},${draft._id},not-an-id`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((p: { id: string }) => p.id)).toEqual([String(active._id)]);
  });

  it('searches, filters, sorts and paginates the storefront catalogue', async () => {
    const cat = await createCategory({ slug: 'earrings' });
    await createProduct({ name: 'Gold Hoop Earrings', price: 30000, category: cat._id });
    await createProduct({ name: 'Silver Stud Earrings', price: 15000, salePrice: 12000, category: cat._id });
    await createProduct({ name: 'Rose Hoop Earrings', price: 45000, stock: 0, category: cat._id });
    await createProduct({ name: 'Bracelet', price: 20000 });
    const c = await TestClient.create(app);

    const search = await c.get('/api/v1/products?q=hoop');
    expect(search.body.items.map((p: { name: string }) => p.name).sort()).toEqual(['Gold Hoop Earrings', 'Rose Hoop Earrings']);

    const filtered = await c.get('/api/v1/products?category=earrings&inStock=true&sort=price_asc');
    expect(filtered.body.items.map((p: { price: number }) => p.price)).toEqual([12000, 30000]);

    const range = await c.get('/api/v1/products?minPrice=13000&maxPrice=35000');
    expect(range.body.items.map((p: { name: string }) => p.name).sort()).toEqual(['Bracelet', 'Gold Hoop Earrings']);

    const onSale = await c.get('/api/v1/products?onSale=true');
    expect(onSale.body.items).toHaveLength(1);
    expect(onSale.body.items[0].compareAtPrice).toBe(15000);

    const page = await c.get('/api/v1/products?limit=2&page=2&sort=price_desc');
    expect(page.body.meta).toMatchObject({ total: 4, page: 2, pages: 2 });
    expect(page.body.items).toHaveLength(2);

    const injection = await c.get('/api/v1/products?q=(.*)');
    expect(injection.status).toBe(200);
    expect(injection.body.items).toHaveLength(0);
  });
});

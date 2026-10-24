import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { User } from '../src/models/User.js';
import { PASSWORD, TestClient, connectTestDb, createUser, disconnectTestDb, loginAs, resetDb } from './helpers.js';

const app = createApp();

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(resetDb);

describe('admin authentication and authorization', () => {
  it('has no public admin registration endpoint', async () => {
    const c = await TestClient.create(app);
    const res = await c.post('/api/v1/auth/admin/register', { name: 'x', email: 'x@example.com', password: PASSWORD });
    expect(res.status).toBe(404);
  });

  it('rejects unauthenticated access to every admin area', async () => {
    const c = await TestClient.create(app);
    for (const path of ['/api/v1/admin/dashboard', '/api/v1/admin/products', '/api/v1/admin/orders', '/api/v1/admin/customers', '/api/v1/admin/settings']) {
      const res = await c.get(path);
      expect(res.status, path).toBe(401);
    }
  });

  it('rejects customers from admin APIs even with a valid customer session', async () => {
    const { client } = await loginAs('customer', app);
    expect((await client.get('/api/v1/admin/dashboard')).status).toBe(401);
    expect((await client.post('/api/v1/admin/products', {})).status).toBe(401);
  });

  it('does not let customers sign in through the admin login', async () => {
    const customer = await createUser('customer');
    const c = await TestClient.create(app);
    const res = await c.post('/api/v1/auth/admin/login', { email: customer.email, password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('allows admins and returns their permissions', async () => {
    const { client } = await loginAs('admin', app);
    const me = await client.get('/api/v1/auth/admin/me');
    expect(me.status).toBe(200);
    expect(me.body.permissions).toContain('orders:refund');
    expect((await client.get('/api/v1/admin/dashboard')).status).toBe(200);
  });

  it('limits staff to their permissions', async () => {
    const { client } = await loginAs('staff', app);
    expect((await client.get('/api/v1/admin/orders')).status).toBe(200);
    expect((await client.get('/api/v1/admin/products')).status).toBe(200);
    // Admin-only actions
    expect((await client.get('/api/v1/admin/orders/export')).status).toBe(403);
    expect((await client.post('/api/v1/admin/coupons', { code: 'X' })).status).toBe(403);
    expect((await client.put('/api/v1/admin/settings', {})).status).toBe(403);
    const me = await client.get('/api/v1/auth/admin/me');
    expect(me.body.permissions).not.toContain('orders:refund');
  });

  it('revokes access immediately when an admin is demoted', async () => {
    const { client, user } = await loginAs('admin', app);
    expect((await client.get('/api/v1/admin/dashboard')).status).toBe(200);
    await User.updateOne({ _id: user._id }, { role: 'customer' });
    expect((await client.get('/api/v1/admin/dashboard')).status).toBe(401);
  });

  it('sets security headers', async () => {
    const c = await TestClient.create(app);
    const res = await c.get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('rejects NoSQL operator injection in request bodies', async () => {
    const c = await TestClient.create(app);
    const res = await c.post('/api/v1/auth/login', { email: { $gt: '' }, password: { $ne: null } });
    expect(res.status).toBe(400);
  });
});

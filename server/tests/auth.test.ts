import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { setEmailTransportForTests } from '../src/integrations/email.js';
import { Notification } from '../src/models/misc.js';
import { Session } from '../src/models/Session.js';
import { User } from '../src/models/User.js';
import { requestPasswordReset } from '../src/services/auth.service.js';
import { notifications } from '../src/services/notification.service.js';
import { PASSWORD, TestClient, connectTestDb, createUser, disconnectTestDb, resetDb } from './helpers.js';

const app = createApp();

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(resetDb);

describe('customer registration', () => {
  it('registers a customer, hashes the password and starts a session', async () => {
    const c = await TestClient.create(app);
    const res = await c.post('/api/v1/auth/register', { name: 'Asha Rao', email: 'Asha@Example.com', password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'asha@example.com', role: 'customer' });
    expect(res.body.user.passwordHash).toBeUndefined();

    const stored = await User.findOne({ email: 'asha@example.com' }).select('+passwordHash').lean();
    expect(stored!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored!.passwordHash).not.toContain(PASSWORD);

    const me = await c.get('/api/v1/auth/me');
    expect(me.body.user.email).toBe('asha@example.com');
  });

  it('ignores any attempt to self-assign a privileged role', async () => {
    const c = await TestClient.create(app);
    const res = await c.post('/api/v1/auth/register', { name: 'Mallory', email: 'm@example.com', password: PASSWORD, role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('customer');
    expect((await User.findOne({ email: 'm@example.com' }))!.role).toBe('customer');
  });

  it('rejects weak passwords and duplicate emails', async () => {
    const c = await TestClient.create(app);
    const weak = await c.post('/api/v1/auth/register', { name: 'Weak', email: 'w@example.com', password: 'password' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.details.password).toBeDefined();

    await createUser('customer', { email: 'dup@example.com' });
    const dup = await c.post('/api/v1/auth/register', { name: 'Dup', email: 'dup@example.com', password: PASSWORD });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('EMAIL_TAKEN');
  });
});

describe('login', () => {
  it('logs in with valid credentials and out again', async () => {
    const user = await createUser('customer');
    const c = await TestClient.create(app);
    const res = await c.post('/api/v1/auth/login', { email: user.email, password: PASSWORD });
    expect(res.status).toBe(200);
    const cookie = ([] as string[]).concat(res.headers['set-cookie']).find((x) => x.startsWith('aph_sid='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    expect(await Session.countDocuments({ user: user._id })).toBe(1);
    const out = await c.post('/api/v1/auth/logout');
    expect(out.status).toBe(200);
    expect(await Session.countDocuments({ user: user._id })).toBe(0);
    expect((await c.get('/api/v1/auth/me')).body.user).toBeNull();
  });

  it('uses a generic error for unknown emails and wrong passwords', async () => {
    const user = await createUser('customer');
    const c = await TestClient.create(app);
    const wrong = await c.post('/api/v1/auth/login', { email: user.email, password: 'Wrong12345' });
    const unknown = await c.post('/api/v1/auth/login', { email: 'nobody@example.com', password: 'Wrong12345' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('locks the account after repeated failures', async () => {
    const user = await createUser('customer');
    const c = await TestClient.create(app);
    for (let i = 0; i < 5; i++) await c.post('/api/v1/auth/login', { email: user.email, password: 'Wrong12345' });
    const locked = await c.post('/api/v1/auth/login', { email: user.email, password: PASSWORD });
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('refuses disabled accounts', async () => {
    const user = await createUser('customer');
    await User.updateOne({ _id: user._id }, { isActive: false });
    const c = await TestClient.create(app);
    const res = await c.post('/api/v1/auth/login', { email: user.email, password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('keeps staff out of the customer login', async () => {
    const admin = await createUser('admin');
    const c = await TestClient.create(app);
    const res = await c.post('/api/v1/auth/login', { email: admin.email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('USE_ADMIN_LOGIN');
  });
});

describe('CSRF protection', () => {
  it('rejects state-changing requests without a valid token', async () => {
    const noToken = await request(app).post('/api/v1/auth/login').send({ email: 'a@example.com', password: 'x' });
    expect(noToken.status).toBe(403);
    expect(noToken.body.error.code).toBe('CSRF_INVALID');

    const forged = await request(app)
      .post('/api/v1/auth/login')
      .set('Cookie', 'aph_csrf=abc.def')
      .set('X-CSRF-Token', 'abc.def')
      .send({ email: 'a@example.com', password: 'x' });
    expect(forged.status).toBe(403);
  });
});

describe('password reset', () => {
  it('resets the password with a valid token and revokes sessions', async () => {
    const sent: { to: string; text: string }[] = [];
    setEmailTransportForTests({ send: async (m) => (sent.push(m), { messageId: 'mock-1' }) });
    const user = await createUser('customer');
    const c = await TestClient.create(app);
    await c.post('/api/v1/auth/login', { email: user.email, password: PASSWORD });

    const res = await c.post('/api/v1/auth/forgot-password', { email: user.email });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    const token = new URL(sent[0].text.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;

    const reset = await c.post('/api/v1/auth/reset-password', { token, password: 'NewSparkle2025' });
    expect(reset.status).toBe(200);
    expect(await Session.countDocuments({ user: user._id })).toBe(0);

    const reuse = await c.post('/api/v1/auth/reset-password', { token, password: 'Another2025x' });
    expect(reuse.status).toBe(400);
    const login = await c.post('/api/v1/auth/login', { email: user.email, password: 'NewSparkle2025' });
    expect(login.status).toBe(200);
    setEmailTransportForTests(undefined);
  });

  it('responds identically for unknown emails and records "skipped" when email is not configured', async () => {
    setEmailTransportForTests(null);
    const c = await TestClient.create(app);
    const unknown = await c.post('/api/v1/auth/forgot-password', { email: 'ghost@example.com' });
    expect(unknown.status).toBe(200);

    const user = await createUser('customer');
    await requestPasswordReset(user.email);
    await notifications.flush();
    const log = await Notification.findOne({ event: 'password_reset' }).lean();
    expect(log!.status).toBe('skipped');
    expect(log!.reason).toBe('email_provider_not_configured');
    setEmailTransportForTests(undefined);
  });

  it('rejects expired tokens', async () => {
    const user = await createUser('customer');
    const { token } = (await requestPasswordReset(user.email))!;
    await User.updateOne({ _id: user._id }, { 'passwordReset.expiresAt': new Date(Date.now() - 1000) });
    const c = await TestClient.create(app);
    const res = await c.post('/api/v1/auth/reset-password', { token, password: 'NewSparkle2025' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_RESET_TOKEN');
  });
});

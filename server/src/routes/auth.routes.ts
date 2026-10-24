import { Router } from 'express';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, clearSessionCookie, issueCsrfToken, setSessionCookie } from '../lib/cookies.js';
import { permissionsFor } from '../lib/permissions.js';
import { parseBody } from '../lib/validate.js';
import { loadCustomer, requireAdmin, requireCustomer } from '../middleware/auth.js';
import { rateLimits } from '../middleware/security.js';
import { toPublicUser } from '../models/User.js';
import { ChangePasswordSchema, ForgotPasswordSchema, LoginSchema, RegisterSchema, ResetPasswordSchema } from '../schemas/index.js';
import * as auth from '../services/auth.service.js';

export function authRoutes() {
  const r = Router();
  const loginLimit = rateLimits.login();
  const adminLoginLimit = rateLimits.adminLogin();
  const registerLimit = rateLimits.register();
  const resetLimit = rateLimits.passwordReset();

  /** Issues the CSRF cookie + token. Clients call this once on load. */
  r.get('/csrf', (_req, res) => {
    res.json({ csrfToken: issueCsrfToken(res) });
  });

  r.post('/register', registerLimit, async (req, res) => {
    const input = parseBody(RegisterSchema, req);
    const user = await auth.registerCustomer(input);
    const { token, expiresAt } = await auth.createSession(user, 'customer', req);
    setSessionCookie(res, CUSTOMER_COOKIE, token, expiresAt);
    issueCsrfToken(res); // rotate on privilege change
    res.status(201).json({ user: toPublicUser(user) });
  });

  r.post('/login', loginLimit, async (req, res) => {
    const { email, password } = parseBody(LoginSchema, req);
    const user = await auth.authenticate(email, password, 'customer');
    await auth.destroySession(req.cookies?.[CUSTOMER_COOKIE]); // prevent session fixation
    const { token, expiresAt } = await auth.createSession(user, 'customer', req);
    setSessionCookie(res, CUSTOMER_COOKIE, token, expiresAt);
    issueCsrfToken(res);
    res.json({ user: toPublicUser(user) });
  });

  r.post('/logout', async (req, res) => {
    await auth.destroySession(req.cookies?.[CUSTOMER_COOKIE]);
    clearSessionCookie(res, CUSTOMER_COOKIE);
    res.json({ ok: true });
  });

  r.get('/me', loadCustomer, (req, res) => {
    res.json({ user: req.customer ? toPublicUser(req.customer) : null });
  });

  r.post('/forgot-password', resetLimit, async (req, res) => {
    const { email } = parseBody(ForgotPasswordSchema, req);
    await auth.requestPasswordReset(email);
    // Same response whether or not the account exists.
    res.json({ ok: true, message: 'If an account exists for that email, a reset link has been sent.' });
  });

  r.post('/reset-password', resetLimit, async (req, res) => {
    const { token, password } = parseBody(ResetPasswordSchema, req);
    await auth.resetPassword(token, password);
    clearSessionCookie(res, CUSTOMER_COOKIE);
    res.json({ ok: true });
  });

  r.post('/change-password', requireCustomer, async (req, res) => {
    const { currentPassword, newPassword } = parseBody(ChangePasswordSchema, req);
    await auth.changePassword(req.customer!._id, currentPassword, newPassword);
    // All sessions were revoked; sign this browser back in with a fresh session.
    const { token, expiresAt } = await auth.createSession(req.customer!, 'customer', req);
    setSessionCookie(res, CUSTOMER_COOKIE, token, expiresAt);
    res.json({ ok: true });
  });

  /* ------------------------- Admin authentication ------------------------ */
  // There is intentionally no admin registration endpoint. See docs/SETUP.md (First admin).

  r.post('/admin/login', adminLoginLimit, async (req, res) => {
    const { email, password } = parseBody(LoginSchema, req);
    const user = await auth.authenticate(email, password, 'admin');
    await auth.destroySession(req.cookies?.[ADMIN_COOKIE]);
    const { token, expiresAt } = await auth.createSession(user, 'admin', req);
    setSessionCookie(res, ADMIN_COOKIE, token, expiresAt);
    issueCsrfToken(res);
    res.json({ user: toPublicUser(user), permissions: permissionsFor(user.role) });
  });

  r.post('/admin/logout', async (req, res) => {
    await auth.destroySession(req.cookies?.[ADMIN_COOKIE]);
    clearSessionCookie(res, ADMIN_COOKIE);
    res.json({ ok: true });
  });

  r.get('/admin/me', requireAdmin(), (req, res) => {
    res.json({ user: toPublicUser(req.admin!), permissions: permissionsFor(req.admin!.role) });
  });

  return r;
}

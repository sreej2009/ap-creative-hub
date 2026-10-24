import type { CookieOptions, Request, Response } from 'express';
import { env } from '../config/env.js';
import { hmac, randomToken, safeEqual } from './util.js';

export const CUSTOMER_COOKIE = 'aph_sid';
export const ADMIN_COOKIE = 'aph_admin_sid';
export const CSRF_COOKIE = 'aph_csrf';

export function baseCookieOptions(): CookieOptions {
  return {
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    path: '/',
  };
}

export function setSessionCookie(res: Response, name: string, token: string, expires: Date) {
  res.cookie(name, token, { ...baseCookieOptions(), httpOnly: true, expires });
}

export function clearSessionCookie(res: Response, name: string) {
  res.clearCookie(name, { ...baseCookieOptions(), httpOnly: true });
}

/**
 * Signed double-submit CSRF token. The cookie is readable by our own JS,
 * which echoes it in the X-CSRF-Token header. Other origins can neither
 * read the cookie nor add the header without passing CORS, and the HMAC
 * prevents an attacker from planting a token of their own choosing.
 */
export function issueCsrfToken(res: Response): string {
  const raw = randomToken(18);
  const token = `${raw}.${hmac(env.APP_SECRET, `csrf:${raw}`, 'base64url')}`;
  res.cookie(CSRF_COOKIE, token, { ...baseCookieOptions(), httpOnly: false, maxAge: 1000 * 60 * 60 * 24 * 7 });
  return token;
}

export function isValidCsrf(req: Request): boolean {
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get('x-csrf-token');
  if (typeof cookie !== 'string' || !header) return false;
  if (!safeEqual(cookie, header)) return false;
  const [raw, sig] = cookie.split('.');
  if (!raw || !sig) return false;
  return safeEqual(sig, hmac(env.APP_SECRET, `csrf:${raw}`, 'base64url'));
}

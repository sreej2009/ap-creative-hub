import type { NextFunction, Request, Response } from 'express';
import { rateLimit, type Options } from 'express-rate-limit';
import { isTest } from '../config/env.js';
import { isValidCsrf } from '../lib/cookies.js';
import { AppError } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Rejects state-changing requests that lack a valid CSRF token. */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!isValidCsrf(req)) {
    throw new AppError(403, 'CSRF_INVALID', 'Your session token is missing or expired. Please refresh and try again.');
  }
  next();
}

/**
 * Defence in depth against NoSQL operator injection: reject any JSON body
 * containing keys that start with "$" or contain ".". Zod schemas already
 * whitelist fields; this catches anything that slips through.
 */
export function rejectMongoOperators(req: Request, _res: Response, next: NextFunction) {
  const check = (value: unknown, depth: number): boolean => {
    if (depth > 20) return false;
    if (Array.isArray(value)) return value.every((v) => check(v, depth + 1));
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (k.startsWith('$') || k.includes('.') || k === '__proto__' || k === 'constructor') return false;
        if (!check(v, depth + 1)) return false;
      }
    }
    return true;
  };
  if (req.body && !check(req.body, 0)) {
    throw new AppError(400, 'INVALID_INPUT', 'Request contains disallowed characters in field names.');
  }
  next();
}

function limiter(windowMinutes: number, limit: number, message: string, extra: Partial<Options> = {}) {
  return rateLimit({
    windowMs: windowMinutes * 60_000,
    // Generous limits in automated tests so suites are not throttled.
    limit: isTest ? limit * 100 : limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message } });
    },
    ...extra,
  });
}

export const rateLimits = {
  api: () => limiter(5, 600, 'Too many requests. Please slow down.'),
  login: () => limiter(15, 10, 'Too many sign-in attempts. Please wait 15 minutes and try again.'),
  adminLogin: () => limiter(15, 8, 'Too many sign-in attempts. Please wait 15 minutes and try again.'),
  register: () => limiter(60, 10, 'Too many accounts created from this network. Please try later.'),
  passwordReset: () => limiter(60, 6, 'Too many reset requests. Please try again in an hour.'),
  checkout: () => limiter(10, 30, 'Too many checkout attempts. Please wait a few minutes.'),
  tracking: () => limiter(15, 60, 'Too many tracking requests. Please wait a few minutes.'),
  contact: () => limiter(60, 5, 'Too many messages sent. Please try again later.'),
  coupon: () => limiter(10, 30, 'Too many coupon attempts. Please wait a few minutes.'),
};

import type { NextFunction, Request, Response } from 'express';
import type { HydratedDocument } from 'mongoose';
import { ADMIN_COOKIE, CUSTOMER_COOKIE } from '../lib/cookies.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { can, type Permission } from '../lib/permissions.js';
import type { Actor } from '../models/Order.js';
import type { ISession } from '../models/Session.js';
import type { IUser } from '../models/User.js';
import { resolveSession } from '../services/auth.service.js';

declare module 'express-serve-static-core' {
  interface Request {
    customer?: HydratedDocument<IUser>;
    customerSession?: HydratedDocument<ISession>;
    admin?: HydratedDocument<IUser>;
    adminSession?: HydratedDocument<ISession>;
  }
}

/** Attaches the signed-in customer (if any). Never rejects. */
export async function loadCustomer(req: Request, _res: Response, next: NextFunction) {
  const resolved = await resolveSession(req.cookies?.[CUSTOMER_COOKIE], 'customer');
  if (resolved) {
    req.customer = resolved.user;
    req.customerSession = resolved.session;
  }
  next();
}

export async function requireCustomer(req: Request, res: Response, next: NextFunction) {
  await loadCustomer(req, res, () => undefined);
  if (!req.customer) throw unauthorized();
  next();
}

/** Admin API guard: authenticated staff/admin session plus a specific permission. */
export function requireAdmin(permission?: Permission) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.admin) {
      const resolved = await resolveSession(req.cookies?.[ADMIN_COOKIE], 'admin');
      if (!resolved) throw unauthorized('Admin session required.');
      req.admin = resolved.user;
      req.adminSession = resolved.session;
    }
    if (permission && !can(req.admin.role, permission)) throw forbidden();
    next();
  };
}

export function adminActor(req: Request): Actor {
  const admin = req.admin!;
  return { type: admin.role === 'admin' ? 'admin' : 'staff', id: admin._id, name: admin.name };
}

export function customerActor(req: Request): Actor {
  return req.customer
    ? { type: 'customer', id: req.customer._id, name: req.customer.name }
    : { type: 'customer', id: null, name: 'Guest' };
}

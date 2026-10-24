import argon2 from 'argon2';
import type { Request } from 'express';
import type { HydratedDocument, Types } from 'mongoose';
import { env, isTest } from '../config/env.js';
import { AppError, conflict, isDuplicateKeyError, unauthorized } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { normalizeEmail, randomToken, sha256 } from '../lib/util.js';
import { Session } from '../models/Session.js';
import { User, type IUser, STAFF_ROLES } from '../models/User.js';
import { notifications } from './notification.service.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const RESET_TOKEN_MINUTES = 30;

// argon2id with OWASP-recommended parameters; lighter in tests for speed.
const ARGON_OPTIONS = isTest
  ? ({ type: argon2.argon2id, memoryCost: 1024, timeCost: 1, parallelism: 1 } as const)
  : ({ type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const);

// Used to equalise timing when the account does not exist.
let dummyHash: string | undefined;

export async function hashPassword(password: string) {
  return argon2.hash(password, ARGON_OPTIONS);
}

export async function verifyPassword(hash: string, password: string) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export async function registerCustomer(input: { name: string; email: string; phone?: string; password: string }) {
  const email = normalizeEmail(input.email);
  try {
    // Role is fixed server-side: public registration can never create staff or admins.
    const user = await User.create({
      name: input.name,
      email,
      phone: input.phone,
      passwordHash: await hashPassword(input.password),
      role: 'customer',
    });
    return user;
  } catch (err) {
    if (isDuplicateKeyError(err)) throw conflict('An account with this email already exists.', 'EMAIL_TAKEN');
    throw err;
  }
}

/**
 * Verifies credentials with per-account lockout. Error messages are
 * deliberately generic so they do not reveal whether an email is registered.
 */
export async function authenticate(emailInput: string, password: string, kind: 'customer' | 'admin') {
  const email = normalizeEmail(emailInput);
  const user = await User.findOne({ email }).select('+passwordHash +failedLoginAttempts +lockUntil');
  const invalid = new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');

  if (!user) {
    dummyHash ??= await hashPassword(randomToken());
    await verifyPassword(dummyHash, password);
    throw invalid;
  }
  if (user.lockUntil && user.lockUntil > new Date()) {
    throw new AppError(423, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.`);
  }

  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    const attempts = (user.failedLoginAttempts ?? 0) + 1;
    const update: Record<string, unknown> = { failedLoginAttempts: attempts };
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      update.lockUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
      update.failedLoginAttempts = 0;
      logger.warn({ userId: String(user._id), kind }, 'account locked after repeated failed logins');
    }
    await User.updateOne({ _id: user._id }, { $set: update });
    throw invalid;
  }

  const isStaff = STAFF_ROLES.includes(user.role);
  if (kind === 'admin' && !isStaff) throw invalid;
  if (kind === 'customer' && isStaff) {
    throw new AppError(403, 'USE_ADMIN_LOGIN', 'Staff accounts must sign in through the admin portal.');
  }
  if (!user.isActive) throw new AppError(403, 'ACCOUNT_DISABLED', 'This account has been disabled. Please contact support.');

  await User.updateOne(
    { _id: user._id },
    { $set: { failedLoginAttempts: 0, lockUntil: null, lastLoginAt: new Date() } },
  );

  // Opportunistically upgrade hashes created with weaker parameters.
  if (argon2.needsRehash(user.passwordHash, ARGON_OPTIONS)) {
    await User.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(password) } });
  }
  return user;
}

export async function createSession(user: HydratedDocument<IUser>, kind: 'customer' | 'admin', req: Request) {
  const token = randomToken(32);
  const ttlMs = kind === 'admin' ? env.ADMIN_SESSION_HOURS * 3600_000 : env.CUSTOMER_SESSION_DAYS * 86400_000;
  const expiresAt = new Date(Date.now() + ttlMs);
  await Session.create({
    tokenHash: sha256(token),
    user: user._id,
    role: user.role,
    kind,
    expiresAt,
    ip: req.ip,
    userAgent: req.get('user-agent')?.slice(0, 300),
  });
  return { token, expiresAt };
}

export async function resolveSession(token: string | undefined, kind: 'customer' | 'admin') {
  if (!token || typeof token !== 'string' || token.length > 100) return null;
  const session = await Session.findOne({ tokenHash: sha256(token), kind });
  if (!session || session.expiresAt <= new Date()) return null;
  const user = await User.findById(session.user);
  if (!user || !user.isActive) return null;
  // Role changes take effect immediately: a demoted admin's session stops working.
  if (kind === 'admin' && !STAFF_ROLES.includes(user.role)) return null;
  if (kind === 'customer' && user.role !== 'customer') return null;
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
    await Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } });
  }
  return { user, session };
}

export async function destroySession(token: string | undefined) {
  if (!token || typeof token !== 'string') return;
  await Session.deleteOne({ tokenHash: sha256(token) });
}

export async function destroyAllSessions(userId: Types.ObjectId) {
  await Session.deleteMany({ user: userId });
}

/** Always resolves the same way so callers cannot probe which emails exist. */
export async function requestPasswordReset(emailInput: string) {
  const email = normalizeEmail(emailInput);
  const user = await User.findOne({ email, role: 'customer', isActive: true });
  if (!user) return;
  const token = randomToken(32);
  await User.updateOne(
    { _id: user._id },
    { $set: { passwordReset: { tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000) } } },
  );
  const resetUrl = `${env.APP_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
  await notifications.sendPasswordReset(user, resetUrl, RESET_TOKEN_MINUTES);
  return { token }; // returned only for tests; the route never exposes it
}

export async function resetPassword(token: string, newPassword: string) {
  const user = await User.findOne({
    'passwordReset.tokenHash': sha256(token),
    'passwordReset.expiresAt': { $gt: new Date() },
  });
  if (!user) throw new AppError(400, 'INVALID_RESET_TOKEN', 'This reset link is invalid or has expired. Please request a new one.');
  await User.updateOne(
    { _id: user._id },
    {
      $set: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date(), failedLoginAttempts: 0, lockUntil: null },
      $unset: { passwordReset: 1 },
    },
  );
  await destroyAllSessions(user._id);
}

export async function changePassword(userId: Types.ObjectId, currentPassword: string, newPassword: string) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw unauthorized();
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new AppError(400, 'INVALID_PASSWORD', 'Your current password is incorrect.', { currentPassword: 'Incorrect password' });
  }
  await User.updateOne(
    { _id: user._id },
    { $set: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() } },
  );
  await destroyAllSessions(user._id);
}

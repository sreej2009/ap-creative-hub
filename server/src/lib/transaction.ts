import mongoose, { type ClientSession } from 'mongoose';
import { env } from '../config/env.js';
import { logger } from './logger.js';

let supported: boolean | undefined;

/**
 * Multi-document transactions need a replica set or sharded cluster
 * (MongoDB Atlas always qualifies). Standalone servers fall back to
 * atomic single-document updates with explicit compensation.
 */
export async function transactionsSupported(): Promise<boolean> {
  if (supported !== undefined) return supported;
  if (env.MONGODB_TRANSACTIONS === 'off') return (supported = false);
  try {
    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    supported = Boolean(hello.setName || hello.msg === 'isdbgrid');
  } catch {
    supported = false;
  }
  if (!supported) logger.warn('MongoDB transactions unavailable — using compensating-update fallback.');
  return supported;
}

/** Test hook to force a mode. */
export function setTransactionSupportForTests(value: boolean | undefined) {
  supported = value;
}

/**
 * Runs `fn` inside a transaction when supported (retrying on transient
 * write conflicts), otherwise runs it directly with `session = null`.
 * `fn` must therefore be safe to retry and must not call external services.
 */
export async function runInTransaction<T>(fn: (session: ClientSession | null) => Promise<T>): Promise<T> {
  if (!(await transactionsSupported())) return fn(null);
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
    );
    return result as T;
  } finally {
    await session.endSession();
  }
}

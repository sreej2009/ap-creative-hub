import { Schema, model, type Types } from 'mongoose';
import type { Role } from './User.js';

/**
 * Server-side session. Only a SHA-256 hash of the session token is stored,
 * so a database leak does not expose usable cookies. Expired sessions are
 * removed automatically by the TTL index.
 */
export interface ISession {
  tokenHash: string;
  user: Types.ObjectId;
  role: Role;
  kind: 'customer' | 'admin';
  expiresAt: Date;
  lastSeenAt: Date;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
}

const SessionSchema = new Schema<ISession>(
  {
    tokenHash: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, required: true },
    kind: { type: String, enum: ['customer', 'admin'], required: true },
    expiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, default: () => new Date() },
    ip: String,
    userAgent: { type: String, maxlength: 300 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = model<ISession>('Session', SessionSchema);

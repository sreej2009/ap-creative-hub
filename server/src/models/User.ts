import { Schema, model, type Types, type HydratedDocument } from 'mongoose';

export const ROLES = ['customer', 'staff', 'admin'] as const;
export type Role = (typeof ROLES)[number];
export const STAFF_ROLES: Role[] = ['staff', 'admin'];

export interface Address {
  _id: Types.ObjectId;
  label?: string;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  isDefault: boolean;
}

export interface IUser {
  name: string;
  email: string;
  phone?: string;
  passwordHash: string;
  role: Role;
  isActive: boolean;
  addresses: Types.DocumentArray<Address & Types.Subdocument>;
  wishlist: Types.ObjectId[];
  whatsappOptIn: boolean;
  failedLoginAttempts: number;
  lockUntil?: Date | null;
  passwordReset?: { tokenHash: string; expiresAt: Date } | null;
  passwordChangedAt?: Date;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const AddressSchema = new Schema<Address>(
  {
    label: { type: String, trim: true, maxlength: 40 },
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, required: true, trim: true, maxlength: 15 },
    line1: { type: String, required: true, trim: true, maxlength: 200 },
    line2: { type: String, trim: true, maxlength: 200 },
    landmark: { type: String, trim: true, maxlength: 120 },
    city: { type: String, required: true, trim: true, maxlength: 80 },
    state: { type: String, required: true, trim: true, maxlength: 80 },
    pincode: { type: String, required: true, match: /^[1-9][0-9]{5}$/ },
    country: { type: String, default: 'IN' },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true },
);

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    phone: { type: String, trim: true, maxlength: 15 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'customer', index: true },
    isActive: { type: Boolean, default: true },
    addresses: { type: [AddressSchema], default: [] },
    wishlist: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
    whatsappOptIn: { type: Boolean, default: false },
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
    passwordReset: {
      type: new Schema({ tokenHash: String, expiresAt: Date }, { _id: false }),
      select: false,
    },
    passwordChangedAt: Date,
    lastLoginAt: Date,
  },
  { timestamps: true },
);

UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ 'passwordReset.tokenHash': 1 }, { sparse: true });
UserSchema.index({ name: 'text', email: 'text' });

/** Fields safe to return to the account owner. */
export function toPublicUser(user: HydratedDocument<IUser> | (IUser & { _id: Types.ObjectId })) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    phone: user.phone ?? null,
    role: user.role,
    whatsappOptIn: user.whatsappOptIn,
    createdAt: user.createdAt,
  };
}

export const User = model<IUser>('User', UserSchema);

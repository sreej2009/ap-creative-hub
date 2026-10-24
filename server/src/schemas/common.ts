import { z } from 'zod';
import { normalizePhone } from '../lib/util.js';

export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh',
  'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
  'West Bengal',
] as const;

const text = (max: number, min = 1) => z.string().trim().min(min).max(max);

export const nameField = z.string().trim().min(2, 'Please enter your name').max(100);
export const emailField = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address').max(254));
export const phoneField = z
  .string()
  .trim()
  .transform(normalizePhone)
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'));
export const passwordField = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'Use at most 128 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/[0-9]/, 'Include at least one number');

export const addressFields = {
  fullName: nameField,
  phone: phoneField,
  line1: text(200, 3),
  line2: z.string().trim().max(200).optional().or(z.literal('').transform(() => undefined)),
  landmark: z.string().trim().max(120).optional().or(z.literal('').transform(() => undefined)),
  city: text(80, 2),
  state: z.enum(INDIAN_STATES, { error: 'Select a state' }),
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code'),
};
export const AddressSchema = z.object(addressFields);

/** Money in paise: positive integer, capped at ₹10,00,000. */
export const paise = z.number().int('Amount must be in whole paise').positive().max(100_000_000);
export const paiseOrZero = z.number().int().min(0).max(100_000_000);

export const pageQuery = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export const searchText = z.string().trim().max(100).optional();

export const boolQuery = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .optional();

export const optionalDate = z
  .union([z.iso.datetime({ offset: true }), z.iso.date(), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v ? new Date(v) : null));

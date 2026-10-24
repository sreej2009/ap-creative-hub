import type { Types } from 'mongoose';
import { cloudinaryConfigured } from '../integrations/cloudinary.js';
import { emailConfigured } from '../integrations/email.js';
import { getPaymentGateway, razorpayStatus } from '../integrations/razorpay.js';
import { StoreSettings, type IStoreSettings } from '../models/misc.js';

let cache: { value: IStoreSettings; at: number } | null = null;
const TTL_MS = 30_000;

export async function getSettings(): Promise<IStoreSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const doc = await StoreSettings.findOneAndUpdate(
    { _id: 'store' },
    { $setOnInsert: { _id: 'store' } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();
  cache = { value: doc as IStoreSettings, at: Date.now() };
  return cache.value;
}

export function invalidateSettingsCache() {
  cache = null;
}

export async function updateSettings(input: Omit<IStoreSettings, '_id' | 'updatedAt' | 'updatedBy'>, userId: Types.ObjectId) {
  const doc = await StoreSettings.findOneAndUpdate(
    { _id: 'store' },
    { $set: { ...input, updatedBy: userId } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();
  invalidateSettingsCache();
  return doc;
}

/** Public subset for the storefront. Never includes secrets. */
export async function publicSettings() {
  const s = await getSettings();
  const gateway = getPaymentGateway();
  return {
    announcement: s.announcement,
    hero: s.hero,
    shipping: s.shipping,
    cod: s.cod,
    returns: s.returns,
    contact: s.contact,
    payments: {
      razorpay: gateway ? { enabled: true, mode: gateway.mode } : { enabled: false, mode: null },
      cod: s.cod.enabled,
    },
  };
}

/** Integration health for the admin settings page (configured / not configured, never the values). */
export function integrationStatus() {
  const rp = razorpayStatus();
  return {
    razorpay: rp.configured
      ? { configured: true, mode: rp.mode, webhookConfigured: rp.webhookConfigured }
      : { configured: false, reason: rp.reason },
    cloudinary: cloudinaryConfigured()
      ? { configured: true }
      : { configured: false, reason: 'CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are not set.' },
    email: emailConfigured()
      ? { configured: true }
      : { configured: false, reason: 'SMTP_HOST and EMAIL_FROM are not set. Emails are logged as skipped.' },
    whatsapp: { configured: false, reason: 'No WhatsApp Business provider is integrated yet.' },
    courier: { configured: false, reason: 'No courier API is integrated. Tracking updates are entered manually.' },
  };
}

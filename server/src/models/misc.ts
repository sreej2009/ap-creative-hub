import { Schema, model, type Types } from 'mongoose';

/* ------------------------------------------------------------------ */
/* Notification log                                                    */
/* ------------------------------------------------------------------ */

export const NOTIFICATION_EVENTS = [
  'order_confirmation',
  'payment_confirmation',
  'shipment',
  'delivery_update',
  'cancellation',
  'refund',
  'password_reset',
  'contact_message',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export interface INotification {
  event: NotificationEvent;
  channel: 'email' | 'whatsapp';
  recipient: string;
  order?: Types.ObjectId | null;
  user?: Types.ObjectId | null;
  /** 'skipped' means no provider was configured or the recipient has not consented. Nothing was sent. */
  status: 'sent' | 'failed' | 'skipped';
  reason?: string;
  providerMessageId?: string;
  subject?: string;
  createdAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    event: { type: String, required: true },
    channel: { type: String, enum: ['email', 'whatsapp'], required: true },
    recipient: { type: String, required: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: ['sent', 'failed', 'skipped'], required: true },
    reason: String,
    providerMessageId: String,
    subject: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
NotificationSchema.index({ createdAt: -1 });
NotificationSchema.index({ order: 1 });

export const Notification = model<INotification>('Notification', NotificationSchema);

/* ------------------------------------------------------------------ */
/* Uploaded media (for orphan cleanup)                                  */
/* ------------------------------------------------------------------ */

export interface IMediaAsset {
  publicId: string;
  url: string;
  width?: number;
  height?: number;
  bytes?: number;
  format?: string;
  /** temp = uploaded but not yet saved on a product/category. */
  status: 'temp' | 'attached' | 'deleted';
  uploadedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const MediaAssetSchema = new Schema<IMediaAsset>(
  {
    publicId: { type: String, required: true },
    url: { type: String, required: true },
    width: Number,
    height: Number,
    bytes: Number,
    format: String,
    status: { type: String, enum: ['temp', 'attached', 'deleted'], default: 'temp' },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
MediaAssetSchema.index({ publicId: 1 }, { unique: true });
MediaAssetSchema.index({ status: 1, createdAt: 1 });

export const MediaAsset = model<IMediaAsset>('MediaAsset', MediaAssetSchema);

/* ------------------------------------------------------------------ */
/* Contact messages                                                    */
/* ------------------------------------------------------------------ */

export interface IContactMessage {
  name: string;
  email: string;
  phone?: string;
  subject: string;
  message: string;
  status: 'new' | 'read' | 'resolved';
  ip?: string;
  createdAt: Date;
}

const ContactMessageSchema = new Schema<IContactMessage>(
  {
    name: { type: String, required: true, maxlength: 100 },
    email: { type: String, required: true, maxlength: 254 },
    phone: { type: String, maxlength: 15 },
    subject: { type: String, required: true, maxlength: 150 },
    message: { type: String, required: true, maxlength: 3000 },
    status: { type: String, enum: ['new', 'read', 'resolved'], default: 'new' },
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
ContactMessageSchema.index({ status: 1, createdAt: -1 });

export const ContactMessage = model<IContactMessage>('ContactMessage', ContactMessageSchema);

/* ------------------------------------------------------------------ */
/* Store settings (singleton document)                                 */
/* ------------------------------------------------------------------ */

export interface IStoreSettings {
  _id: string;
  announcement: string;
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    ctaLabel: string;
    ctaHref: string;
    imageUrl: string;
  };
  shipping: { flatFee: number; freeShippingThreshold: number; estimatedDays: string };
  cod: { enabled: boolean; fee: number; maxOrderValue: number };
  returns: { windowDays: number };
  contact: { email: string; phone: string; whatsapp: string; instagram: string; address: string; hours: string };
  updatedBy?: Types.ObjectId;
  updatedAt: Date;
}

const StoreSettingsSchema = new Schema<IStoreSettings>(
  {
    _id: { type: String, default: 'store' },
    announcement: { type: String, default: 'Free shipping on orders above ₹999 · COD available', maxlength: 160 },
    hero: {
      eyebrow: { type: String, default: 'New season edit', maxlength: 60 },
      title: { type: String, default: 'Little sparkles for every day', maxlength: 120 },
      subtitle: {
        type: String,
        default: 'Handpicked jewellery, one-gram gold, hair accessories and thoughtful gifts — styled by A&P.',
        maxlength: 300,
      },
      ctaLabel: { type: String, default: 'Shop the collection', maxlength: 40 },
      ctaHref: { type: String, default: '/shop', maxlength: 200 },
      imageUrl: { type: String, default: '/samples/hero.svg', maxlength: 500 },
    },
    shipping: {
      flatFee: { type: Number, default: 7900 },
      freeShippingThreshold: { type: Number, default: 99900 },
      estimatedDays: { type: String, default: '4–7 business days', maxlength: 60 },
    },
    cod: {
      enabled: { type: Boolean, default: true },
      fee: { type: Number, default: 4900 },
      maxOrderValue: { type: Number, default: 500000 },
    },
    returns: { windowDays: { type: Number, default: 7 } },
    contact: {
      email: { type: String, default: '', maxlength: 254 },
      phone: { type: String, default: '', maxlength: 20 },
      whatsapp: { type: String, default: '', maxlength: 20 },
      instagram: { type: String, default: '', maxlength: 200 },
      address: { type: String, default: '', maxlength: 300 },
      hours: { type: String, default: 'Mon–Sat, 10am–7pm IST', maxlength: 100 },
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

export const StoreSettings = model<IStoreSettings>('StoreSettings', StoreSettingsSchema);

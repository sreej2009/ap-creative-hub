import type { Types } from 'mongoose';
import { env } from '../config/env.js';
import { getMediaStorage, isAllowedImageUrl } from '../integrations/cloudinary.js';
import { AppError, badGateway, badRequest, serviceUnavailable } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { Category } from '../models/Category.js';
import { MediaAsset } from '../models/misc.js';
import { Product } from '../models/Product.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;

/** Detects the real file type from magic bytes — the client-supplied MIME type is not trusted. */
export function sniffImageType(buf: Buffer): (typeof ALLOWED_IMAGE_MIME)[number] | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  const brand = buf.toString('ascii', 4, 12);
  if (brand === 'ftypavif' || brand === 'ftypavis') return 'image/avif';
  return null;
}

export async function uploadImage(file: { buffer: Buffer; mimetype: string; size: number; originalname: string }, userId: Types.ObjectId) {
  const storage = getMediaStorage();
  if (!storage) {
    throw serviceUnavailable(
      'Image uploads are not configured. Add your Cloudinary credentials (CLOUDINARY_*) to the server environment.',
      'UPLOADS_NOT_CONFIGURED',
    );
  }
  if (file.size > MAX_IMAGE_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'Images must be 5 MB or smaller.');
  const detected = sniffImageType(file.buffer);
  if (!detected) throw badRequest('Only JPEG, PNG, WebP or AVIF images are allowed.', undefined, 'INVALID_FILE_TYPE');
  if (!ALLOWED_IMAGE_MIME.includes(file.mimetype as never) || detected !== file.mimetype) {
    throw badRequest('The file content does not match its declared type.', undefined, 'INVALID_FILE_TYPE');
  }

  let stored;
  try {
    stored = await storage.upload(file.buffer, { folder: `${env.CLOUDINARY_FOLDER}/products` });
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'image upload failed');
    throw badGateway('The image could not be uploaded. Please try again.', 'UPLOAD_FAILED');
  }

  try {
    await MediaAsset.create({ ...stored, status: 'temp', uploadedBy: userId });
  } catch (err) {
    // Do not leave an untracked file behind if we cannot record it.
    await storage.destroy(stored.publicId).catch(() => undefined);
    throw err;
  }
  return stored;
}

interface ImageLike {
  url: string;
  publicId?: string;
}

/** Validates images submitted on a product/category: only our uploads or bundled sample art. */
export async function assertValidImages(images: ImageLike[]) {
  for (const img of images) {
    if (!isAllowedImageUrl(img.url)) {
      throw badRequest('Images must be uploaded through the admin panel.', { images: `Unsupported image URL: ${img.url.slice(0, 80)}` });
    }
  }
  const ids = images.map((i) => i.publicId).filter((x): x is string => Boolean(x));
  if (ids.length) {
    const found = await MediaAsset.countDocuments({ publicId: { $in: ids }, status: { $ne: 'deleted' } });
    if (found !== new Set(ids).size) throw badRequest('One or more images no longer exist. Please re-upload them.', { images: 'Unknown image' });
  }
}

export async function markAttached(images: ImageLike[]) {
  const ids = images.map((i) => i.publicId).filter((x): x is string => Boolean(x));
  if (ids.length) await MediaAsset.updateMany({ publicId: { $in: ids } }, { $set: { status: 'attached' } });
}

/** Deletes images that are no longer referenced anywhere. Failures are left for the cleanup job. */
export async function releaseImages(publicIds: string[]) {
  const storage = getMediaStorage();
  for (const publicId of publicIds) {
    const stillUsed =
      (await Product.exists({ 'images.publicId': publicId })) || (await Category.exists({ 'image.publicId': publicId }));
    if (stillUsed) continue;
    if (!storage) {
      await MediaAsset.updateOne({ publicId }, { $set: { status: 'temp' } });
      continue;
    }
    try {
      await storage.destroy(publicId);
      await MediaAsset.updateOne({ publicId }, { $set: { status: 'deleted' } });
    } catch (err) {
      logger.warn({ publicId, err: (err as Error).message }, 'image delete failed; will retry in cleanup');
      await MediaAsset.updateOne({ publicId }, { $set: { status: 'temp' } });
    }
  }
}

/** Removes uploads that were never attached (abandoned forms, failed saves) after 24 hours. */
export async function cleanupOrphanedMedia(olderThanHours = 24) {
  const cutoff = new Date(Date.now() - olderThanHours * 3600_000);
  const orphans = await MediaAsset.find({ status: 'temp', updatedAt: { $lt: cutoff } }).limit(100).lean();
  if (orphans.length) await releaseImages(orphans.map((o) => o.publicId));
  return orphans.length;
}

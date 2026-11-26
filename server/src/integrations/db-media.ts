import mongoose from 'mongoose';
import { IMAGE_EXTENSION, imageDimensions, sniffImageType } from '../lib/image.js';
import type { MediaStorage, StoredImage } from './cloudinary.js';

/**
 * Fallback image storage in MongoDB (GridFS bucket "media"), used when Cloudinary
 * is not configured. Images are served by GET /media/:id.:ext (see app.ts).
 * There is no resizing, so keep uploads small: they count towards the database size.
 */
export const MEDIA_BUCKET = 'media';
export const DB_MEDIA_PREFIX = 'db/';
/** URL path of a database-stored image: /media/<24-hex id>.<ext> */
export const DB_MEDIA_URL = /^\/media\/([a-f0-9]{24})\.(jpg|png|webp|avif)$/;

export function mediaBucket() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Database is not connected');
  return new mongoose.mongo.GridFSBucket(db, { bucketName: MEDIA_BUCKET });
}

export class DatabaseMediaStorage implements MediaStorage {
  async upload(buffer: Buffer): Promise<StoredImage> {
    const type = sniffImageType(buffer);
    if (!type) throw new Error('Unsupported image type');
    const ext = IMAGE_EXTENSION[type];
    const id = new mongoose.Types.ObjectId();
    await new Promise<void>((resolve, reject) => {
      const stream = mediaBucket().openUploadStreamWithId(id, `${id}.${ext}`, { metadata: { contentType: type } });
      stream.once('finish', () => resolve());
      stream.once('error', reject);
      stream.end(buffer);
    });
    const { width, height } = imageDimensions(buffer, type);
    return { publicId: `${DB_MEDIA_PREFIX}${id}`, url: `/media/${id}.${ext}`, width, height, bytes: buffer.length, format: ext };
  }

  async destroy(publicId: string) {
    if (!publicId.startsWith(DB_MEDIA_PREFIX)) return;
    try {
      await mediaBucket().delete(new mongoose.Types.ObjectId(publicId.slice(DB_MEDIA_PREFIX.length)));
    } catch (err) {
      // Already gone is fine; anything else should be retried by the cleanup job.
      if (!/FileNotFound|File not found/i.test((err as Error).message)) throw err;
    }
  }
}

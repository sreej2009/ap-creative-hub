import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import { env } from '../config/env.js';

export interface StoredImage {
  publicId: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
  format: string;
}

export interface MediaStorage {
  upload(buffer: Buffer, options: { folder: string; filenameHint?: string }): Promise<StoredImage>;
  destroy(publicId: string): Promise<void>;
}

export function cloudinaryConfigured(): boolean {
  return Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
}

class CloudinaryStorage implements MediaStorage {
  constructor() {
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }
  upload(buffer: Buffer, options: { folder: string }): Promise<StoredImage> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: options.folder,
          resource_type: 'image',
          // Cap stored dimensions. Cloudinary strips EXIF/GPS metadata from delivered images by default.
          transformation: [{ width: 2000, height: 2000, crop: 'limit' }],
          overwrite: false,
          unique_filename: true,
        },
        (error, result?: UploadApiResponse) => {
          if (error || !result) return reject(error ?? new Error('Upload failed'));
          resolve({
            publicId: result.public_id,
            url: result.secure_url,
            width: result.width,
            height: result.height,
            bytes: result.bytes,
            format: result.format,
          });
        },
      );
      stream.end(buffer);
    });
  }
  async destroy(publicId: string) {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });
  }
}

let override: MediaStorage | null | undefined;
let cached: MediaStorage | null | undefined;

export function getMediaStorage(): MediaStorage | null {
  if (override !== undefined) return override;
  if (cached !== undefined) return cached;
  return (cached = cloudinaryConfigured() ? new CloudinaryStorage() : null);
}

export function setMediaStorageForTests(storage: MediaStorage | null | undefined) {
  override = storage;
}

/** Image URLs we accept on products/categories: our Cloudinary account or bundled sample art. */
export function isAllowedImageUrl(url: string): boolean {
  if (/^\/samples\/[a-z0-9-]+\.(svg|png|jpe?g|webp)$/i.test(url)) return true;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'res.cloudinary.com') return false;
    // In tests a mock cloud name is used; otherwise require our own cloud.
    const cloud = env.CLOUDINARY_CLOUD_NAME;
    return !cloud || u.pathname.startsWith(`/${cloud}/`);
  } catch {
    return false;
  }
}

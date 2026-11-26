import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { getMediaStorage, isAllowedImageUrl, setMediaStorageForTests, type MediaStorage } from '../src/integrations/cloudinary.js';
import { DatabaseMediaStorage } from '../src/integrations/db-media.js';
import { imageDimensions } from '../src/lib/image.js';
import { MediaAsset } from '../src/models/misc.js';
import { cleanupOrphanedMedia, sniffImageType } from '../src/services/media.service.js';
import { connectTestDb, disconnectTestDb, loginAs, resetDb } from './helpers.js';

const app = createApp();

// Minimal valid file signatures
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(64)]);
/** PNG whose IHDR says 640×480. */
function pngOfSize(width: number, height: number) {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.alloc(40)]);
}
const HTML = Buffer.from('<html><script>alert(1)</script></html>          ');

function mockStorage(): MediaStorage & { upload: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> } {
  let n = 0;
  return {
    upload: vi.fn(async () => {
      n++;
      return { publicId: `ap/products/img${n}`, url: `https://res.cloudinary.com/mock-cloud/image/upload/img${n}.png`, width: 800, height: 800, bytes: 1234, format: 'png' };
    }),
    destroy: vi.fn(async () => undefined),
  };
}

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(resetDb);
afterEach(() => setMediaStorageForTests(undefined));

describe('image upload validation', () => {
  it('detects real image types from magic bytes', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(WEBP)).toBe('image/webp');
    expect(sniffImageType(HTML)).toBeNull();
  });

  it('returns a clear setup message when Cloudinary is not configured', async () => {
    setMediaStorageForTests(null);
    const { client } = await loginAs('admin', app);
    const res = await client.agent.post('/api/v1/admin/uploads/images').set('X-CSRF-Token', client.csrf).attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('UPLOADS_NOT_CONFIGURED');
  });

  it('uploads a valid image and tracks it as a temporary asset', async () => {
    const storage = mockStorage();
    setMediaStorageForTests(storage);
    const { client } = await loginAs('staff', app);
    const res = await client.agent.post('/api/v1/admin/uploads/images').set('X-CSRF-Token', client.csrf).attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^https:\/\/res\.cloudinary\.com\//);
    expect((await MediaAsset.findOne({ publicId: res.body.publicId }))!.status).toBe('temp');
  });

  it('rejects disguised, unsupported and oversized files', async () => {
    const storage = mockStorage();
    setMediaStorageForTests(storage);
    const { client } = await loginAs('admin', app);
    const up = (buf: Buffer, name: string, type: string) =>
      client.agent.post('/api/v1/admin/uploads/images').set('X-CSRF-Token', client.csrf).attach('file', buf, { filename: name, contentType: type });

    const disguised = await up(HTML, 'evil.png', 'image/png');
    expect(disguised.status).toBe(400);
    expect(disguised.body.error.code).toBe('INVALID_FILE_TYPE');

    const mismatch = await up(PNG, 'a.jpg', 'image/jpeg');
    expect(mismatch.status).toBe(400);

    const svg = await up(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'a.svg', 'image/svg+xml');
    expect(svg.status).toBe(400);

    const big = await up(Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]), 'big.png', 'image/png');
    expect(big.status).toBe(413);

    const none = await client.post('/api/v1/admin/uploads/images', {});
    expect(none.status).toBe(400);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('reports provider failures without leaving records behind', async () => {
    const storage = mockStorage();
    storage.upload.mockRejectedValueOnce(new Error('network down'));
    setMediaStorageForTests(storage);
    const { client } = await loginAs('admin', app);
    const res = await client.agent.post('/api/v1/admin/uploads/images').set('X-CSRF-Token', client.csrf).attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(502);
    expect(await MediaAsset.countDocuments()).toBe(0);
  });

  it('requires an admin session', async () => {
    const { client } = await loginAs('customer', app);
    const res = await client.agent.post('/api/v1/admin/uploads/images').set('X-CSRF-Token', client.csrf).attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(401);
  });

  it('cleans up orphaned uploads that were never attached', async () => {
    const storage = mockStorage();
    setMediaStorageForTests(storage);
    const old = new Date(Date.now() - 48 * 3600_000);
    await MediaAsset.collection.insertMany([
      { publicId: 'ap/orphan', url: 'https://res.cloudinary.com/mock-cloud/o.png', status: 'temp', createdAt: old, updatedAt: old },
      { publicId: 'ap/fresh', url: 'https://res.cloudinary.com/mock-cloud/f.png', status: 'temp', createdAt: new Date(), updatedAt: new Date() },
      { publicId: 'ap/used', url: 'https://res.cloudinary.com/mock-cloud/u.png', status: 'attached', createdAt: old, updatedAt: old },
    ]);
    expect(await cleanupOrphanedMedia()).toBe(1);
    expect(storage.destroy).toHaveBeenCalledWith('ap/orphan');
    expect(storage.destroy).toHaveBeenCalledTimes(1);
    expect((await MediaAsset.findOne({ publicId: 'ap/orphan' }))!.status).toBe('deleted');
  });
});

describe('database image storage (no Cloudinary)', () => {
  it('is used when Cloudinary credentials are missing', () => {
    expect(getMediaStorage()).toBeInstanceOf(DatabaseMediaStorage);
  });

  it('reads pixel sizes from PNG and JPEG headers', () => {
    expect(imageDimensions(pngOfSize(640, 480), 'image/png')).toEqual({ width: 640, height: 480 });
    // SOI, then an SOF0 segment: length 17, precision 8, height 300, width 200.
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x00, 0xc8]), Buffer.alloc(20)]);
    expect(imageDimensions(jpeg, 'image/jpeg')).toEqual({ width: 200, height: 300 });
    expect(imageDimensions(Buffer.alloc(4), 'image/png')).toEqual({ width: 0, height: 0 });
  });

  it('stores an upload in the database and serves it from /media', async () => {
    const { client } = await loginAs('admin', app);
    const file = pngOfSize(640, 480);
    const res = await client.agent.post('/api/v1/admin/uploads/images').set('X-CSRF-Token', client.csrf).attach('file', file, { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^\/media\/[a-f0-9]{24}\.png$/);
    expect(res.body).toMatchObject({ width: 640, height: 480, bytes: file.length, format: 'png' });
    expect(isAllowedImageUrl(res.body.url)).toBe(true);
    expect((await MediaAsset.findOne({ publicId: res.body.publicId }))!.status).toBe('temp');

    const img = await client.agent.get(res.body.url).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['cache-control']).toContain('immutable');
    expect(Buffer.compare(img.body as Buffer, file)).toBe(0);

    await getMediaStorage()!.destroy(res.body.publicId);
    expect((await client.agent.get(res.body.url)).status).toBe(404);
    // Deleting twice is harmless.
    await getMediaStorage()!.destroy(res.body.publicId);
  });

  it('does not serve malformed media paths', async () => {
    const { client } = await loginAs('customer', app);
    expect((await client.agent.get('/media/not-an-id.png')).status).toBe(404);
    expect((await client.agent.get('/media/0123456789abcdef01234567.svg')).status).toBe(404);
    expect(isAllowedImageUrl('/media/../etc/passwd')).toBe(false);
  });
});

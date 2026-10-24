import crypto from 'node:crypto';

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export function hmac(secret: string, value: string, encoding: 'hex' | 'base64url' = 'hex') {
  return crypto.createHmac('sha256', secret).update(value).digest(encoding);
}

/** Constant-time string comparison (returns false on length mismatch). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

const ORDER_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Human-friendly order number, e.g. AP-261024-7KQ2M. Uniqueness is enforced by an index. */
export function generateOrderNumber(now = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const date = ist.toISOString().slice(2, 10).replace(/-/g, '');
  const bytes = crypto.randomBytes(5);
  let suffix = '';
  for (const b of bytes) suffix += ORDER_ALPHABET[b % ORDER_ALPHABET.length];
  return `AP-${date}-${suffix}`;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Indian mobile numbers normalised to 10 digits (strips +91 / leading 0). */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return '***';
  return `${user.slice(0, 2)}***@${domain}`;
}

export function maskPhone(phone: string): string {
  return phone.length >= 4 ? `******${phone.slice(-4)}` : '****';
}

export function paginate(page: number, limit: number) {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const safePage = Math.max(page, 1);
  return { skip: (safePage - 1) * safeLimit, limit: safeLimit, page: safePage };
}

export function pageMeta(total: number, page: number, limit: number) {
  return { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

export const formatINR = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

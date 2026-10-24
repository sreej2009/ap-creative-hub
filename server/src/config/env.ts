import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * Environment configuration. Values are validated once at startup so the
 * process fails fast on misconfiguration instead of misbehaving later.
 * Secrets are never logged or sent to the client.
 */

// Load server/.env (if present) without overriding variables already set by the host.
const envFile = path.resolve(process.cwd(), '.env');
if (process.env.NODE_ENV !== 'test' && fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : ['true', '1', 'yes'].includes(v)));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  MONGODB_URI: optionalString,
  /** 'auto' detects replica-set support; 'off' forces the non-transactional fallback. */
  MONGODB_TRANSACTIONS: z.enum(['auto', 'off']).default('auto'),

  /** Public URL of the storefront, used to build links in emails. */
  APP_URL: z.url().default('http://localhost:5173'),
  /** Comma-separated list of allowed browser origins (only needed when the client is served from a different origin). */
  CORS_ORIGINS: z.string().default(''),
  /** Number of reverse proxies in front of the app (for correct client IPs in rate limiting). */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  /** Serve the built client (client/dist) from Express in production. */
  SERVE_CLIENT: bool(false),
  CLIENT_DIST_DIR: z.string().default('../client/dist'),

  /** Long random secret used to sign CSRF and order-tracking tokens. */
  APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 characters'),
  /** Defaults to true in production; only disable for local HTTP testing. */
  COOKIE_SECURE: bool(process.env.NODE_ENV === 'production'),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  CUSTOMER_SESSION_DAYS: z.coerce.number().int().positive().default(30),
  ADMIN_SESSION_HOURS: z.coerce.number().int().positive().default(12),

  CLOUDINARY_CLOUD_NAME: optionalString,
  CLOUDINARY_API_KEY: optionalString,
  CLOUDINARY_API_SECRET: optionalString,
  CLOUDINARY_FOLDER: z.string().default('ap-creative-hub'),

  RAZORPAY_KEY_ID: optionalString,
  RAZORPAY_KEY_SECRET: optionalString,
  RAZORPAY_WEBHOOK_SECRET: optionalString,
  /** Live keys are refused unless the owner explicitly sets this to true. */
  RAZORPAY_ALLOW_LIVE: bool(false),

  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  EMAIL_FROM: optionalString,

  STORE_NAME: z.string().default('A&P Creative Hub'),
  /** How long stock stays reserved for an unpaid online order. */
  RESERVATION_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(30),
  /** Run background jobs (reservation expiry, media cleanup) in this process. */
  RUN_JOBS: bool(true),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // eslint-disable-next-line no-console
    console.error(`\nInvalid environment configuration:\n${problems}\n\nSee server/.env.example.\n`);
    process.exit(1);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    if (!env.COOKIE_SECURE) {
      console.warn('[config] COOKIE_SECURE is false in production — cookies will be sent over plain HTTP.');
    }
    if (env.COOKIE_SAMESITE === 'none' && !env.COOKIE_SECURE) {
      console.error('[config] COOKIE_SAMESITE=none requires COOKIE_SECURE=true.');
      process.exit(1);
    }
  }
  return env;
}

export const env = loadEnv();
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

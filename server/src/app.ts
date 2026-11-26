import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { pinoHttp } from 'pino-http';
import { corsOrigins, env, isProd, isTest } from './config/env.js';
import { DB_MEDIA_URL, mediaBucket } from './integrations/db-media.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { csrfProtection, rateLimits, rejectMongoOperators } from './middleware/security.js';
import { adminRoutes } from './routes/admin.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { storeRoutes } from './routes/store.routes.js';
import { handleRazorpayWebhook } from './services/payment.service.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.set('query parser', 'simple'); // no nested objects from query strings

  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req, res) => {
          const id = crypto.randomUUID();
          res.setHeader('X-Request-Id', id);
          return id;
        },
        autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
        serializers: {
          // Tracking/reset tokens are capabilities: never write them to logs.
          req: (req) => ({ id: req.id, method: req.method, url: String(req.url).replace(/([?&](?:token|razorpay_signature)=)[^&]*/gi, '$1[redacted]') }),
          res: (res) => ({ statusCode: res.statusCode }),
        },
      }),
    );
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'", 'https://checkout.razorpay.com'],
          'frame-src': ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
          'connect-src': ["'self'", 'https://api.razorpay.com', 'https://lumberjack.razorpay.com'],
          'img-src': ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com', 'https://*.razorpay.com'],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
          'form-action': ["'self'"],
          'frame-ancestors': ["'none'"],
          'object-src': ["'none'"],
          'upgrade-insecure-requests': isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    }),
  );

  if (corsOrigins.length) {
    app.use(
      '/api',
      cors({
        origin: (origin, cb) => cb(null, !origin || corsOrigins.includes(origin)),
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
        maxAge: 600,
      }),
    );
  }

  app.get('/api/v1/health', async (_req, res) => {
    const db = mongoose.connection.readyState === 1 ? 'up' : 'down';
    res.status(db === 'up' ? 200 : 503).json({ status: db === 'up' ? 'ok' : 'degraded', db });
  });

  // Razorpay webhook: needs the exact raw body for signature verification,
  // and is authenticated by HMAC instead of CSRF/cookies.
  app.post('/api/v1/payments/razorpay/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    const result = await handleRazorpayWebhook(
      Buffer.isBuffer(req.body) ? req.body : undefined,
      req.get('x-razorpay-signature'),
      req.get('x-razorpay-event-id'),
    );
    res.json({ ok: true, ...result });
  });

  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  app.use('/api', rejectMongoOperators);
  app.use('/api', rateLimits.api());
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/v1', csrfProtection);

  app.use('/api/v1/auth', authRoutes());
  app.use('/api/v1/admin', adminRoutes());
  app.use('/api/v1', storeRoutes());
  app.use('/api', notFoundHandler);

  // Product images stored in the database when Cloudinary isn't configured (see integrations/db-media.ts).
  // Each file is immutable (new upload = new id), so it can be cached for a year.
  app.get('/media/:file', async (req, res, next) => {
    const match = DB_MEDIA_URL.exec(`/media/${req.params.file}`);
    if (!match) return next();
    try {
      const id = new mongoose.Types.ObjectId(match[1]);
      const [file] = await mediaBucket().find({ _id: id }).limit(1).toArray();
      if (!file) return res.status(404).end();
      res.setHeader('Content-Type', String(file.metadata?.contentType ?? 'application/octet-stream'));
      res.setHeader('Content-Length', String(file.length));
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.method === 'HEAD') return res.end();
      mediaBucket()
        .openDownloadStream(id)
        .on('error', (err) => {
          logger.warn({ err: err.message }, 'media stream failed');
          if (!res.headersSent) res.status(500);
          res.end();
        })
        .pipe(res);
    } catch (err) {
      next(err);
    }
  });

  if (env.SERVE_CLIENT) {
    // Relative to the server package (server/), so it works whatever directory the host starts Node from.
    const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const dist = path.resolve(serverRoot, env.CLIENT_DIST_DIR);
    const index = path.join(dist, 'index.html');
    if (fs.existsSync(index)) {
      app.use(
        express.static(dist, {
          index: false,
          setHeaders: (res, file) => {
            if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          },
        }),
      );
      app.use((req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(index);
      });
    } else {
      logger.warn(`SERVE_CLIENT is true but ${index} was not found. Run "npm run build" first.`);
    }
  }

  app.use(errorHandler);
  return app;
}

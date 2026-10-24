import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { pinoHttp } from 'pino-http';
import { corsOrigins, env, isProd, isTest } from './config/env.js';
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

  if (env.SERVE_CLIENT) {
    const dist = path.resolve(process.cwd(), env.CLIENT_DIST_DIR);
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

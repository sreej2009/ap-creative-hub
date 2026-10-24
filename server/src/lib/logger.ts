import { pino } from 'pino';
import { env, isProd, isTest } from '../config/env.js';

/**
 * Structured logger. Sensitive fields are redacted so passwords, tokens,
 * cookies and payment signatures never reach log storage.
 */
export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-csrf-token"]',
      'req.headers["x-razorpay-signature"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.razorpay_signature',
      '*.secret',
      '*.apiSecret',
    ],
    censor: '[redacted]',
  },
  ...(isProd || isTest
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
});

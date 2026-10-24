import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { ZodError } from 'zod';
import { AppError, isDuplicateKeyError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { formatIssues } from '../lib/validate.js';

type ErrorBody = { error: { code: string; message: string; details?: unknown; requestId?: string } };

function send(res: Response, req: Request, status: number, body: ErrorBody['error']) {
  res.status(status).json({ error: { ...body, requestId: String(req.id ?? '') || undefined } });
}

export function notFoundHandler(req: Request, res: Response) {
  send(res, req, 404, { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` });
}

// Express recognises error handlers by their four-argument signature.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;

  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err, reqId: req.id }, err.message);
    return send(res, req, err.status, { code: err.code, message: err.message, details: err.details });
  }
  if (err instanceof ZodError) {
    return send(res, req, 400, { code: 'VALIDATION_ERROR', message: 'Some fields are invalid.', details: formatIssues(err) });
  }
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return send(res, req, 413, { code: 'FILE_TOO_LARGE', message: 'Images must be 5 MB or smaller.' });
    return send(res, req, 400, { code: 'UPLOAD_ERROR', message: 'Upload one image file using the "file" field.' });
  }
  const e = err as { type?: string; status?: number };
  if (e?.type === 'entity.parse.failed') return send(res, req, 400, { code: 'INVALID_JSON', message: 'Malformed JSON body.' });
  if (e?.type === 'entity.too.large') return send(res, req, 413, { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' });
  if (err instanceof mongoose.Error.CastError) return send(res, req, 400, { code: 'INVALID_ID', message: 'Invalid identifier.' });
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message]));
    return send(res, req, 400, { code: 'VALIDATION_ERROR', message: 'Some fields are invalid.', details });
  }
  if (isDuplicateKeyError(err)) return send(res, req, 409, { code: 'DUPLICATE', message: 'A record with these details already exists.' });

  logger.error({ err, reqId: req.id }, 'unhandled error');
  return send(res, req, 500, { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Please try again.' });
}

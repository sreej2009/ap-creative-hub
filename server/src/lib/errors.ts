/**
 * Application error with an HTTP status and a stable, machine-readable code.
 * All API errors are serialised as: { error: { code, message, details? } }.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown, code = 'BAD_REQUEST') =>
  new AppError(400, code, message, details);
export const validationError = (details: unknown) =>
  new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', details);
export const unauthorized = (message = 'Please sign in to continue.') =>
  new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission to perform this action.') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (message: string, code = 'CONFLICT', details?: unknown) =>
  new AppError(409, code, message, details);
export const unprocessable = (message: string, code = 'UNPROCESSABLE', details?: unknown) =>
  new AppError(422, code, message, details);
export const tooMany = (message = 'Too many requests. Please try again later.') =>
  new AppError(429, 'RATE_LIMITED', message);
export const serviceUnavailable = (message: string, code = 'SERVICE_UNAVAILABLE') =>
  new AppError(503, code, message);
export const badGateway = (message: string, code = 'UPSTREAM_ERROR') => new AppError(502, code, message);

export function isDuplicateKeyError(err: unknown): err is { code: 11000; keyPattern?: Record<string, unknown>; keyValue?: Record<string, unknown> } {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

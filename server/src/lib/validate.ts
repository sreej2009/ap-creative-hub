import type { Request } from 'express';
import { z } from 'zod';
import { validationError } from './errors.js';

/** Converts Zod issues into a flat { field: message } map for clients. */
export function formatIssues(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw validationError(formatIssues(result.error));
  return result.data;
}

export const parseBody = <S extends z.ZodType>(schema: S, req: Request) => parse(schema, req.body ?? {});
export const parseQuery = <S extends z.ZodType>(schema: S, req: Request) => parse(schema, req.query ?? {});
export const parseParams = <S extends z.ZodType>(schema: S, req: Request) => parse(schema, req.params ?? {});

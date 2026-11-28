import { z } from 'zod';

/** Same rules as the server's passwordField (server/src/schemas/common.ts). */
export const passwordRules = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/[0-9]/, 'Include at least one number');

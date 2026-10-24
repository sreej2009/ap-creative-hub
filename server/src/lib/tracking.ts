import { env } from '../config/env.js';
import { hmac, safeEqual } from './util.js';

/**
 * Non-guessable tracking tokens for guest order links. The token is an
 * HMAC of the order id and a per-order random salt, so it can be
 * regenerated for emails without storing it, and rotated by changing the salt.
 */
export function trackingToken(orderId: string, salt: string): string {
  return hmac(env.APP_SECRET, `track:${orderId}:${salt}`, 'base64url').slice(0, 32);
}

export function verifyTrackingToken(orderId: string, salt: string, token: string | undefined): boolean {
  if (!token || typeof token !== 'string' || token.length !== 32) return false;
  return safeEqual(trackingToken(orderId, salt), token);
}

export function trackingUrl(orderNumber: string, token: string): string {
  return `${env.APP_URL.replace(/\/$/, '')}/track/${encodeURIComponent(orderNumber)}?token=${encodeURIComponent(token)}`;
}

import type { Role } from '../models/User.js';

/**
 * Role-based access control for the admin API. Every admin route declares
 * the permission it needs; the backend enforces it regardless of what the
 * frontend shows.
 */
const ADMIN_ONLY: Role[] = ['admin'];
const STAFF_AND_ADMIN: Role[] = ['staff', 'admin'];

export const PERMISSIONS = {
  'dashboard:read': STAFF_AND_ADMIN,
  'products:read': STAFF_AND_ADMIN,
  'products:write': STAFF_AND_ADMIN,
  'products:delete': ADMIN_ONLY,
  'categories:read': STAFF_AND_ADMIN,
  'categories:write': STAFF_AND_ADMIN,
  'categories:delete': ADMIN_ONLY,
  'media:upload': STAFF_AND_ADMIN,
  'inventory:read': STAFF_AND_ADMIN,
  'inventory:write': STAFF_AND_ADMIN,
  'orders:read': STAFF_AND_ADMIN,
  'orders:write': STAFF_AND_ADMIN,
  'orders:cancel': STAFF_AND_ADMIN,
  'orders:refund': ADMIN_ONLY,
  'orders:export': ADMIN_ONLY,
  'customers:read': STAFF_AND_ADMIN,
  'customers:write': ADMIN_ONLY,
  'coupons:read': STAFF_AND_ADMIN,
  'coupons:write': ADMIN_ONLY,
  'notifications:read': STAFF_AND_ADMIN,
  'messages:read': STAFF_AND_ADMIN,
  'messages:write': STAFF_AND_ADMIN,
  'settings:read': STAFF_AND_ADMIN,
  'settings:write': ADMIN_ONLY,
} as const satisfies Record<string, Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
}

// ============================================================
// SubTick — Control Dashboard authorization helper
// Shared by every callable exposing admin-only capabilities:
// config mutations, preview overrides, score details, feeds.
// ============================================================

import { timingSafeEqual } from 'crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { controlDashboardSecret } from './analytics.js';

interface AuthCheckRequest {
  auth?: unknown;
  data: unknown;
}

/**
 * True when the caller is authenticated AND supplied the current
 * CONTROL_DASHBOARD_SECRET (timing-safe comparison, trimmed exactly like
 * the other protected dashboard callables).
 */
export function isControlDashboardAdmin(request: AuthCheckRequest): boolean {
  if (!request.auth) return false;
  const supplied = (request.data as { dashboard_secret?: unknown })?.dashboard_secret;
  const expected = (controlDashboardSecret.value() || '').trim();
  if (typeof supplied !== 'string' || !expected) return false;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

/** Hard gate: throws unless the caller proves Control Dashboard access. */
export function requireDashboardAdmin(request: AuthCheckRequest): void {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }
  if (!isControlDashboardAdmin(request)) {
    throw new HttpsError('permission-denied', 'A valid Control Dashboard secret is required.');
  }
}
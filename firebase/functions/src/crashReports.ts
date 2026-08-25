// ============================================================
// reportCrash — Receives renderer-crash reports from the app
// Writes one bounded document into the top-level `crash_reports`
// collection. Authenticated callers only; per-user daily cap.
// ============================================================

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './firebaseAdmin.js';

const DAILY_CAP_PER_USER = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value.slice(0, max);
}

export const reportCrash = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign-in required.');
  }
  const uid = request.auth.uid;

  const data = (request.data ?? {}) as Record<string, unknown>;
  const message = boundedString(data.message, 500);
  if (!message) {
    throw new HttpsError('invalid-argument', 'A non-empty message is required.');
  }

  // Per-user daily cap so a crash loop cannot spam writes.
  const since = Date.now() - DAY_MS;
  const recent = await db
    .collection('crash_reports')
    .where('userId', '==', uid)
    .where('reportedAt', '>', since)
    .count()
    .get();
  if ((recent.data().count ?? 0) >= DAILY_CAP_PER_USER) {
    return { ok: false, throttled: true };
  }

  await db.collection('crash_reports').add({
    userId: uid,
    message,
    stack: boundedString(data.stack, 4000),
    componentStack: boundedString(data.componentStack, 2000),
    screen: boundedString(data.screen, 100),
    platform: boundedString(data.platform, 20),
    appVersion: boundedString(data.appVersion, 40),
    reportedAt: FieldValue.serverTimestamp(),
  });

  return { ok: true };
});

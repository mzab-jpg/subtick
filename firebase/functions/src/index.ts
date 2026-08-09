// ============================================================
// SubTick - Cloud Functions Entry Point
// Initializes Firebase Admin SDK and exports all 10 functions.
// ============================================================

import * as admin from 'firebase-admin';

// Initialize Firebase Admin (singleton)
admin.initializeApp();

const db = admin.firestore();
const auth = admin.auth();

import { gaApiSecret, sendGAEvents } from './analytics.js';
import {
  loadScoringConfig,
  DEFAULT_SCORING_CONFIG,
  deepMerge,
  clampConfig,
  invalidateConfigCache,
} from './scoringConfig.js';

// --- Export all Cloud Functions ---
export { rssCollector } from './rssCollector.js';
export { getRankedFeed, cronUpdateCandidatePool, cronDecayTrendingScores, cronCleanupOldArticles } from './getRankedFeed.js';
export { syncBehaviorEvents } from './syncBehaviorEvents.js';
// weightUpdater is an internal helper, not exported as a Cloud Function directly,
// but is called by syncBehaviorEvents.

// ============================================================
// resetAccount — Deletes all user data and resets profile to defaults
// ============================================================
import { onCall } from 'firebase-functions/v2/https';
import { HttpsError } from 'firebase-functions/v2/https';

export const resetAccount = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to reset your account.');
  }

  const uid = request.auth.uid;

  // Delete all behavior events
  const behaviorEvents = await db.collection(`users/${uid}/behavior_events`).get();
  const batch1 = db.batch();
  behaviorEvents.docs.forEach((doc) => batch1.delete(doc.ref));
  await batch1.commit();

  // Delete all saved articles
  const savedArticles = await db.collection(`users/${uid}/saved_articles`).get();
  const batch2 = db.batch();
  savedArticles.docs.forEach((doc) => batch2.delete(doc.ref));
  await batch2.commit();

  // Reset profile to defaults (keep userId, isOnboarded, themePreference, dashboardMetricIds)
  const defaultCategoryWeights: Record<string, number> = {};
  const CATEGORIES = ['Politics', 'Business', 'Finance', 'Technology', 'Science', 'History', 'Culture', 'Lifestyle', 'Entertainment'];
  CATEGORIES.forEach((cat) => { defaultCategoryWeights[cat] = 1.0; });

  await db.doc(`users/${uid}`).update({
    // Reset personalization weights
    categoryWeights: defaultCategoryWeights,
    categoryLengthWeights: admin.firestore.FieldValue.delete(),
    publisherWeights: admin.firestore.FieldValue.delete(),
    weightUpdatedAt: admin.firestore.FieldValue.delete(),
    // Reset category selections — forces re-onboarding
    isOnboarded: false,
    selectedCategoryIds: [],
    notInterestedCategoryIds: [],
    // Reset reading stats
    totalArticlesRead: 0,
    weeklyReadCount: 0,
    currentStreakDays: 0,
    lastReadDate: 0,
    averageWpm: 200,
    totalReadTimeMs: 0,
    seenArticleIds: [],
    lastUpdated: Date.now(),
  });

  return { success: true, message: 'Account data has been reset.' };
});

// ============================================================
// deleteAccount — Permanently deletes all user data and auth account
// ============================================================
export const deleteAccount = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to delete your account.');
  }

  const uid = request.auth.uid;

  // Require confirmation string to prevent accidental calls
  const { confirmation } = request.data;
  if (confirmation !== 'DELETE') {
    throw new HttpsError('invalid-argument', 'Must provide confirmation: "DELETE".');
  }

  // Delete all behavior events
  const behaviorEvents = await db.collection(`users/${uid}/behavior_events`).get();
  const batch1 = db.batch();
  behaviorEvents.docs.forEach((doc) => batch1.delete(doc.ref));
  await batch1.commit();

  // Delete all saved articles
  const savedArticles = await db.collection(`users/${uid}/saved_articles`).get();
  const batch2 = db.batch();
  savedArticles.docs.forEach((doc) => batch2.delete(doc.ref));
  await batch2.commit();

  // Delete the user profile document
  await db.doc(`users/${uid}`).delete();

  // Delete the Firebase Auth account (revokes all sessions)
  await auth.deleteUser(uid);

  return { success: true, message: 'Account has been permanently deleted.' };
});

// ============================================================
// deleteOrphanProfile — Deletes an orphan anonymous Firestore
// profile after the user signs in with a Google-linked account.
// Security rules forbid client-side deletes, so we use the
// Admin SDK to bypass rules and clean up stale documents.
// ============================================================
export const deleteOrphanProfile = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }

  const { orphanUid } = request.data;
  if (!orphanUid || typeof orphanUid !== 'string') {
    throw new HttpsError('invalid-argument', 'Missing or invalid orphanUid.');
  }

  // Safety: never allow deleting the caller's own profile
  if (orphanUid === request.auth.uid) {
    throw new HttpsError('invalid-argument', 'Cannot delete your own profile.');
  }

  try {
    await db.doc(`users/${orphanUid}`).delete();
    console.log(`[deleteOrphanProfile] Deleted orphan profile: ${orphanUid}`);
    return { success: true, deleted: orphanUid };
  } catch (error: any) {
    console.error(`[deleteOrphanProfile] Failed to delete ${orphanUid}:`, error);
    // If the doc doesn't exist, that's fine — treat as success
    if (error.code === 5) {
      return { success: true, deleted: orphanUid, alreadyGone: true };
    }
    throw new HttpsError('internal', 'Failed to delete orphan profile.');
  }
});

// ============================================================
// updateScoringConfig — Updates system/scoringConfig and logs
// a config_changed analytics event so before/after algorithm
// changes are always comparable.
// ============================================================
export const updateScoringConfig = onCall({ secrets: [gaApiSecret] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }

  const adminUserId = request.auth.uid;
  const data = request.data as {
    config?: Record<string, any>;
    field?: string;
    old_value?: number | string;
    new_value?: number | string;
    client_id?: string;
  };
  // GA4 web-stream client_id (32-hex UUID from device). Never the Auth UID.
  const clientId = data.client_id || '';

  const docRef = db.collection('system').doc('scoringConfig');
  const docSnap = await docRef.get();
  const previous = ((docSnap.exists ? docSnap.data() : {}) || {}) as Record<string, any>;

  // --- Full-object mode (Control Dashboard): pass a partial config object. ---
  if (data.config && typeof data.config === 'object') {
    if (Object.keys(data.config).length === 0) {
      throw new HttpsError('invalid-argument', 'config object is empty.');
    }
    const merged = clampConfig(deepMerge({ ...previous }, data.config));
    // Overwrite the stored doc with the clamped merged config. It always contains
    // a full self-describing object (defaults for every key not supplied).
    await docRef.set({ ...merged, lastUpdated: Date.now(), lastUpdatedBy: adminUserId }, { merge: false });

    const changes = diffConfig(previous, merged);
    if (changes.length > 0) {
      sendGAEvents(clientId, changes.map(({ field, oldV, newV }) => ({
        name: 'config_changed',
        params: { user_id: adminUserId, field, old_value: String(oldV), new_value: String(newV) },
      }))).catch(() => {});
    }
    console.log(`[updateScoringConfig] ${adminUserId} applied config update (${changes.length} leaf changes)`);
    invalidateConfigCache();

    return {
      success: true,
      applied: true,
      leafChanges: changes.length,
      changed: changes.map((c) => c.field),
      lastUpdated: Date.now(),
    };
  }

  // --- Legacy single-field mode ---
  const { field, old_value, new_value } = data;
  if (!field || typeof field !== 'string') {
    throw new HttpsError('invalid-argument', 'Missing or invalid field.');
  }
  if (typeof old_value !== 'number' && typeof old_value !== 'string') {
    throw new HttpsError('invalid-argument', 'Missing or invalid old_value.');
  }
  if (typeof new_value !== 'number' && typeof new_value !== 'string') {
    throw new HttpsError('invalid-argument', 'Missing or invalid new_value.');
  }

  await docRef.set({ [field]: new_value, lastUpdated: Date.now(), lastUpdatedBy: adminUserId }, { merge: true });
  sendGAEvents(clientId, [
    {
      name: 'config_changed',
      params: {
        user_id: adminUserId,
        field,
        old_value: old_value.toString(),
        new_value: new_value.toString(),
      },
    },
  ]).catch(() => {});
  console.log(`[updateScoringConfig] ${adminUserId} changed ${field}: ${old_value} → ${new_value}`);
  invalidateConfigCache();

  return { success: true, field, old_value: old_value.toString(), new_value: new_value.toString() };
});

// ============================================================
// getScoringConfig — Returns the current effective config (what the
// algorithm ACTUALLY uses right now) + the stored doc + defaults,
// so the dashboard, Firebase console, and live app always agree.
// ============================================================
export const getScoringConfig = onCall({ secrets: [gaApiSecret] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }

  const effective = await loadScoringConfig();
  const snap = await db.collection('system').doc('scoringConfig').get();
  const stored = snap.exists ? (snap.data() as Record<string, any>) : null;

  return {
    config: effective,
    defaults: DEFAULT_SCORING_CONFIG,
    stored,
    source: stored ? 'firestore' : 'defaults',
    updatedAt: stored?.lastUpdated ?? null,
    updatedBy: stored?.lastUpdatedBy ?? null,
  };
});

/** Flatten two objects and return the leaf-level differences (for audit). */
function diffConfig(prev: any, next: any): Array<{ field: string; oldV: any; newV: any }> {
  const out: Array<{ field: string; oldV: any; newV: any }> = [];
  const walk = (a: any, b: any, path: string) => {
    if (a === b) return;
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) walk(a[k], b[k], path ? `${path}.${k}` : k);
      return;
    }
    out.push({ field: path, oldV: a, newV: b });
  };
  walk(prev, next, '');
  return out;
}
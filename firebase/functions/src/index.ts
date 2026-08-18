// ============================================================
// SubTick - Cloud Functions Entry Point
// Initializes Firebase Admin SDK and exports all 14 functions.
// ============================================================

import * as admin from 'firebase-admin';
import { db, auth } from './firebaseAdmin.js';
import { timingSafeEqual } from 'crypto';
import Parser from 'rss-parser';
import { collectRssFeeds } from './rssCollector.js';
import { FeedSource } from './types.js';
import { normalizeFeedUrl } from './feedValidation.js';

import { controlDashboardSecret, gaApiSecret, sendGAEvents } from './analytics.js';
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

const DASHBOARD_CATEGORIES = new Set([
  'Politics', 'Business', 'Finance', 'Technology', 'Science',
  'History', 'Culture', 'Lifestyle', 'Entertainment',
]);

function requireDashboardAdmin(request: { auth?: unknown; data: unknown }): void {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }
  const supplied = (request.data as { dashboard_secret?: unknown })?.dashboard_secret;
  const expected = (controlDashboardSecret.value() || '').trim();
  if (typeof supplied !== 'string' || !expected) {
    throw new HttpsError('permission-denied', 'A valid Control Dashboard secret is required.');
  }
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
    throw new HttpsError('permission-denied', 'A valid Control Dashboard secret is required.');
  }
}

function feedDocumentId(publicationName: string): string {
  const slug = publicationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) throw new HttpsError('invalid-argument', 'Publication name must contain letters or numbers.');
  return `feed_${slug.slice(0, 120)}`;
}

const DELETE_BATCH_SIZE = 400;

/**
 * Delete every document in one known user subcollection without exceeding
 * Firestore's 500-operation batch limit. Each committed page is safe to retry.
 */
async function deleteUserSubcollection(uid: string, subcollection: string): Promise<number> {
  const collectionRef = db.collection('users').doc(uid).collection(subcollection);
  let deleted = 0;

  while (true) {
    const snapshot = await collectionRef.limit(DELETE_BATCH_SIZE).get();
    if (snapshot.empty) return deleted;

    const batch = db.batch();
    snapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
    deleted += snapshot.size;
  }
}

export const resetAccount = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to reset your account.');
  }

  const uid = request.auth.uid;

  // Delete user-owned subcollections in bounded batches. A long-term reader can
  // easily exceed Firestore's 500-operation limit in behavior_events.
  await deleteUserSubcollection(uid, 'behavior_events');
  await deleteUserSubcollection(uid, 'saved_articles');

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
    weightsDecayedAt: admin.firestore.FieldValue.delete(),
    quickExitCategorySignals: admin.firestore.FieldValue.delete(),
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

  // Delete known user-owned subcollections in bounded batches before removing
  // the profile and Auth account. This remains safe if a request must be retried.
  await deleteUserSubcollection(uid, 'behavior_events');
  await deleteUserSubcollection(uid, 'saved_articles');

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
// Preview config slot — private staging area for the Control
// Dashboard → High-Fidelity Matrix workflow.
//
// The dashboard "Send to simulator" button writes an edited
// config HERE (system/previewConfig) instead of publishing to
// system/scoringConfig. The matrix can then opt to test live
// config OR this preview — nothing here ever touches the live
// algorithm. A new export simply overwrites the slot.
// ============================================================
export const setPreviewConfig = onCall({ secrets: [controlDashboardSecret] }, async (request) => {
  requireDashboardAdmin(request);
  const data = request.data as { config?: Record<string, any>; dashboard_secret?: string };
  if (!data.config || typeof data.config !== 'object' || Object.keys(data.config).length === 0) {
    throw new HttpsError('invalid-argument', 'config object is required.');
  }
  const clamped = clampConfig(deepMerge({}, data.config) as any);
  await db.collection('system').doc('previewConfig').set({
    config: { ...clamped },
    lastUpdated: Date.now(),
    lastUpdatedBy: request.auth!.uid,
  }, { merge: false });
  console.log(`[setPreviewConfig] ${request.auth!.uid} stored preview config for simulator testing`);
  return { success: true, lastUpdated: Date.now() };
});

export const getPreviewConfig = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }
  const snap = await db.collection('system').doc('previewConfig').get();
  if (!snap.exists) {
    return { config: null, source: 'none' };
  }
  const d = snap.data() as Record<string, any>;
  return {
    config: d?.config ?? null,
    source: 'preview',
    updatedAt: d?.lastUpdated ?? null,
    updatedBy: d?.lastUpdatedBy ?? null,
  };
});

// ============================================================
// updateScoringConfig — Updates system/scoringConfig and logs
// a config_changed analytics event so before/after algorithm
// changes are always comparable.
// ============================================================
export const updateScoringConfig = onCall({ secrets: [gaApiSecret, controlDashboardSecret] }, async (request) => {
  requireDashboardAdmin(request);

  const adminUserId = request.auth!.uid;
  const data = request.data as {
    config?: Record<string, any>;
    field?: string;
    old_value?: number | string;
    new_value?: number | string;
    client_id?: string;
    dashboard_secret?: string;
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
// addRssFeed — Protected Control Dashboard action. Validates and stores a
// feed, then collects it immediately through the same path as the 3-hour job.
// ============================================================
export const addRssFeed = onCall({ secrets: [controlDashboardSecret] }, async (request) => {
  requireDashboardAdmin(request);
  const data = request.data as {
    dashboard_secret?: string;
    url?: unknown;
    publicationName?: unknown;
    category?: unknown;
    qualityScore?: unknown;
    forceArchived?: unknown;
  };
  if (typeof data.url !== 'string' || typeof data.publicationName !== 'string' || typeof data.category !== 'string') {
    throw new HttpsError('invalid-argument', 'Feed URL, publication name, and category are required.');
  }

  let url: string;
  try {
    url = normalizeFeedUrl(data.url);
  } catch (error: any) {
    throw new HttpsError('invalid-argument', error.message);
  }
  const publicationName = data.publicationName.trim();
  const category = data.category.trim();
  if (!publicationName || publicationName.length > 100) {
    throw new HttpsError('invalid-argument', 'Publication name must be 1–100 characters.');
  }
  if (!DASHBOARD_CATEGORIES.has(category)) {
    throw new HttpsError('invalid-argument', 'Choose a valid Tangent category.');
  }
  const rawQuality = typeof data.qualityScore === 'number' ? data.qualityScore : 0.8;
  if (!Number.isFinite(rawQuality) || rawQuality < 0.2 || rawQuality > 1) {
    throw new HttpsError('invalid-argument', 'Starting quality must be between 0.20 and 1.00.');
  }

  const parser = new Parser({ timeout: 15_000, headers: { 'User-Agent': 'Tangent/1.0 RSS Validator' } });
  let parsed: Parser.Output<any>;
  try {
    parsed = await parser.parseURL(url);
  } catch {
    throw new HttpsError('invalid-argument', 'Could not retrieve a valid RSS or Atom feed at that URL.');
  }
  if (!parsed.items || parsed.items.length === 0) {
    throw new HttpsError('invalid-argument', 'The feed is valid but currently contains no items.');
  }

  const existingFeeds = await db.collection('feeds').get();
  const normalizedName = publicationName.toLocaleLowerCase();
  const duplicate = existingFeeds.docs.find((snap) => {
    const feed = snap.data() as FeedSource;
    try {
      return normalizeFeedUrl(feed.url) === url || feed.publicationName.trim().toLocaleLowerCase() === normalizedName;
    } catch {
      return feed.publicationName.trim().toLocaleLowerCase() === normalizedName;
    }
  });
  if (duplicate) {
    throw new HttpsError('already-exists', `This feed already exists as “${duplicate.data().publicationName}”.`);
  }

  const feed: FeedSource = {
    url,
    publicationName,
    category,
    qualityScore: rawQuality,
    isActive: true,
    forceArchived: data.forceArchived === true,
  };
  const feedId = feedDocumentId(publicationName);
  await db.collection('feeds').doc(feedId).create({ ...feed, id: feedId, addedAt: Date.now(), addedBy: request.auth!.uid });

  const collection = await collectRssFeeds([feed]);
  return { success: true, feedId, publicationName, collected: collection.totalNew, collectionErrors: collection.totalErrors };
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

  invalidateConfigCache();  // always fetch fresh from Firestore
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
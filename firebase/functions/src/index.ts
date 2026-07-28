// ============================================================
// SubTick - Cloud Functions Entry Point
// Initializes Firebase Admin SDK and exports all 9 functions.
// ============================================================

import * as admin from 'firebase-admin';

// Initialize Firebase Admin (singleton)
admin.initializeApp();

const db = admin.firestore();
const auth = admin.auth();

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
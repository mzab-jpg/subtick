// ============================================================
// SubTick - Cloud Functions Entry Point
// Initializes Firebase Admin SDK and exports all 7 functions.
// ============================================================

import * as admin from 'firebase-admin';

// Initialize Firebase Admin (singleton)
admin.initializeApp();

// --- Export all Cloud Functions ---
export { rssCollector } from './rssCollector.js';
export { getRankedFeed, cronUpdateCandidatePool } from './getRankedFeed.js';
export { syncBehaviorEvents } from './syncBehaviorEvents.js';
// weightUpdater is an internal helper, not exported as a Cloud Function directly,
// but is called by syncBehaviorEvents.
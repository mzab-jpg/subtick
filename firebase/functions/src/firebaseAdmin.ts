// ============================================================
// SubTick — Firebase Admin singleton
// Ensures every Cloud Functions module can safely use Firestore/Auth
// regardless of the order Node.js loads imports during deployment.
// ============================================================

import * as admin from 'firebase-admin';

if (admin.apps.length === 0) {
  admin.initializeApp();
}

export const db = admin.firestore();
export const auth = admin.auth();

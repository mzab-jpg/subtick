//
// Usage (run once from the firebase/scripts/oneoff/ directory):
//   node resetPublisherQualities.js
//
// Resets all publisher qualityScore fields back to 0.80 (neutral).
// Safe to re-run — idempotent. Does NOT delete any documents.
//
// Requires ADC: `gcloud auth application-default login`

// firebase-admin lives in firebase/functions/node_modules/ — two levels up from this script
const admin = require('../../functions/node_modules/firebase-admin');

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'subtick-bbd55',
});

const db = admin.firestore();

async function main() {
  console.log('[resetPublisherQualities] Fetching all publishers...');

  const snap = await db.collection('publishers').get();

  if (snap.empty) {
    console.log('[resetPublisherQualities] No publisher documents found. Nothing to reset.');
    return;
  }

  const BATCH_SIZE = 500;
  const docs = snap.docs;
  let updated = 0;

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + BATCH_SIZE);
    chunk.forEach((doc) => {
      batch.update(doc.ref, {
        qualityScore: 0.80,
        lastUpdated: Date.now(),
      });
      updated++;
    });
    await batch.commit();
    console.log(`[resetPublisherQualities] Committed batch ${Math.floor(i / BATCH_SIZE) + 1}: ${chunk.length} publishers`);
  }

  console.log(`[resetPublisherQualities] Done. Reset ${updated} publishers to qualityScore 0.80.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[resetPublisherQualities] Reset failed:', err);
  process.exit(1);
});
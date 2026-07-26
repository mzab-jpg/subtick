//
// Usage (run once from the firebase/functions/ directory):
//   node backfillRandomScore.js
//
// Assigns a random_score field (uniformly distributed [0,1)) to every article
// that does not already have one. Safe to re-run.

const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'subtick-bbd55',
});

const db = admin.firestore();

async function backfillRandomScores() {
  console.log('[backfill] Fetching all articles...');

  const snapshot = await db.collection('articles').get();

  const toUpdate = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.random_score === undefined || data.random_score === null) {
      toUpdate.push(doc.ref);
    }
  });

  const alreadyDone = snapshot.size - toUpdate.length;
  console.log('[backfill] Total articles: ' + snapshot.size);
  console.log('[backfill] Already have random_score: ' + alreadyDone);
  console.log('[backfill] Need backfill: ' + toUpdate.length);

  if (toUpdate.length === 0) {
    console.log('[backfill] Nothing to do.');
    process.exit(0);
  }

  const BATCH_SIZE = 500;
  let updated = 0;

  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = toUpdate.slice(i, i + BATCH_SIZE);
    chunk.forEach(ref => {
      batch.update(ref, { random_score: Math.random() });
    });
    await batch.commit();
    updated += chunk.length;
    console.log('[backfill] Progress: ' + updated + ' / ' + toUpdate.length);
  }

  console.log('[backfill] Done. Assigned random_score to ' + updated + ' articles.');
  process.exit(0);
}

backfillRandomScores().catch(err => {
  console.error('[backfill] Fatal error:', err);
  process.exit(1);
});
// One-off backfill: stamps the isFresh sticker on every article missing it.
// Run ONCE after deploying the isFresh changes:
//   node scripts/oneoff/backfillIsFresh.js
// Uses the same auth pattern as the other oneoff scripts (application default
// credentials, or set GOOGLE_APPLICATION_CREDENTIALS to a service account key).
const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'subtick-bbd55',
});

const db = admin.firestore();
const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000;

async function main() {
  console.log('[backfillIsFresh] Starting...');
  let stamped = 0;
  let cursor = null;
  while (true) {
    let q = db.collection('articles').orderBy(admin.firestore.FieldPath.documentId()).limit(400);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.forEach(function (doc) {
      const data = doc.data();
      if (data.isFresh === undefined) {
        const age = Date.now() - (data.publishDate || 0);
        batch.update(doc.ref, { isFresh: age < FOUR_WEEKS_MS });
        stamped++;
      }
    });
    await batch.commit();
    cursor = snap.docs[snap.docs.length - 1];
    console.log('[backfillIsFresh] Progress: ' + stamped + ' articles stamped...');
    if (snap.size < 400) break;
  }
  console.log('[backfillIsFresh] Done. Stamped isFresh on ' + stamped + ' articles.');
  process.exit(0);
}

main().catch(function (err) { console.error('[backfillIsFresh] Failed:', err); process.exit(1); });
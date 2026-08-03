//
// Usage (run once from the firebase/scripts/oneoff/ directory):
//   node resetTrendingScores.js
//
// Sets trendingScore and peakTrendingScore to 0 on every article.
// Safe to re-run — idempotent. Does NOT touch qualityScore or random_score.
//
// Also resets the publishers collection: all qualityScore fields back to 0.8
// (the DEFAULT_PUBLISHER_QUALITY in syncBehaviorEvents), preserving name only.

// firebase-admin lives in firebase/functions/node_modules/ — two levels up from this script
const admin = require('../../functions/node_modules/firebase-admin');

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'subtick-bbd55',
});

const db = admin.firestore();

async function resetTrendingScores() {
  console.log('[resetTrending] Fetching all articles...');

  const articlesSnap = await db.collection('articles').get();

  if (articlesSnap.empty) {
    console.log('[resetTrending] No articles found. Nothing to do.');
  } else {
    const BATCH_SIZE = 500;
    const docs = articlesSnap.docs;
    let updated = 0;

    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const chunk = docs.slice(i, i + BATCH_SIZE);
      chunk.forEach(doc => {
        batch.update(doc.ref, {
          trendingScore: 0,
          peakTrendingScore: 0,
        });
      });
      await batch.commit();
      updated += chunk.length;
      console.log(`[resetTrending] Articles progress: ${updated} / ${docs.length}`);
    }

    console.log(`[resetTrending] Reset trending scores on ${updated} articles.`);
  }

  // Reset publisher quality scores back to 0.80
  console.log('[resetTrending] Resetting publisher quality scores...');

  const publishersSnap = await db.collection('publishers').get();

  if (publishersSnap.empty) {
    console.log('[resetTrending] No publishers found. Nothing to do for publishers.');
  } else {
    const PUB_BATCH_SIZE = 500;
    const pubDocs = publishersSnap.docs;
    let pubUpdated = 0;

    for (let i = 0; i < pubDocs.length; i += PUB_BATCH_SIZE) {
      const batch = db.batch();
      const chunk = pubDocs.slice(i, i + PUB_BATCH_SIZE);
      chunk.forEach(doc => {
        batch.update(doc.ref, {
          qualityScore: 0.80,
          lastUpdated: Date.now(),
        });
      });
      await batch.commit();
      pubUpdated += chunk.length;
      console.log(`[resetTrending] Publishers progress: ${pubUpdated} / ${pubDocs.length}`);
    }

    console.log(`[resetTrending] Reset quality scores on ${pubUpdated} publishers to 0.80.`);
  }

  console.log('[resetTrending] Done. All trending scores at 0, all publishers at 0.80.');
  process.exit(0);
}

resetTrendingScores().catch(err => {
  console.error('[resetTrending] Fatal error:', err);
  process.exit(1);
});
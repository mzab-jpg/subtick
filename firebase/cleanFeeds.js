/**
 * ============================================================
 * SubTick — cleanFeeds.js
 * Automatically deletes legacy, cryptic hashed feed IDs from Firestore,
 * leaving only the clean slug-based ones.
 *
 * Usage:
 *   cd firebase
 *   node cleanFeeds.js
 * ============================================================
 */

const admin = require('./functions/node_modules/firebase-admin');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const SUBSTACK_FEEDS = require('./feeds.json');

let db;

try {
  const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');

  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('[Clean Feeds] Initialized with service account key');
  } else {
    admin.initializeApp({
      projectId: 'subtick-bbd55',
    });
    console.log('[Clean Feeds] Initialized with application default credentials');
  }
  db = admin.firestore();

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    db.settings({
      host: `${host}:${port}`,
      ssl: false,
    });
    console.log(`[Clean Feeds] Connected to Firestore emulator at ${host}:${port}`);
  }
} catch (error) {
  console.error('[Clean Feeds] Failed to initialize Firebase:', error.message);
  process.exit(1);
}

function generateFeedId(publicationName) {
  return publicationName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function cleanFeeds() {
  console.log('[Clean Feeds] Scanning Firestore "feeds" collection for duplicates...');
  console.log('========================================================================');

  // Compute the exact clean slug-based IDs we want to preserve
  const expectedIds = new Set(
    SUBSTACK_FEEDS.map(feed => `feed_${generateFeedId(feed.publicationName)}`)
  );

  try {
    const feedsSnap = await db.collection('feeds').get();
    let totalDeleted = 0;

    const batch = db.batch();

    for (const doc of feedsSnap.docs) {
      if (!expectedIds.has(doc.id)) {
        console.log(`  🗑️  Legacy hash ID identified for deletion: ${doc.id} (${doc.data().publicationName || 'Unknown'})`);
        batch.delete(doc.ref);
        totalDeleted++;
      } else {
        console.log(`  ✅ Clean slug ID preserved: ${doc.id}`);
      }
    }

    if (totalDeleted > 0) {
      await batch.commit();
      console.log('========================================================================');
      console.log(`[Clean Feeds] Success! Successfully deleted ${totalDeleted} legacy hashed feed documents.`);
    } else {
      console.log('========================================================================');
      console.log('[Clean Feeds] Your database is already 100% clean and free of legacy duplicates.');
    }
  } catch (err) {
    console.error('❌ Error cleaning feeds:', err.message);
  }

  process.exit(0);
}

cleanFeeds().catch((error) => {
  console.error('[Clean Feeds] Fatal error:', error);
  process.exit(1);
});

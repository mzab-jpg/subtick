/**
 * ============================================================
 * SubTick — seedFeeds.js
 * Seeds the Firestore 'feeds' collection with the 35 initial feeds.
 *
 * Usage:
 *   cd firebase
 *   node seedFeeds.js
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
    console.log('[Seed Feeds] Initialized with service account key');
  } else {
    admin.initializeApp({
      projectId: 'subtick-bbd55',
    });
    console.log('[Seed Feeds] Initialized with application default credentials');
  }
  db = admin.firestore();

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    db.settings({
      host: `${host}:${port}`,
      ssl: false,
    });
    console.log(`[Seed Feeds] Connected to Firestore emulator at ${host}:${port}`);
  }
} catch (error) {
  console.error('[Seed Feeds] Failed to initialize Firebase:', error.message);
  process.exit(1);
}

function generateFeedId(publicationName) {
  return publicationName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function seedFeeds() {
  console.log(`[Seed Feeds] Seeding ${SUBSTACK_FEEDS.length} publications into Firestore 'feeds' collection...`);
  console.log('========================================================================');

  let totalCreated = 0;
  let totalUpdated = 0;
  let totalErrors = 0;

  for (const feed of SUBSTACK_FEEDS) {
    try {
      const feedId = `feed_${generateFeedId(feed.publicationName)}`;
      const feedRef = db.collection('feeds').doc(feedId);
      
      const existing = await feedRef.get();
      
      const feedData = {
        id: feedId,
        url: feed.url,
        category: feed.category,
        publicationName: feed.publicationName,
        qualityScore: feed.qualityScore,
        isActive: true, // Default enabled
        forceArchived: false, // Default standard full-content view
      };

      if (existing.exists) {
        // Merge so we don't overwrite user changes to isActive or forceArchived if they already configured them
        await feedRef.set(feedData, { merge: true });
        totalUpdated++;
        console.log(`  🔄 Updated (Merged): ${feed.publicationName}`);
      } else {
        await feedRef.set(feedData);
        totalCreated++;
        console.log(`  ✅ Created: ${feed.publicationName}`);
      }
    } catch (err) {
      totalErrors++;
      console.error(`  ❌ Error seeding feed ${feed.publicationName}:`, err.message);
    }
  }

  console.log('========================================================================');
  console.log('[Seed Feeds] Done!');
  console.log(`  Created: ${totalCreated}`);
  console.log(`  Updated/Merged: ${totalUpdated}`);
  console.log(`  Errors: ${totalErrors}`);
  console.log('========================================================================');
  process.exit(0);
}

seedFeeds().catch((error) => {
  console.error('[Seed Feeds] Fatal error:', error);
  process.exit(1);
});

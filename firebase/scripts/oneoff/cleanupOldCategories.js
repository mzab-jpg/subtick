/**
 * ============================================================
 * SubTick — cleanupOldCategories.js
 *
 * ONE-TIME CLEANUP SCRIPT (July 2026)
 *
 * After migrating from 6 legacy categories to 9 new categories,
 * this script removes old-category articles and prunes stale
 * category weights from user profiles.
 *
 * Old categories being removed:
 *   "Technology & Innovation", "Business & Finance",
 *   "Politics & Global Affairs", "Arts & Culture",
 *   "Science & Health", "Philosophy & Human Behavior"
 *
 * New categories:
 *   "Politics", "Business", "Finance", "Technology",
 *   "Science", "History", "Culture", "Lifestyle", "Entertainment"
 *
 * ⚠️ WARNING: This deletes Firestore documents. Do not re-run
 *    after new articles with correct categories have been
 *    ingested.
 *
 * Usage:
 *   cd firebase
 *   export GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json
 *   node scripts/oneoff/cleanupOldCategories.js
 * ============================================================
 */

const path = require('path');
const fs = require('fs');

// firebase-admin is installed in functions/ directory
const admin = require(path.join(__dirname, '..', '..', 'functions', 'node_modules', 'firebase-admin'));

const OLD_CATEGORIES = [
  'Technology & Innovation',
  'Business & Finance',
  'Politics & Global Affairs',
  'Arts & Culture',
  'Science & Health',
  'Philosophy & Human Behavior',
];

const NEW_CATEGORIES = [
  'Politics',
  'Business',
  'Finance',
  'Technology',
  'Science',
  'History',
  'Culture',
  'Lifestyle',
  'Entertainment',
];

let db;

try {
  const serviceAccountPath = path.join(__dirname, '..', '..', 'serviceAccountKey.json');
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log('[Cleanup] Initialized with service account key');
  } else {
    admin.initializeApp({ projectId: 'subtick-bbd55' });
    console.log('[Cleanup] Initialized with default credentials');
  }

  db = admin.firestore();

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    db.settings({ host: `${host}:${port}`, ssl: false });
    console.log(`[Cleanup] Connected to Firestore emulator at ${host}:${port}`);
  }
} catch (error) {
  console.error('[Cleanup] Failed to initialize Firebase:', error.message);
  process.exit(1);
}

async function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function deleteOldArticles() {
  console.log('='.repeat(80));
  console.log('[Cleanup] STEP 1: Deleting articles with old category strings...');
  console.log('='.repeat(80));

  let totalDeleted = 0;

  for (const oldCat of OLD_CATEGORIES) {
    console.log(`  Querying articles with category "${oldCat}"...`);
    let batchDeleted = 0;

    // Query in pages of 500 (Firestore batch limit)
    let lastDoc = null;
    let hasMore = true;

    while (hasMore) {
      let query = db
        .collection('articles')
        .where('category', '==', oldCat)
        .limit(500);

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snapshot = await query.get();

      if (snapshot.empty) {
        hasMore = false;
        break;
      }

      // Delete in batches of 500
      const chunkedDocs = await chunkArray(snapshot.docs, 500);
      for (const chunk of chunkedDocs) {
        const batch = db.batch();
        for (const doc of chunk) {
          batch.delete(doc.ref);
        }
        await batch.commit();
        batchDeleted += chunk.length;
        console.log(`    Deleted ${chunk.length} articles (total: ${batchDeleted})`);
      }

      lastDoc = snapshot.docs[snapshot.docs.length - 1];
    }

    totalDeleted += batchDeleted;
    console.log(`  ✅ Category "${oldCat}": ${batchDeleted} articles deleted`);
  }

  console.log(`\n  ✅ TOTAL: ${totalDeleted} old-category articles deleted`);
  return totalDeleted;
}

async function cleanupCandidatePools() {
  console.log('\n' + '='.repeat(80));
  console.log('[Cleanup] STEP 2: Cleaning up candidate pool documents...');
  console.log('='.repeat(80));

  const poolIds = ['candidatePool_current', 'candidatePool_mixed'];

  for (const poolId of poolIds) {
    const poolRef = db.collection('system').doc(poolId);
    const poolDoc = await poolRef.get();

    if (!poolDoc.exists) {
      console.log(`  Skipping "${poolId}" — document does not exist`);
      continue;
    }

    const data = poolDoc.data();
    const articles = data.articles || [];

    if (articles.length === 0) {
      console.log(`  Skipping "${poolId}" — no articles to filter`);
      continue;
    }

    // Filter out articles with old categories
    const filtered = articles.filter(
      (a) => a.category && !OLD_CATEGORIES.includes(a.category)
    );

    const removed = articles.length - filtered.length;
    console.log(`  "${poolId}": ${articles.length} → ${filtered.length} articles (removed ${removed} old-category)`);

    if (removed > 0) {
      await poolRef.update({ articles: filtered });
      console.log(`  ✅ Updated "${poolId}"`);
    }
  }
}

async function cleanupUserWeights() {
  console.log('\n' + '='.repeat(80));
  console.log('[Cleanup] STEP 3: Stripping deprecated category weights from user profiles...');
  console.log('='.repeat(80));

  const usersRef = db.collection('users');
  const userSnapshot = await usersRef.get();

  let totalUsersUpdated = 0;
  let totalKeysRemoved = 0;

  for (const userDoc of userSnapshot.docs) {
    const data = userDoc.data();
    const currentWeights = data.categoryWeights || {};
    const currentLengthWeights = data.categoryLengthWeights || {};
    const currentPublisherWeights = data.publisherWeights || {};

    let updates = {};
    let needsUpdate = false;
    const newPublisherWeights = {};

    // Strip old category keys from categoryWeights
    const newWeights = {};
    for (const [key, val] of Object.entries(currentWeights)) {
      if (NEW_CATEGORIES.includes(key)) {
        // Keep it — it's a new category (possibly leftover from seeding)
        newWeights[key] = val;
      } else if (OLD_CATEGORIES.includes(key)) {
        // Skip — remove old category
        totalKeysRemoved++;
        needsUpdate = true;
      } else {
        // Unknown category — keep it (might be a custom or could be artifact)
        newWeights[key] = val;
      }
    }

    // Strip old category keys from categoryLengthWeights (e.g. "Technology & Innovation::long")
    const newLengthWeights = {};
    for (const [key, val] of Object.entries(currentLengthWeights)) {
      const baseCategory = key.split('::')[0];
      if (NEW_CATEGORIES.includes(baseCategory)) {
        newLengthWeights[key] = val;
      } else if (OLD_CATEGORIES.includes(baseCategory)) {
        totalKeysRemoved++;
        needsUpdate = true;
      } else {
        newLengthWeights[key] = val;
      }
    }

    // Also clean up selectedCategoryIds and notInterestedCategoryIds
    const selectedIds = (data.selectedCategoryIds || []).filter(
      (id) => NEW_CATEGORIES.includes(id)
    );
    const notInterestedIds = (data.notInterestedCategoryIds || []).filter(
      (id) => NEW_CATEGORIES.includes(id)
    );

    if (selectedIds.length !== (data.selectedCategoryIds || []).length ||
        notInterestedIds.length !== (data.notInterestedCategoryIds || []).length) {
      needsUpdate = true;
    }

    if (needsUpdate) {
      updates = {
        categoryWeights: newWeights,
        categoryLengthWeights: newLengthWeights,
        selectedCategoryIds: selectedIds,
        notInterestedCategoryIds: notInterestedIds,
      };

      // Remove empty objects to keep profiles clean
      if (Object.keys(newLengthWeights).length === 0) {
        // Leave as empty object rather than deleting field
      }
      if (Object.keys(newPublisherWeights).length === 0) {
        // Publisher weights don't have category keys so no change
      }

      await userDoc.ref.update(updates);
      totalUsersUpdated++;
      console.log(`  Updated user ${userDoc.id}: ${Object.keys(updates.categoryWeights).length} categories remaining`);

      if (totalUsersUpdated % 50 === 0) {
        console.log(`  ... ${totalUsersUpdated} users processed`);
      }
    }
  }

  console.log(`\n  ✅ Users updated: ${totalUsersUpdated}`);
  console.log(`  ✅ Deprecated keys removed: ${totalKeysRemoved}`);
  return { totalUsersUpdated, totalKeysRemoved };
}

async function cleanupPublisherQualities() {
  console.log('\n' + '='.repeat(80));
  console.log('[Cleanup] STEP 4: Removing publisher entries for feeds that no longer exist...');
  console.log('='.repeat(80));

  // New verified publication names
  const validPublishers = new Set([
    'Slow Boring', 'Tangle', 'The Bulwark', 'Andrew Sullivan',
    'Heather Cox Richardson', 'Noahpinion', 'The Liberal Patriot', 'Reason',
    'The Diff', 'The Generalist', 'Doomberg', "Kyla's Newsletter",
    'Econlib', 'Net Interest', 'The Bear Cave', 'Calculated Risk',
    'Numlock News', 'Platformer', 'Stratechery', 'The Pragmatic Engineer',
    "Lenny's Newsletter", 'The Algorithmic Bridge', 'AI Supremacy',
    'MIT Technology Review', 'Dan Luu', 'Astral Codex Ten',
    'Your Local Epidemiologist', 'Dynomight', 'Experimental History',
    'Statistical Modeling', 'Unsettled Science',
    'ACOUP', 'UnHerd',
    'The Honest Broker', 'Culture Study', 'Freddie deBoer',
    'Why Is This Interesting?', 'Literary Hub',
    'Art of Manliness', 'The Prepared', 'Outside Online',
    'The Ankler',
  ]);

  const publishersSnapshot = await db.collection('publishers').get();
  let totalDeleted = 0;

  for (const doc of publishersSnapshot.docs) {
    const data = doc.data();
    if (!validPublishers.has(data.name)) {
      console.log(`  Removing stale publisher: ${data.name} (${doc.id})`);
      await doc.ref.delete();
      totalDeleted++;
    }
  }

  console.log(`\n  ✅ Stale publishers removed: ${totalDeleted}`);
  return totalDeleted;
}

async function cleanup() {
  console.log('='.repeat(80));
  console.log('  SubTick — Old Category Cleanup Script');
  console.log(`  Started: ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  try {
    await deleteOldArticles();
    await cleanupCandidatePools();
    await cleanupUserWeights();
    await cleanupPublisherQualities();

    console.log('\n' + '='.repeat(80));
    console.log('  ✅ CLEANUP COMPLETE');
    console.log('  The candidate pools will rebuild on the next scheduled cron run.');
    console.log('  New articles will be ingested with correct categories on the next rssCollector run.');
    console.log('='.repeat(80));
  } catch (error) {
    console.error('\n[Cleanup] FATAL ERROR:', error);
    process.exit(1);
  }

  process.exit(0);
}

cleanup();
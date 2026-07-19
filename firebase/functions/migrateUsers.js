// ============================================================
// SubTick — Retroactive User Profile Category Migration
// Run once with: node firebase/functions/migrateUsers.js
// Requires: service account key or `gcloud auth application-default login`
// ============================================================

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize Admin SDK
initializeApp({
  projectId: 'subtick-bbd55',
});

const db = getFirestore();

const categoryMigrationMap = {
  'tech': 'Technology & Innovation',
  'finance': 'Business & Finance',
  'politics': 'Politics & Global Affairs',
  'culture': 'Arts & Culture',
  'science': 'Science & Health',
  'health': 'Science & Health',
  'misc': 'Arts & Culture', 
};

async function migrateUsers() {
  console.log('[migrateUsers] Starting user profile migration...');

  const snapshot = await db.collection('users').get();

  if (snapshot.empty) {
    console.log('[migrateUsers] No users found.');
    return;
  }

  let total = snapshot.size;
  let updatedCount = 0;

  let batch = db.batch();
  let batchCount = 0;
  const BATCH_SIZE = 400;

  for (const doc of snapshot.docs) {
    const profile = doc.data();
    const updates = {};
    let needsUpdate = false;

    // Migrate categoryWeights
    if (profile.categoryWeights) {
      const newCategoryWeights = {};
      let migratedAny = false;
      
      for (const [oldCat, weight] of Object.entries(profile.categoryWeights)) {
        if (categoryMigrationMap[oldCat]) {
          const newCat = categoryMigrationMap[oldCat];
          // If merging categories (e.g. science and health), take the max weight
          newCategoryWeights[newCat] = Math.max(newCategoryWeights[newCat] || 0, weight);
          migratedAny = true;
        } else {
          newCategoryWeights[oldCat] = weight;
        }
      }

      if (migratedAny) {
        updates.categoryWeights = newCategoryWeights;
        needsUpdate = true;
      }
    }

    // Migrate selectedCategoryIds
    if (profile.selectedCategoryIds && Array.isArray(profile.selectedCategoryIds)) {
      const newSelected = [...new Set(profile.selectedCategoryIds.map(cat => categoryMigrationMap[cat] || cat))];
      // Compare arrays loosely by length or elements
      if (newSelected.join(',') !== profile.selectedCategoryIds.join(',')) {
        updates.selectedCategoryIds = newSelected;
        needsUpdate = true;
      }
    }

    // Migrate notInterestedCategoryIds
    if (profile.notInterestedCategoryIds && Array.isArray(profile.notInterestedCategoryIds)) {
      const newNotInterested = [...new Set(profile.notInterestedCategoryIds.map(cat => categoryMigrationMap[cat] || cat))];
      if (newNotInterested.join(',') !== profile.notInterestedCategoryIds.join(',')) {
        updates.notInterestedCategoryIds = newNotInterested;
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      batch.update(doc.ref, updates);
      batchCount++;
      updatedCount++;

      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        console.log(`[migrateUsers] Committed batch of ${batchCount} updates...`);
        batch = db.batch();
        batchCount = 0;
      }
    }
  }

  // Final batch
  if (batchCount > 0) {
    await batch.commit();
    console.log(`[migrateUsers] Committed final batch of ${batchCount} updates...`);
  }

  console.log(`[migrateUsers] Complete!`);
  console.log(`  Total users scanned: ${total}`);
  console.log(`  Users updated: ${updatedCount}`);
}

migrateUsers()
  .then(() => {
    console.log('[migrateUsers] Done.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[migrateUsers] Error:', err);
    process.exit(1);
  });

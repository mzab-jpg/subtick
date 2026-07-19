// ============================================================
// SubTick — Retroactive Categorization & Word Count
// Run once with: node firebase/retroCategorize.js
// Requires: service account key or `gcloud auth application-default login`
// ============================================================

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const feeds = require('../feeds.json');

// Initialize Admin SDK
initializeApp({
  projectId: 'subtick-bbd55',
});

const db = getFirestore();

// Build mapping from publisher name to { category, style }
const publisherMap = {};
for (const feed of feeds) {
  publisherMap[feed.publicationName] = {
    category: feed.category,
    style: feed.style || 'essay',
  };
}

// Word count calculator
function calculateWordCount(htmlContent) {
  if (!htmlContent) return 0;
  // Strip HTML tags and decode basic entities
  let text = htmlContent.replace(/<[^>]*>/g, ' ');
  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&[a-z]+;/gi, '');
  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length === 0) return 0;
  return text.split(' ').length;
}

// Fallback logic for estimatedReadMinutes (we still populate it to avoid breaking older UI components instantly)
function estimateReadMinutesFromWords(wordCount) {
  return Math.max(1, Math.ceil(wordCount / 250)); // Default to 250 WPM
}

async function retroCategorize() {
  console.log('[retroCategorize] Starting retroactive categorization and word count updates...');

  const snapshot = await db.collection('articles').get();

  if (snapshot.empty) {
    console.log('[retroCategorize] No articles found.');
    return;
  }

  let total = snapshot.size;
  let updatedCount = 0;

  let batch = db.batch();
  let batchCount = 0;
  const BATCH_SIZE = 400;

  for (const doc of snapshot.docs) {
    const article = doc.data();
    const updates = {};

    let needsUpdate = false;

    // 1. Update Category based on Publisher mapping by feedUrl (100% accurate)
    const feedUrl = article.feedUrl;
    let targetCategory = null;
    
    // Find the feed in feeds.json
    const matchingFeed = feeds.find(f => f.url === feedUrl);
    if (matchingFeed) {
      targetCategory = matchingFeed.category;
    }

    if (targetCategory && article.category !== targetCategory) {
      updates.category = targetCategory;
      needsUpdate = true;
    }

    // 2. Calculate true word count and lengthStyle
    if (article.bodyHtml) {
      const words = calculateWordCount(article.bodyHtml);
      if (article.wordCount !== words) {
        updates.wordCount = words;
        updates.estimatedReadMinutes = estimateReadMinutesFromWords(words);
        needsUpdate = true;
      }

      let lengthStyle = 'medium';
      if (words < 800) lengthStyle = 'short';
      else if (words > 2000) lengthStyle = 'long';

      if (article.lengthStyle !== lengthStyle) {
        updates.lengthStyle = lengthStyle;
        needsUpdate = true;
      }
    }

    // 3. Rip out old hardcoded `style`
    if (article.style !== undefined) {
      updates.style = require('firebase-admin/firestore').FieldValue.delete();
      needsUpdate = true;
    }

    if (needsUpdate) {
      batch.update(doc.ref, updates);
      batchCount++;
      updatedCount++;

      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        console.log(`[retroCategorize] Committed batch of ${batchCount} updates...`);
        batch = db.batch();
        batchCount = 0;
      }
    }
  }

  // Final batch
  if (batchCount > 0) {
    await batch.commit();
    console.log(`[retroCategorize] Committed final batch of ${batchCount} updates...`);
  }

  console.log(`[retroCategorize] Complete!`);
  console.log(`  Total articles scanned: ${total}`);
  console.log(`  Articles updated: ${updatedCount}`);
}

retroCategorize()
  .then(() => {
    console.log('[retroCategorize] Done.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[retroCategorize] Error:', err);
    process.exit(1);
  });

// ============================================================
// SubTick — Retroactive Article Sanitizer & Paywall Checker
// Run once with: node firebase/retroClean.js
// Requires: service account key or `gcloud auth application-default login`
// ============================================================

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize Admin SDK
// Uses Application Default Credentials (gcloud auth application-default login)
// Or set GOOGLE_APPLICATION_CREDENTIALS env var to a service account key
initializeApp({
  projectId: 'subtick-bbd55',
});

const db = getFirestore();

// --- Paywall keywords (same as paywallFilter.ts) ---
const PAYWALL_KEYWORDS = [
  'To read this post, subscribe',
  'Paid subscription required',
  'This post is for paid subscribers',
  'Upgrade to paid',
  'Subscribe to continue reading',
  'Behind the paywall',
  'This content is for subscribers only',
  "You've reached the free preview",
  'Subscribe now to read the full post',
  'Continue reading with a paid subscription',
];

// --- HTML sanitization (mirrors htmlSanitizer.ts, simplified for Node) ---
function cleanHtml(html) {
  if (!html) return html;

  let cleaned = html;

  // Strip tracking pixels (1x1 images)
  cleaned = cleaned.replace(/<img[^>]*(?:width\s*=\s*["']?\s*1\s*["']?|height\s*=\s*["']?\s*1\s*["']?)[^>]*>/gi, '');

  // Strip <img> tags with analytics/pixel/track in src
  cleaned = cleaned.replace(/<img[^>]*src\s*=\s*["'](?:[^"']*(?:analytics|pixel|track)[^"']*)["'][^>]*>/gi, '');

  // Strip <script> blocks
  cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');

  // Strip <iframe> blocks
  cleaned = cleaned.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');

  // Strip inline styles
  cleaned = cleaned.replace(/\s*style\s*=\s*"[^"]*"/gi, '');

  // Strip subscribe/paywall/overlay div blocks (best effort)
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*subscribe[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*paywall[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*overlay[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');

  // Collapse excessive newlines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}

// --- Paywall detection (same logic as paywallFilter.ts) ---
function detectPaywall(title, description, bodyHtml) {
  const contentToCheck = `${title} ${description} ${bodyHtml}`.toLowerCase();

  const keywordMatch = PAYWALL_KEYWORDS.some((keyword) =>
    contentToCheck.includes(keyword.toLowerCase())
  );

  // Check CSS classes
  const hasPaywallClass =
    /class="[^"]*paywall[^"]*"/i.test(bodyHtml) ||
    /class="[^"]*subscriber-only[^"]*"/i.test(bodyHtml) ||
    /class="[^"]*locked-content[^"]*"/i.test(bodyHtml);

  // Check scripts
  const hasPaywallScript = /paywall/i.test(bodyHtml) && /<script/i.test(bodyHtml);

  return keywordMatch || hasPaywallClass || hasPaywallScript;
}

// --- Main ---
async function retroClean() {
  console.log('[retroClean] Starting retroactive sanitization...');

  const snapshot = await db.collection('articles').get();

  if (snapshot.empty) {
    console.log('[retroClean] No articles found.');
    return;
  }

  let sanitized = 0;
  let paywalled = 0;
  let total = snapshot.size;

  const batch = db.batch();
  let batchCount = 0;
  const BATCH_SIZE = 500;

  for (const doc of snapshot.docs) {
    const article = doc.data();
    const updates = {};

    // Sanitize HTML
    if (article.bodyHtml) {
      const cleaned = cleanHtml(article.bodyHtml);
      if (cleaned !== article.bodyHtml) {
        updates.bodyHtml = cleaned;
        sanitized++;
      }
    }

    // Check paywall (only if not already marked)
    if (!article.isPaywalled) {
      const isPaywalled = detectPaywall(
        article.title || '',
        article.description || '',
        article.bodyHtml || ''
      );
      if (isPaywalled) {
        updates.isPaywalled = true;
        paywalled++;
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.cacheTimestamp = Date.now();
      batch.update(doc.ref, updates);
      batchCount++;

      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        console.log(`[retroClean] Committed batch of ${batchCount} updates...`);
        batchCount = 0;
      }
    }
  }

  // Final batch
  if (batchCount > 0) {
    await batch.commit();
  }

  console.log(`[retroClean] Complete!`);
  console.log(`  Total articles scanned: ${total}`);
  console.log(`  HTML sanitized: ${sanitized}`);
  console.log(`  Paywalled flagged: ${paywalled}`);
}

retroClean()
  .then(() => {
    console.log('[retroClean] Done.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[retroClean] Error:', err);
    process.exit(1);
  });
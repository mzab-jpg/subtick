/**
 * ============================================================
 * SubTick — seedFirestore.js
 * Uses firebase-admin to download, parse, and upload seed
 * articles from 35 Substack RSS feeds to Firestore.
 *
 * Usage:
 *   cd firebase
 *   node seedFirestore.js
 *
 * Prerequisites:
 *   - Firebase service account key JSON at ./serviceAccountKey.json
 *     OR firebase-tools logged in (`firebase login`)
 *   - For emulator: set FIRESTORE_EMULATOR_HOST=localhost:8080
 * ============================================================
 */

const admin = require('firebase-admin');
const Parser = require('rss-parser');
const crypto = require('crypto');
const path = require('path');

// --- Configuration ---
const SUBSTACK_FEEDS = require('./feeds.json');

// Initialize Firebase Admin
let db;

try {
  // Try service account first, fall back to application default
  const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
  const fs = require('fs');

  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('[Seed] Initialized with service account key');
  } else {
    admin.initializeApp({
      projectId: 'subtick-bbd55',
    });
    console.log('[Seed] Initialized with application default credentials');
  }
  db = admin.firestore();

  // Connect to emulator if env var is set
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    db.settings({
      host: `${host}:${port}`,
      ssl: false,
    });
    console.log(`[Seed] Connected to Firestore emulator at ${host}:${port}`);
  }
} catch (error) {
  console.error('[Seed] Failed to initialize Firebase:', error.message);
  process.exit(1);
}

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'SubTick/1.0 Seed Script' },
});

// --- Helpers ---
function generateArticleId(url, title) {
  const hash = crypto.createHash('sha256').update(`${url}::${title}`).digest('hex');
  return `article_${hash.substring(0, 16)}`;
}

function estimateReadMinutes(htmlContent) {
  const textLength = htmlContent.replace(/<[^>]*>/g, '').length;
  const estimatedWords = textLength / 5;
  return Math.max(1, Math.ceil(estimatedWords / 238));
}

function extractFirstImage(html) {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : undefined;
}

function sanitizeBodyHtml(html) {
  // Basic sanitization: remove scripts, tracking pixels, inline styles
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<script[\s\S]*?\/>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\s*style="[^"]*"/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned;
}

async function seed() {
  console.log(`[Seed] Starting seed process for ${SUBSTACK_FEEDS.length} feeds...`);
  console.log('============================================');

  let totalCreated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const feed of SUBSTACK_FEEDS) {
    try {
      console.log(`\n[Seed] Fetching: ${feed.publicationName} (${feed.url})`);
      const feedData = await parser.parseURL(feed.url);

      if (!feedData.items || feedData.items.length === 0) {
        console.log(`  ⚠️  No items found`);
        continue;
      }

      console.log(`  Found ${feedData.items.length} items`);

      // Process only the latest 10 items per feed for seeding
      const items = feedData.items.slice(0, 10);

      for (const item of items) {
        try {
          const title = item.title || 'Untitled';
          const link = item.link || '';
          const articleId = generateArticleId(link, title);

          // Check if article already exists
          const existing = await db.collection('articles').doc(articleId).get();
          if (existing.exists) {
            totalSkipped++;
            continue;
          }

          const rawHtml = item['content:encoded'] || item.content || item.description || '';
          const bodyHtml = sanitizeBodyHtml(rawHtml);
          const description = (item.contentSnippet || item.description || '').substring(0, 300);
          const publishDate = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();
          const author = item.creator || item['dc:creator'] || feed.publicationName;
          const headerImageUrl = extractFirstImage(rawHtml);

          const article = {
            id: articleId,
            title,
            author,
            publicationName: feed.publicationName,
            publicationUrl: feedData.link || feed.url,
            feedUrl: feed.url,
            category: feed.category,
            bodyHtml,
            description,
            publishDate,
            cacheTimestamp: Date.now(),
            isPaywalled: false,
            headerImageUrl,
            estimatedReadMinutes: estimateReadMinutes(bodyHtml),
            trendingScore: 0,
            qualityScore: feed.qualityScore,
            isSeed: true,
          };

          await db.collection('articles').doc(articleId).set(article);
          totalCreated++;
          console.log(`  ✅ ${title.substring(0, 60)}...`);
        } catch (itemError) {
          totalErrors++;
          console.error(`  ❌ Item error:`, itemError.message?.substring(0, 80));
        }

        // Small delay to avoid rate limiting
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch (feedError) {
      totalErrors++;
      console.error(`  ❌ Feed error for ${feed.publicationName}:`, feedError.message?.substring(0, 80));
    }
  }

  console.log('\n============================================');
  console.log('[Seed] Complete!');
  console.log(`  Created: ${totalCreated}`);
  console.log(`  Skipped (duplicates): ${totalSkipped}`);
  console.log(`  Errors: ${totalErrors}`);
  console.log('============================================');

  process.exit(0);
}

seed().catch((error) => {
  console.error('[Seed] Fatal error:', error);
  process.exit(1);
});
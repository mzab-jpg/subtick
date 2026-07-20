// ============================================================
// SubTick — getRankedFeed (HTTPS Callable)
// 5-component scoring formula, cached, time-stratified,
// with inverted diversity scoring & 10% exploration.
// Returns top 100 with dynamic real-time publisher quality scores.
// ============================================================

import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { Article, RankedFeedResult, UserProfile } from './types.js';
import {
  SCORE_WEIGHTS,
} from './constants.js';

const db = admin.firestore();

// --- Configuration ---
const RETURN_FEED_SIZE = 30;
const EXPLORATION_COUNT = 3; // 10% of returned feed is random/wildcard exploration
const CACHE_LIFETIME_MS = 10 * 60 * 1000; // 10 minutes memory cache

// Global Cache Variables (persistent across function container instances)
let candidateCacheCurrent: Article[] = [];
let cacheTimestampCurrent = 0;
let candidateCacheMixed: Article[] = [];
let cacheTimestampMixed = 0;

// Helper to shuffle an array in place (Fisher-Yates)
function shuffleArray<T>(array: T[]): void {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

let publisherQualityCache: Record<string, number> = {};
let publisherCacheTimestamp = 0;

/**
 * 5-Component Scoring Formula:
 * Score = (0.30 × P) + (0.20 × T) + (0.25 × R) + (0.15 × Q) + (0.10 × U)
 *
 * 1. Personalization Boost (P): max(0.1, userCategoryLengthWeight / 1.0)
 * 2. Trending Boost (T): max(0.1, 1.0 + articleTrendingScore / 2.5)
 * 3. Recency Boost (R): 2.0 / (1.0 + daysOld / 7)
 * 4. Quality Boost (Q): dynamicPublisherQualityScore
 * 5. Cross-User Collaboration (U): 1.0 - (min(1.0, (articlesInSamePub - 1) / 15) * 0.6)
 */
function calculateCompositeScore(
  article: Article,
  personalizationWeight: number,
  articlesInSamePub: number,
  publisherQuality: number
): number {
  const daysOld = Math.max(0, (Date.now() - article.publishDate) / (1000 * 60 * 60 * 24));

  const P = Math.max(0.1, personalizationWeight / 1.0);
  const T = Math.max(0.1, 1.0 + (article.trendingScore || 0) / 2.5);
  const R = 2.0 / (1.0 + daysOld / 7);
  const Q = publisherQuality;

  // FIXED (Inverted Diversity score): If there are many articles from this same publication,
  // we reduce its score to encourage publisher variety.
  // If articlesInSamePub = 1, U = 1.0 (no penalty)
  // If articlesInSamePub >= 16, U = 0.4 (reduced by up to 60%)
  const U = 1.0 - (Math.min(1.0, (articlesInSamePub - 1) / 15) * 0.6);

  return (
    SCORE_WEIGHTS.categoryBoost * P +
    SCORE_WEIGHTS.trendingBoost * T +
    SCORE_WEIGHTS.recencyBoost * R +
    SCORE_WEIGHTS.qualityBoost * Q +
    SCORE_WEIGHTS.crossUserCollab * U
  );
}

/**
 * Stage 1: Fast Filtering with Cache (Low-Compute)
 * Pulls up to 2000 recent articles and 2000 archive articles, shuffles them randomly,
 * and caches exactly 1000 candidates (500 fresh, 500 archive) in memory for 10 minutes.
 * This completely prevents users from exhausting the queue.
 */
/**
 * Cron task that runs every 10 minutes to build the universal "candidate pool" box
 * out of ALL available articles in the database.
 * This completely eliminates the need for user-triggered requests to scan thousands of database entries,
 * reducing our read bills by 99.9%.
 */
export const cronUpdateCandidatePool = onSchedule('every 10 minutes', async () => {
  console.log('[Cron] Starting dual candidate pool generation (Current vs Mixed)...');
  try {
    const now = Date.now();
    
    // We scan ALL articles in the database
    const snapshot = await db.collection('articles').get();
    const currentArticles: Article[] = [];
    const archivedArticles: Article[] = [];
    
    snapshot.forEach((doc) => {
      const data = doc.data() as Article;
      if (!data.isPaywalled && (data.wordCount === undefined || data.wordCount >= 150)) {
        const article = {
          id: doc.id,
          title: data.title,
          author: data.author,
          publicationName: data.publicationName,
          publicationUrl: data.publicationUrl,
          feedUrl: data.feedUrl,
          category: data.category,
          lengthStyle: data.lengthStyle,
          guid: data.guid,
          isTruncatedFeed: data.isTruncatedFeed ?? false,
          description: data.description,
          publishDate: data.publishDate,
          isPaywalled: data.isPaywalled,
          wordCount: data.wordCount,
          estimatedReadMinutes: data.estimatedReadMinutes,
          trendingScore: data.trendingScore || 0,
          qualityScore: data.qualityScore || 0.8,
          cacheTimestamp: data.cacheTimestamp || now,
          isSeed: data.isSeed ?? false,
          rssStatus: data.rssStatus || 'current', // Default to current if not set
        };

        if (article.rssStatus === 'archived') {
          archivedArticles.push(article);
        } else {
          currentArticles.push(article);
        }
      }
    });

    const fourWeeksAgo = now - (4 * 7 * 24 * 60 * 60 * 1000);
    
    // Build Box 1: Current Only
    const currentFresh = currentArticles.filter(a => a.publishDate >= fourWeeksAgo);
    const currentOld = currentArticles.filter(a => a.publishDate < fourWeeksAgo);
    shuffleArray(currentFresh);
    shuffleArray(currentOld);
    const boxCurrent = [...currentFresh.slice(0, 500), ...currentOld.slice(0, 500)];
    
    // Build Box 2: Mixed (Half Current, Half Archived)
    shuffleArray(currentArticles);
    shuffleArray(archivedArticles);
    const boxMixed = [...currentArticles.slice(0, 500), ...archivedArticles.slice(0, 500)];

    // Save both boxes
    await db.collection('system').doc('candidatePool_current').set({
      articles: boxCurrent,
      generatedAt: now,
    });
    
    await db.collection('system').doc('candidatePool_mixed').set({
      articles: boxMixed,
      generatedAt: now,
    });

    console.log(`[Cron] Dual Universal Boxes written. Current Box: ${boxCurrent.length}, Mixed Box: ${boxMixed.length}`);
  } catch (error) {
    console.error('[Cron] Error generating candidate pools:', error);
  }
});

async function getOrUpdateCandidatePool(includeArchived: boolean): Promise<Article[]> {
  const now = Date.now();
  const memoryCache = includeArchived ? candidateCacheMixed : candidateCacheCurrent;
  const memCacheTimestamp = includeArchived ? cacheTimestampMixed : cacheTimestampCurrent;

  if (memoryCache.length > 0 && (now - memCacheTimestamp) < CACHE_LIFETIME_MS) {
    console.log(`[Cache] Serving ${memoryCache.length} articles from memory (includeArchived: ${includeArchived})`);
    return memoryCache;
  }

  const docName = includeArchived ? 'candidatePool_mixed' : 'candidatePool_current';
  console.log(`[Cache] Cold cache. Fetching ${docName} from Firestore...`);

  try {
    const docRef = db.collection('system').doc(docName);
    const snap = await docRef.get();
    if (snap.exists) {
      const data = snap.data();
      if (data && Array.isArray(data.articles) && data.articles.length > 0) {
        if (includeArchived) {
          candidateCacheMixed = data.articles as Article[];
          cacheTimestampMixed = data.generatedAt || now;
          console.log(`[Cache] Loaded mixed pool: ${candidateCacheMixed.length}`);
          return candidateCacheMixed;
        } else {
          candidateCacheCurrent = data.articles as Article[];
          cacheTimestampCurrent = data.generatedAt || now;
          console.log(`[Cache] Loaded current pool: ${candidateCacheCurrent.length}`);
          return candidateCacheCurrent;
        }
      }
    }
  } catch (err) {
    console.error(`[Cache] Failed to fetch ${docName}, falling back to on-the-fly generation:`, err);
  }

  console.log('[Cache] Fallback triggered. Querying stratified buckets on-the-fly...');
  try {
    const fourWeeksAgo = now - (4 * 7 * 24 * 60 * 60 * 1000);

    // Bucket A: Fresh (up to 2000 newest articles)
    const freshSnapshot = await db
      .collection('articles')
      .where('publishDate', '>=', fourWeeksAgo)
      .orderBy('publishDate', 'desc')
      .limit(2000)
      .get();

    // Bucket B: Archive/Quality (up to 2000 older, high-quality articles)
    const qualitySnapshot = await db
      .collection('articles')
      .where('publishDate', '<', fourWeeksAgo)
      .orderBy('publishDate', 'desc')
      .limit(2000)
      .get();

    const freshArticles: Article[] = [];
    freshSnapshot.forEach((doc) => {
      const data = doc.data() as Article;
      if (!data.isPaywalled && (data.wordCount === undefined || data.wordCount >= 150)) {
        freshArticles.push({ ...data, id: doc.id });
      }
    });

    const archiveArticles: Article[] = [];
    qualitySnapshot.forEach((doc) => {
      const data = doc.data() as Article;
      if (!data.isPaywalled && (data.wordCount === undefined || data.wordCount >= 150)) {
        archiveArticles.push({ ...data, id: doc.id });
      }
    });

    // Shuffle both buckets randomly in memory
    shuffleArray(freshArticles);
    shuffleArray(archiveArticles);

    // Pick 500 from each bucket
    const selectedFresh = freshArticles.slice(0, 500);
    const selectedArchive = archiveArticles.slice(0, 500);

    const articlesMap = new Map<string, Article>();
    [...selectedFresh, ...selectedArchive].forEach(a => {
      articlesMap.set(a.id, a);
    });

    // We only fallback to building the current cache to be safe
    candidateCacheCurrent = Array.from(articlesMap.values());
    cacheTimestampCurrent = now;
    console.log(`[Cache] Fallback rebuilt candidate pool cache. Total articles: ${candidateCacheCurrent.length}`);
    return candidateCacheCurrent;
  } catch (error) {
    console.error('[Cache] Fallback error building candidate pool:', error);
    if (candidateCacheCurrent.length > 0) {
      console.warn('[Cache] Falling back to expired in-memory pool');
      return candidateCacheCurrent;
    }
    throw error;
  }
}

/**
 * Stage 1.5: Fetch & Cache Dynamic Publisher Quality Scores (Crowd-Sourced)
 */
async function getOrUpdatePublisherQualities(): Promise<Record<string, number>> {
  const now = Date.now();
  if (Object.keys(publisherQualityCache).length > 0 && (now - publisherCacheTimestamp) < CACHE_LIFETIME_MS) {
    return publisherQualityCache;
  }

  console.log('[Cache] Publisher quality cache expired or empty. Querying Firestore publishers...');
  try {
    const snapshot = await db.collection('publishers').get();
    const tempQualities: Record<string, number> = {};
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data && typeof data.qualityScore === 'number') {
        // Match by the original publication name field if present, falling back to doc.id
        const pubKey = (data.name && typeof data.name === 'string') ? data.name : doc.id;
        // Clamp live publisher score organically between [0.20, 1.00] so terrible feeds are muted but not deleted
        tempQualities[pubKey] = Math.max(0.2, Math.min(1.0, data.qualityScore));
      }
    });
    publisherQualityCache = tempQualities;
    publisherCacheTimestamp = now;
    console.log(`[Cache] Loaded live dynamic quality scores for ${Object.keys(publisherQualityCache).length} publishers`);
    return publisherQualityCache;
  } catch (err: any) {
    console.error('[Cache] Failed to load publisher quality scores, falling back to old cache:', err.message);
    return publisherQualityCache; // fallback to expired or empty
  }
}

/**
 * Stage 2: Feed Assembly via Tranches
 * Groups articles by Personalization Weight (P), then selects target amounts
 * randomly from top tranches, and strictly by quality from bottom tranches.
 */
function assembleFeedWithTranches(
  scoredList: { article: Article; score: number; pValue: number }[],
  totalSize = 30
): Article[] {
  if (scoredList.length === 0) return [];

  // Group into Tranches
  const highBucket: { article: Article; score: number }[] = [];
  const midBucket: { article: Article; score: number }[] = [];
  const lowBucket: { article: Article; score: number }[] = [];
  const discoveryBucket: { article: Article; score: number }[] = [];

  for (const item of scoredList) {
    if (item.pValue >= 1.5) {
      highBucket.push(item);
    } else if (item.pValue >= 1.15) {
      midBucket.push(item);
    } else if (item.pValue >= 1.0) {
      lowBucket.push(item);
    } else {
      discoveryBucket.push(item);
    }
  }

  const finalFeed: Article[] = [];
  let remainingCount = totalSize;

  // Target quotas
  let targetHigh = 12;
  let targetMid = 8;
  let targetLow = 4;
  let targetDiscovery = 6;

  // Helper to pick items
  const pickItems = (bucket: { article: Article; score: number }[], target: number, shuffle: boolean) => {
    if (bucket.length === 0 || target === 0) return [];
    const count = Math.min(bucket.length, target);
    
    // Sort or Shuffle depending on the tranche
    if (shuffle) {
      shuffleArray(bucket);
    } else {
      // Sort by score (quality) descending
      bucket.sort((a, b) => b.score - a.score);
    }
    
    return bucket.slice(0, count).map(s => s.article);
  };

  // 1. Pick High Tranche (Random)
  const pickedHigh = pickItems(highBucket, targetHigh, true);
  finalFeed.push(...pickedHigh);
  remainingCount -= pickedHigh.length;
  if (pickedHigh.length < targetHigh) {
    // Graceful fallback: Give missing quota to Mid
    targetMid += (targetHigh - pickedHigh.length);
  }

  // 2. Pick Mid Tranche (Random)
  const pickedMid = pickItems(midBucket, targetMid, true);
  finalFeed.push(...pickedMid);
  remainingCount -= pickedMid.length;
  if (pickedMid.length < targetMid) {
    // Graceful fallback: Give missing quota to Low
    targetLow += (targetMid - pickedMid.length);
  }

  // 3. Pick Low Tranche (Sorted by Quality)
  const pickedLow = pickItems(lowBucket, targetLow, false);
  finalFeed.push(...pickedLow);
  remainingCount -= pickedLow.length;
  if (pickedLow.length < targetLow) {
    // Graceful fallback: Give missing quota to Discovery
    targetDiscovery += (targetLow - pickedLow.length);
  }

  // 4. Pick Discovery Tranche (Sorted by Quality)
  const pickedDiscovery = pickItems(discoveryBucket, targetDiscovery, false);
  finalFeed.push(...pickedDiscovery);
  remainingCount -= pickedDiscovery.length;

  // 5. Final Graceful Fallback (if the overall pool was very small)
  if (remainingCount > 0) {
    const usedIds = new Set(finalFeed.map(a => a.id));
    const leftovers = scoredList.filter(s => !usedIds.has(s.article.id));
    leftovers.sort((a, b) => b.score - a.score);
    finalFeed.push(...leftovers.slice(0, remainingCount).map(s => s.article));
  }

  // Final completely mixed shuffle
  shuffleArray(finalFeed);

  console.log(`[Tranche Selector] High: ${pickedHigh.length}, Mid: ${pickedMid.length}, Low: ${pickedLow.length}, Discovery: ${pickedDiscovery.length}`);

  return finalFeed;
}

export const getRankedFeed = onCall(async (request): Promise<RankedFeedResult> => {
  const { userId, seenArticleIds } = request.data as { userId: string; seenArticleIds: string[] };
  console.log(`[getRankedFeed] userId: ${userId}, seen limit: ${(seenArticleIds || []).length}`);

  let categoryWeights: Record<string, number> = {};
  let categoryLengthWeights: Record<string, number> = {};
  let publisherWeights: Record<string, number> = {};
  let includeArchivedArticles = false;
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      const data = userDoc.data() as UserProfile;
      categoryWeights = data.categoryWeights || {};
      categoryLengthWeights = data.categoryLengthWeights || {};
      publisherWeights = data.publisherWeights || {};
      includeArchivedArticles = data.includeArchivedArticles || false;
    }
  } catch (err) {
    console.warn('[getRankedFeed] Could not fetch user profile');
  }

  try {
    // STAGE 1: Fetch candidate pool based on user preference
    const pool = await getOrUpdateCandidatePool(includeArchivedArticles);

    if (pool.length === 0) {
      return { articles: [], generatedAt: Date.now(), remainingCount: 0 };
    }

    // STAGE 1.5: Fetch dynamic crowd-sourced publisher quality scores
    const publisherQualities = await getOrUpdatePublisherQualities();

    // STAGE 2: Personalization & Filtering
    // Filter out the 200 newest seen IDs passed from the client
    const seenSet = new Set(seenArticleIds || []);
    const unseenArticles = pool.filter(article => !seenSet.has(article.id));

    const pubCounts: Record<string, number> = {};
    unseenArticles.forEach((a) => {
      pubCounts[a.publicationName] = (pubCounts[a.publicationName] || 0) + 1;
    });

    const scored = unseenArticles.map((article) => {
      const compKey = `${article.category}::${article.lengthStyle}`;
      
      // Calculate 3D Matrix Personalization Weight
      const baseCategoryWeight = categoryLengthWeights[compKey] ?? categoryWeights[article.category] ?? 1.0;
      const basePublisherWeight = publisherWeights[article.publicationName] ?? 1.0;
      
      // Blended personalization multiplier
      const personalizationWeight = baseCategoryWeight * basePublisherWeight;
      const P = Math.max(0.1, personalizationWeight / 1.0);
      
      const pubCount = pubCounts[article.publicationName] || 1;
      
      // Use dynamic, crowd-sourced publisher quality score. Falls back to static seed if no feedback gathered yet
      const dynamicQuality = publisherQualities[article.publicationName] ?? article.qualityScore ?? 0.8;
      
      // For discovery articles (P < 1.0), we calculate their score ignoring their negative personalization 
      // so they compete purely on quality, recency, and trending.
      let effectivePWeight = personalizationWeight;
      if (P < 1.0) {
        effectivePWeight = 1.0; // Reset to neutral for fair Discovery comparison
      }
      
      const score = calculateCompositeScore(article, effectivePWeight, pubCount, dynamicQuality);
      return { article, score, pValue: P };
    });

    // Assemble the feed by bucketing into Tranches and pulling exact target counts
    const finalFeed = assembleFeedWithTranches(scored, RETURN_FEED_SIZE);

    // --- Log top 5 articles with per-component scores for debugging ---
    console.log(`[getRankedFeed] User weights: ${JSON.stringify(categoryWeights)}, Style weights: ${JSON.stringify(categoryLengthWeights)}`);
    console.log(`[getRankedFeed] --- Top 5 Scored Articles ---`);
    scored.slice(0, 5).forEach((s, i) => {
      const daysOld = Math.max(0, (Date.now() - s.article.publishDate) / (1000 * 60 * 60 * 24));
      const compKey = `${s.article.category}::${s.article.lengthStyle}`;
      
      const baseCategoryWeight = categoryLengthWeights[compKey] ?? categoryWeights[s.article.category] ?? 1.0;
      const basePublisherWeight = publisherWeights[s.article.publicationName] ?? 1.0;
      const personalizationWeight = baseCategoryWeight * basePublisherWeight;
      
      const pubCount = pubCounts[s.article.publicationName] || 1;
      const P = Math.max(0.1, personalizationWeight / 1.0);
      const T = Math.max(0.1, 1.0 + (s.article.trendingScore || 0) / 2.5);
      const R = 2.0 / (1.0 + daysOld / 7);
      
      const dynamicQuality = publisherQualities[s.article.publicationName] ?? s.article.qualityScore ?? 0.8;
      const U = 1.0 - (Math.min(1.0, (pubCount - 1) / 15) * 0.6);
      
      console.log(
        `  #${i + 1} [${s.article.category}::${s.article.lengthStyle}] "${s.article.title.substring(0, 60)}..." ` +
        `score=${s.score.toFixed(3)} P=${P.toFixed(2)} T=${T.toFixed(2)} R=${R.toFixed(2)} Q=${dynamicQuality.toFixed(2)} U=${U.toFixed(2)}`
      );
    });

    console.log(`[getRankedFeed] Returning ${finalFeed.length} articles to client (pool size: ${pool.length})`);
    return {
      articles: finalFeed,
      generatedAt: Date.now(),
      remainingCount: Math.max(0, unseenArticles.length - finalFeed.length),
    };
  } catch (error: any) {
    console.error('[getRankedFeed] Error:', error);
    throw new Error('Failed to rank feed');
  }
});

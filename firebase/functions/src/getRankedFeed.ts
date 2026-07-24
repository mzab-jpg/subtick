// ============================================================
// SubTick — getRankedFeed (HTTPS Callable)
// Normalized 5-component scoring formula, cached, time-stratified,
// with per-tranche formulas and daily trending score decay.
// ============================================================

import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { Article, RankedFeedResult, UserProfile } from './types.js';
import {
  SCORE_WEIGHTS,
  SCORE_WEIGHTS_MERIT,
  TRENDING_DECAY_RATE,
  MAX_TRENDING_SCORE,
} from './constants.js';

const db = admin.firestore();

// --- Configuration ---
const RETURN_FEED_SIZE = 30;
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

// ============================================================
// Normalized Component Calculators
// All functions return a value in [0, 1] so formula weights
// mean exactly what they say.
// ============================================================

/**
 * P — Personalization [0, 1]
 * Converts raw category and publisher weights (range [0.1, 5.0])
 * into a 0-to-1 fraction of maximum possible interest.
 *
 * Category gets 70% of P, publisher gets 30% (category is the stronger signal).
 *
 * A neutral user (all weights = 1.0) gets P ≈ 0.18.
 * Max possible (both weights = 5.0) gets P = 1.0.
 */
function normalizeP(categoryWeight: number, publisherWeight: number): number {
  const MIN_W = 0.1;
  const MAX_W = 5.0;
  const RANGE = MAX_W - MIN_W; // 4.9
  const catFraction = Math.max(0, Math.min(1, (categoryWeight - MIN_W) / RANGE));
  const pubFraction = Math.max(0, Math.min(1, (publisherWeight - MIN_W) / RANGE));
  return catFraction * 0.7 + pubFraction * 0.3;
}

/**
 * T — Trending [0, 1]
 * Normalized trendingScore capped at MAX_TRENDING_SCORE (50).
 * Score of 0 → T = 0.0 (new article).
 * Score of 50+ → T = 1.0 (very viral).
 */
function normalizeT(trendingScore: number): number {
  return Math.min(trendingScore, MAX_TRENDING_SCORE) / MAX_TRENDING_SCORE;
}

/**
 * R — Recency [0, 1]
 * Two-phase decay:
 * - Days 0–7: slow linear drop from 1.0 to 0.8 (article stays "fresh" for a week)
 * - After day 7: steeper power-law decay (0.8 × (7/daysOld)^1.5)
 *
 * Values at key ages:
 *   0 days  → 1.00
 *   3 days  → 0.91
 *   7 days  → 0.80
 *  14 days  → 0.43
 *  28 days  → 0.15
 *  60 days  → 0.04
 */
function normalizeR(daysOld: number): number {
  if (daysOld <= 0) return 1.0;
  if (daysOld <= 7) {
    return 1.0 - (daysOld / 7) * 0.2;
  }
  return 0.8 * Math.pow(7 / daysOld, 1.5);
}

/**
 * Q — Publisher Quality [0, 1]
 * Rescales the crowd-sourced quality score from [0.2, 1.0] to [0, 1].
 * Default new publisher (0.8) → Q = 0.75
 * Best publisher (1.0) → Q = 1.0
 * Worst publisher (0.2) → Q = 0.0
 */
function normalizeQ(qualityScore: number): number {
  const MIN_Q = 0.2;
  const MAX_Q = 1.0;
  return Math.max(0, Math.min(1, (qualityScore - MIN_Q) / (MAX_Q - MIN_Q)));
}

/**
 * U — Diversity [0, 1]
 * Rescales the raw diversity penalty from [0.4, 1.0] to [0, 1].
 * Only 1 article from this publisher → U = 1.0 (no penalty)
 * 16+ articles from same publisher → U = 0.0 (maximum penalty)
 */
function normalizeU(articlesInSamePub: number): number {
  const rawU = 1.0 - (Math.min(1.0, (articlesInSamePub - 1) / 15) * 0.6);
  const MIN_U = 0.4;
  const MAX_U = 1.0;
  return Math.max(0, Math.min(1, (rawU - MIN_U) / (MAX_U - MIN_U)));
}

/**
 * Composite score for High/Mid tranches (personalized formula):
 * Score = 0.40P + 0.15T + 0.20R + 0.15Q + 0.10U
 * All inputs must be normalized [0, 1]. Output is [0, 1].
 */
function scorePersonalized(P: number, T: number, R: number, Q: number, U: number): number {
  return (
    SCORE_WEIGHTS.personalization * P +
    SCORE_WEIGHTS.trending * T +
    SCORE_WEIGHTS.recency * R +
    SCORE_WEIGHTS.quality * Q +
    SCORE_WEIGHTS.diversity * U
  );
}

/**
 * Composite score for Low/Discovery tranches (merit-based formula):
 * Score = 0.40R + 0.30T + 0.30Q
 * No personalization, no diversity penalty. Output is [0, 1].
 */
function scoreMerit(T: number, R: number, Q: number): number {
  return (
    SCORE_WEIGHTS_MERIT.recency * R +
    SCORE_WEIGHTS_MERIT.trending * T +
    SCORE_WEIGHTS_MERIT.quality * Q
  );
}

/**
 * Cron task that runs every 10 minutes to build the universal "candidate pool" box
 * out of ALL available articles in the database.
 */
export const cronUpdateCandidatePool = onSchedule('every 10 minutes', async () => {
  console.log('[Cron] Starting dual candidate pool generation (Current vs Mixed)...');
  try {
    const now = Date.now();

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
          rssStatus: data.rssStatus || 'current',
        };

        if (article.rssStatus === 'archived') {
          archivedArticles.push(article);
        } else {
          currentArticles.push(article);
        }
      }
    });

    const fourWeeksAgo = now - (4 * 7 * 24 * 60 * 60 * 1000);

    // Build Box 1: Current Only (500 fresh + 500 old)
    const currentFresh = currentArticles.filter(a => a.publishDate >= fourWeeksAgo);
    const currentOld = currentArticles.filter(a => a.publishDate < fourWeeksAgo);
    shuffleArray(currentFresh);
    shuffleArray(currentOld);
    const boxCurrent = [...currentFresh.slice(0, 500), ...currentOld.slice(0, 500)];

    // Build Box 2: Mixed (500 current + 500 archived)
    shuffleArray(currentArticles);
    shuffleArray(archivedArticles);
    const boxMixed = [...currentArticles.slice(0, 500), ...archivedArticles.slice(0, 500)];

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

/**
 * Daily cron that applies trendingScore decay to all articles.
 * Rate: ×0.9057 per day — halves every 7 days (2^(-1/7) ≈ 0.9057).
 * Skips articles with trendingScore <= 0.1 (effectively zero).
 */
export const cronDecayTrendingScores = onSchedule('every 24 hours', async () => {
  console.log('[Cron] Starting daily trendingScore decay...');
  try {
    const snapshot = await db.collection('articles')
      .where('trendingScore', '>', 0.1)
      .get();

    if (snapshot.empty) {
      console.log('[Cron] No articles with trendingScore > 0.1, nothing to decay.');
      return;
    }

    const batchSize = 500;
    const docs = snapshot.docs;
    let decayed = 0;

    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = db.batch();
      const chunk = docs.slice(i, i + batchSize);
      chunk.forEach(doc => {
        const current = doc.data().trendingScore as number;
        const newScore = Math.max(0, current * TRENDING_DECAY_RATE);
        batch.update(doc.ref, { trendingScore: newScore });
        decayed++;
      });
      await batch.commit();
    }

    console.log(`[Cron] Decayed trendingScore for ${decayed} articles (×${TRENDING_DECAY_RATE})`);
  } catch (error) {
    console.error('[Cron] Error decaying trending scores:', error);
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
          return candidateCacheMixed;
        } else {
          candidateCacheCurrent = data.articles as Article[];
          cacheTimestampCurrent = data.generatedAt || now;
          return candidateCacheCurrent;
        }
      }
    }
  } catch (err) {
    console.error(`[Cache] Failed to fetch ${docName}, falling back to on-the-fly generation:`, err);
  }

  console.log('[Cache] Fallback triggered. Querying stratified buckets on-the-fly...');
  try {
    const fourWeeksAgo = Date.now() - (4 * 7 * 24 * 60 * 60 * 1000);

    const freshSnapshot = await db
      .collection('articles')
      .where('publishDate', '>=', fourWeeksAgo)
      .orderBy('publishDate', 'desc')
      .limit(2000)
      .get();

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

    shuffleArray(freshArticles);
    shuffleArray(archiveArticles);

    const articlesMap = new Map<string, Article>();
    [...freshArticles.slice(0, 500), ...archiveArticles.slice(0, 500)].forEach(a => {
      articlesMap.set(a.id, a);
    });

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
        const pubKey = (data.name && typeof data.name === 'string') ? data.name : doc.id;
        tempQualities[pubKey] = Math.max(0.2, Math.min(1.0, data.qualityScore));
      }
    });
    publisherQualityCache = tempQualities;
    publisherCacheTimestamp = now;
    console.log(`[Cache] Loaded live dynamic quality scores for ${Object.keys(publisherQualityCache).length} publishers`);
    return publisherQualityCache;
  } catch (err: any) {
    console.error('[Cache] Failed to load publisher quality scores, falling back to old cache:', err.message);
    return publisherQualityCache;
  }
}

/**
 * Feed Assembly via Tranches
 *
 * Articles are bucketed by P (personalization fraction):
 *   High  (P >= 0.40): 12 articles — random selection, personalized formula score for tiebreaking
 *   Mid   (P >= 0.20): 8 articles  — random selection, personalized formula score for tiebreaking
 *   Low   (P >= 0.10): 4 articles  — sorted by merit score (R+T+Q)
 *   Discovery (P < 0.10): 6 articles — sorted by merit score (R+T+Q)
 *
 * High/Mid use random selection to give variety within preferred categories.
 * Low/Discovery use score-sorted selection to surface the best merit-based articles.
 */
function assembleFeedWithTranches(
  scoredList: { article: Article; personalizedScore: number; meritScore: number; pNorm: number }[],
  totalSize = 30,
  totalArticlesRead = 0
): Article[] {
  if (scoredList.length === 0) return [];

  const highBucket: typeof scoredList = [];
  const midBucket: typeof scoredList = [];
  const lowBucket: typeof scoredList = [];
  const discoveryBucket: typeof scoredList = [];

  for (const item of scoredList) {
    if (item.pNorm >= 0.40) {
      highBucket.push(item);
    } else if (item.pNorm >= 0.20) {
      midBucket.push(item);
    } else if (item.pNorm >= 0.10) {
      lowBucket.push(item);
    } else {
      discoveryBucket.push(item);
    }
  }

  const finalFeed: Article[] = [];
  let remainingCount = totalSize;

  let targetHigh = 12;
  let targetMid = 8;
  let targetLow = 4;
  let targetDiscovery = 6;

  // High Tranche — random selection (variety within preferred categories)
  shuffleArray(highBucket);
  const pickedHigh = highBucket.slice(0, Math.min(highBucket.length, targetHigh)).map(s => s.article);
  finalFeed.push(...pickedHigh);
  remainingCount -= pickedHigh.length;
  if (pickedHigh.length < targetHigh) targetMid += (targetHigh - pickedHigh.length);

  // Mid Tranche — random selection
  shuffleArray(midBucket);
  const pickedMid = midBucket.slice(0, Math.min(midBucket.length, targetMid)).map(s => s.article);
  finalFeed.push(...pickedMid);
  remainingCount -= pickedMid.length;
  if (pickedMid.length < targetMid) targetLow += (targetMid - pickedMid.length);

  // Low Tranche — sorted by merit score (R+T+Q), or randomized for new users
  if (totalArticlesRead < 30) {
    shuffleArray(lowBucket);
  } else {
    lowBucket.sort((a, b) => b.meritScore - a.meritScore);
  }
  const pickedLow = lowBucket.slice(0, Math.min(lowBucket.length, targetLow)).map(s => s.article);
  finalFeed.push(...pickedLow);
  remainingCount -= pickedLow.length;
  if (pickedLow.length < targetLow) targetDiscovery += (targetLow - pickedLow.length);

  // Discovery Tranche — sorted by merit score (R+T+Q), or randomized for new users
  if (totalArticlesRead < 30) {
    shuffleArray(discoveryBucket);
  } else {
    discoveryBucket.sort((a, b) => b.meritScore - a.meritScore);
  }
  const pickedDiscovery = discoveryBucket.slice(0, Math.min(discoveryBucket.length, targetDiscovery)).map(s => s.article);
  finalFeed.push(...pickedDiscovery);
  remainingCount -= pickedDiscovery.length;

  // Final fallback if pool was very small
  if (remainingCount > 0) {
    const usedIds = new Set(finalFeed.map(a => a.id));
    const leftovers = scoredList.filter(s => !usedIds.has(s.article.id));
    leftovers.sort((a, b) => b.meritScore - a.meritScore);
    finalFeed.push(...leftovers.slice(0, remainingCount).map(s => s.article));
  }

  // Final shuffle so order is not predictable
  shuffleArray(finalFeed);

  console.log(`[Tranche Selector] High: ${pickedHigh.length}, Mid: ${pickedMid.length}, Low: ${pickedLow.length}, Discovery: ${pickedDiscovery.length}`);

  return finalFeed;
}

export const getRankedFeed = onCall(async (request): Promise<RankedFeedResult> => {
  // P0 Security: Always use the verified auth UID, never the client-supplied userId.
  if (!request.auth) {
    throw new Error('unauthenticated');
  }
  const userId = request.auth.uid;
  const { seenArticleIds } = request.data as { userId?: string; seenArticleIds: string[] };
  console.log(`[getRankedFeed] userId: ${userId}, seen limit: ${(seenArticleIds || []).length}`);

  let categoryWeights: Record<string, number> = {};
  let categoryLengthWeights: Record<string, number> = {};
  let publisherWeights: Record<string, number> = {};
  let includeArchivedArticles = false;
  let totalArticlesRead = 0;
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      const data = userDoc.data() as UserProfile;
      categoryWeights = data.categoryWeights || {};
      categoryLengthWeights = data.categoryLengthWeights || {};
      publisherWeights = data.publisherWeights || {};
      includeArchivedArticles = data.includeArchivedArticles || false;
      totalArticlesRead = data.totalArticlesRead || 0;
    }
  } catch (err) {
    console.warn('[getRankedFeed] Could not fetch user profile');
  }

  try {
    const pool = await getOrUpdateCandidatePool(includeArchivedArticles);

    if (pool.length === 0) {
      return { articles: [], generatedAt: Date.now(), remainingCount: 0 };
    }

    const publisherQualities = await getOrUpdatePublisherQualities();

    const seenSet = new Set(seenArticleIds || []);
    const unseenArticles = pool.filter(article => !seenSet.has(article.id));

    // Count how many articles from each publisher are in the unseen pool (for U diversity)
    const pubCounts: Record<string, number> = {};
    unseenArticles.forEach((a) => {
      pubCounts[a.publicationName] = (pubCounts[a.publicationName] || 0) + 1;
    });

    const scored = unseenArticles.map((article) => {
      const daysOld = Math.max(0, (Date.now() - article.publishDate) / (1000 * 60 * 60 * 24));

      // Look up weights — use categoryLengthWeights first (most specific), fall back to category weight
      const compKey = `${article.category}::${article.lengthStyle}`;
      const catWeight = categoryLengthWeights[compKey] ?? categoryWeights[article.category] ?? 1.0;
      const pubWeight = publisherWeights[article.publicationName] ?? 1.0;

      const rawQuality = publisherQualities[article.publicationName] ?? article.qualityScore ?? 0.8;
      const pubCount = pubCounts[article.publicationName] || 1;

      // Normalize all components to [0, 1]
      const P = normalizeP(catWeight, pubWeight);
      const T = normalizeT(article.trendingScore || 0);
      const R = normalizeR(daysOld);
      const Q = normalizeQ(rawQuality);
      const U = normalizeU(pubCount);

      const personalizedScore = scorePersonalized(P, T, R, Q, U);
      const meritScore = scoreMerit(T, R, Q);

      return { article, personalizedScore, meritScore, pNorm: P };
    });

    const finalFeed = assembleFeedWithTranches(scored, RETURN_FEED_SIZE, totalArticlesRead);

    // Debug logging for top 5 scored articles
    console.log(`[getRankedFeed] --- Top 5 by personalized score ---`);
    [...scored].sort((a, b) => b.personalizedScore - a.personalizedScore).slice(0, 5).forEach((s, i) => {
      const daysOld = Math.max(0, (Date.now() - s.article.publishDate) / (1000 * 60 * 60 * 24));
      const compKey = `${s.article.category}::${s.article.lengthStyle}`;
      const catWeight = categoryLengthWeights[compKey] ?? categoryWeights[s.article.category] ?? 1.0;
      const pubWeight = publisherWeights[s.article.publicationName] ?? 1.0;
      const rawQuality = publisherQualities[s.article.publicationName] ?? s.article.qualityScore ?? 0.8;
      const pubCount = pubCounts[s.article.publicationName] || 1;
      const P = normalizeP(catWeight, pubWeight);
      const T = normalizeT(s.article.trendingScore || 0);
      const R = normalizeR(daysOld);
      const Q = normalizeQ(rawQuality);
      const U = normalizeU(pubCount);
      console.log(
        `  #${i + 1} "${s.article.title.substring(0, 50)}..." ` +
        `pScore=${s.personalizedScore.toFixed(3)} mScore=${s.meritScore.toFixed(3)} ` +
        `P=${P.toFixed(2)} T=${T.toFixed(2)} R=${R.toFixed(2)} Q=${Q.toFixed(2)} U=${U.toFixed(2)}`
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
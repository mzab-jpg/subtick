// SubTick — getRankedFeed (HTTPS Callable)
// Normalized 5-component scoring formula, cached, time-stratified,
// with per-tranche formulas and daily trending score decay.
// ============================================================

import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { db } from './firebaseAdmin.js';
import { randomUUID } from 'crypto';
import { Article, ArticleScoreDetail, RankedFeedResult, UserProfile } from './types.js';
import {
  SCORE_WEIGHTS,
  SCORE_WEIGHTS_TAIL,
  MAX_TRENDING_SCORE,
} from './constants.js';
import { gaApiSecret, sendGAEvents } from './analytics.js';
import { loadScoringConfig, prepareConfig, ScoringConfig } from './scoringConfig.js';

// --- Configuration ---
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
 * Known publishers use 60% category and 40% publisher. A publisher with no
 * stored interaction history uses the configurable cold-start blend instead.
 *
 * A neutral user (all weights = 1.0) gets P ≈ 0.18.
 * Max possible (both weights = 5.0) gets P = 1.0.
 */
function normalizeP(
  categoryWeight: number,
  publisherWeight: number,
  categoryShare: number = 0.6,
  publisherShare: number = 0.4
): number {
  const MIN_W = 0.1;
  const MAX_W = 5.0;
  const RANGE = MAX_W - MIN_W; // 4.9
  const catFraction = Math.max(0, Math.min(1, (categoryWeight - MIN_W) / RANGE));
  const pubFraction = Math.max(0, Math.min(1, (publisherWeight - MIN_W) / RANGE));
  return catFraction * categoryShare + pubFraction * publisherShare;
}

function getUserStage(totalArticlesRead: number, lastReadDate: number, now: number): 'new' | 'learning' | 'established' | 'inactive_returning' {
  const daysSinceLastRead = lastReadDate > 0 ? Math.floor((now - lastReadDate) / (24 * 60 * 60 * 1000)) : null;
  if (totalArticlesRead > 0 && daysSinceLastRead !== null && daysSinceLastRead >= 14) return 'inactive_returning';
  if (totalArticlesRead <= 2) return 'new';
  if (totalArticlesRead <= 14) return 'learning';
  return 'established';
}

function getProfileConcentration(categoryWeights: Record<string, number>): number {
  const weights = Object.values(categoryWeights).filter((weight) => Number.isFinite(weight) && weight > 0);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return total > 0 ? weights.reduce((sum, weight) => sum + Math.pow(weight / total, 2), 0) : 0;
}

function getPersonalizationScore(
  categoryWeight: number,
  publisherName: string,
  publisherWeights: Record<string, number>,
  cfg: ScoringConfig
): number {
  const hasPublisherHistory = Object.prototype.hasOwnProperty.call(publisherWeights, publisherName);
  const publisherWeight = publisherWeights[publisherName] ?? 1.0;
  return normalizeP(
    categoryWeight,
    publisherWeight,
    hasPublisherHistory ? 0.6 : cfg.scoring.publisherColdStartCategoryWeight,
    hasPublisherHistory ? 0.4 : cfg.scoring.publisherColdStartPublisherWeight
  );
}

/**
 * T — Trending [0, 1]
 * Normalized trendingScore capped at MAX_TRENDING_SCORE (50).
 * Score of 0 → T = 0.0 (new article).
 * Score of 50+ → T = 1.0 (very viral).
 */
function normalizeT(trendingScore: number, maxScale: number = MAX_TRENDING_SCORE): number {
  return Math.min(trendingScore, maxScale) / maxScale;
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
 * Composite score for High/Mid tranches (personalized formula):
 * Score = 0.60P + 0.15T + 0.10R + 0.15Q
 * All inputs must be normalized [0, 1]. Output is [0, 1].
 * Diversity is enforced by a hard per-publisher cap during feed assembly.
 */
function scorePersonalized(
  P: number,
  T: number,
  R: number,
  Q: number,
  w: { personalization: number; trending: number; recency: number; quality: number } = SCORE_WEIGHTS
): number {
  return w.personalization * P + w.trending * T + w.recency * R + w.quality * Q;
}

/**
 * Tail score for the Tail tranche (trending + recency only).
 * No personalization or quality.
 * Score = 0.43T + 0.57R. Output is [0, 1].
 */
function scoreTail(
  T: number,
  R: number,
  w: { trending: number; recency: number } = SCORE_WEIGHTS_TAIL
): number {
  return w.trending * T + w.recency * R;
}

/**
 * Runs a capped Firestore query using random_score to retrieve a truly random,
 * cost-controlled sample of articles. Uses circular wrap-around to guarantee
 * the target count is always met regardless of where the random threshold lands.
 *
 * random_score is a [0,1) float assigned on ingestion and refreshed daily by
 * cronDecayTrendingScores at zero extra cost, ensuring the pool content changes
 * on every cron run without any additional database reads.
 *
 * @param fresh - If true, queries articles published within the last 28 days.
 * @param currentOnly - If true, restricts to rssStatus == 'current' (Box 1).
 *                      If false, no status filter (Box 2 — active + archived naturally included).
 * @param threshold - The random starting point [0,1).
 * @param limit - Maximum number of articles to return.
 */
async function queryRandomSample(
  fresh: boolean,
  currentOnly: boolean,
  threshold: number,
  limit: number
): Promise<Article[]> {
  const now = Date.now();
  const fourWeeksAgo = now - 4 * 7 * 24 * 60 * 60 * 1000;
  const results: Article[] = [];

  // Firestore limitation: cannot have range filters on multiple fields.
  // We query by random_score only (single range filter), then filter
  // publishDate (fresh vs old) in memory. Fetch 3x the limit to ensure
  // enough articles survive the in-memory publishDate filter.
  const fetchCap = limit * 3;

  const runQuery = async (scoreMin: number, scoreMax: number | null, cap: number) => {
    try {
      let q = db.collection('articles')
        .where('isPaywalled', '==', false)
        .where('random_score', '>=', scoreMin);
      if (scoreMax !== null) {
        q = (q as any).where('random_score', '<', scoreMax);
      }
      if (currentOnly) {
        q = (q as any).where('rssStatus', '==', 'current');
      }
      const snap = await (q as any).orderBy('random_score', 'asc').limit(cap).get();
      snap.forEach((doc: any) => {
        const data = doc.data() as Article;
        // In-memory publishDate filter (fresh vs old)
        const isFresh = data.publishDate >= fourWeeksAgo;
        if (fresh !== isFresh) return;
        if (data.wordCount === undefined || data.wordCount >= 150) {
          results.push({ ...data, id: doc.id });
        }
      });
    } catch (e) {
      console.warn('[CandidatePool] Query failed (fresh=%s, currentOnly=%s):', fresh, currentOnly, e);
    }
  };

  // First pass: random_score from threshold up to 1.0
  await runQuery(threshold, null, fetchCap);

  // Circular wrap-around: if we still need more, query from 0.0 up to threshold
  if (results.length < limit) {
    const existingIds = new Set(results.map(a => a.id));
    const remaining = (limit - results.length) * 3;
    const wrapResults: Article[] = [];
    try {
      let q = db.collection('articles')
        .where('isPaywalled', '==', false)
        .where('random_score', '>=', 0)
        .where('random_score', '<', threshold);
      if (currentOnly) {
        q = (q as any).where('rssStatus', '==', 'current');
      }
      const wrapSnap = await (q as any).orderBy('random_score', 'asc').limit(remaining).get();
      wrapSnap.forEach((doc: any) => {
        if (!existingIds.has(doc.id)) {
          const data = doc.data() as Article;
          const isFresh = data.publishDate >= fourWeeksAgo;
          if (fresh !== isFresh) return;
          if (data.wordCount === undefined || data.wordCount >= 150) {
            wrapResults.push({ ...data, id: doc.id });
          }
        }
      });
    } catch (e) {
      console.warn('[CandidatePool] Wrap-around query failed:', e);
    }
    results.push(...wrapResults);
  }

  // Trim to requested limit (we may have fetched more than needed)
  return results.slice(0, limit);
}

/**
 * Cron task that runs every 6 hours to build the universal "candidate pool" boxes.
 *
 * Uses random_score (refreshed daily by cronDecayTrendingScores at zero extra cost) for
 * cheap, truly random sampling without scanning the full articles collection.
 *
 * Cost: 4 capped queries × up to 500 docs = max ~2,000 reads per run (plus wrap-around
 * if needed), regardless of total database size. Free at virtually any scale.
 *
 * Box 1 (candidatePool_current): 500 fresh active + 500 old active articles.
 * Box 2 (candidatePool_mixed):   500 fresh any-status + 500 old any-status articles.
 *   Box 2 does NOT deliberately target archived articles — it simply does not exclude them,
 *   so the pool expands naturally to include the full article history proportionally.
 */
export const cronUpdateCandidatePool = onSchedule('every 6 hours', async () => {
  console.log('[Cron] Starting dual candidate pool generation (Current vs Mixed)...');
  try {
    const now = Date.now();
    // Single random threshold shared across all 4 queries this run.
    // Changes on every invocation so the pool content is always different.
    const threshold = Math.random();
    console.log(`[Cron] Using random_score threshold: ${threshold.toFixed(6)}`);

    // Run all 4 queries in parallel for speed
    const [freshCurrent, oldCurrent, freshMixed, oldMixed] = await Promise.all([
      queryRandomSample(true,  true,  threshold, 500),  // Fresh active  (Box 1)
      queryRandomSample(false, true,  threshold, 500),  // Old active    (Box 1)
      queryRandomSample(true,  false, threshold, 500),  // Fresh any     (Box 2)
      queryRandomSample(false, false, threshold, 500),  // Old any       (Box 2)
    ]);

    // Box 1: strictly active articles only, 50/50 fresh/old split
    const boxCurrent = [...freshCurrent, ...oldCurrent];

    // Box 2: any-status articles (active + archived naturally included), 50/50 fresh/old split
    const boxMixed = [...freshMixed, ...oldMixed];

    await db.collection('system').doc('candidatePool_current').set({
      articles: boxCurrent,
      generatedAt: now,
    });

    await db.collection('system').doc('candidatePool_mixed').set({
      articles: boxMixed,
      generatedAt: now,
    });

    console.log(
      `[Cron] Dual boxes written. ` +
      `Current: ${boxCurrent.length} (${freshCurrent.length} fresh + ${oldCurrent.length} old), ` +
      `Mixed: ${boxMixed.length} (${freshMixed.length} fresh + ${oldMixed.length} old)`
    );
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
  const cfgDecay = await loadScoringConfig();
  const decayRate = cfgDecay.trending.decayRate;
  try {
    // C1 Fix: Raised threshold from 0.1 to 1.0.
    // Articles with trendingScore < 1.0 are effectively zero-signal — decaying them
    // does not meaningfully change rankings but wastes ~70% of the daily write budget.
    const snapshot = await db.collection('articles')
      .where('trendingScore', '>', 1.0)
      .get();

    if (snapshot.empty) {
      console.log('[Cron] No articles with trendingScore > 1.0, nothing to decay.');
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
        const newScore = Math.max(0, current * decayRate);
        // Refresh random_score on every daily decay pass at zero extra cost.
        // This ensures cronUpdateCandidatePool always picks a genuinely fresh,
        // non-repetitive random cross-section of the database on every run.
        batch.update(doc.ref, { trendingScore: newScore, random_score: Math.random() });
        decayed++;
      });
      await batch.commit();
    }

    console.log(`[Cron] Decayed trendingScore for ${decayed} articles (×${decayRate})`);
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
      if (
        !data.isPaywalled &&
        (includeArchived || data.rssStatus === 'current') &&
        (data.wordCount === undefined || data.wordCount >= 150)
      ) {
        freshArticles.push({ ...data, id: doc.id });
      }
    });

    const archiveArticles: Article[] = [];
    qualitySnapshot.forEach((doc) => {
      const data = doc.data() as Article;
      if (
        !data.isPaywalled &&
        (includeArchived || data.rssStatus === 'current') &&
        (data.wordCount === undefined || data.wordCount >= 150)
      ) {
        archiveArticles.push({ ...data, id: doc.id });
      }
    });

    shuffleArray(freshArticles);
    shuffleArray(archiveArticles);

    const articlesMap = new Map<string, Article>();
    [...freshArticles.slice(0, 500), ...archiveArticles.slice(0, 500)].forEach(a => {
      articlesMap.set(a.id, a);
    });

    const rebuiltPool = Array.from(articlesMap.values());
    if (includeArchived) {
      candidateCacheMixed = rebuiltPool;
      cacheTimestampMixed = now;
    } else {
      candidateCacheCurrent = rebuiltPool;
      cacheTimestampCurrent = now;
    }
    console.log(`[Cache] Fallback rebuilt ${includeArchived ? 'mixed' : 'current'} candidate pool. Total articles: ${rebuiltPool.length}`);
    return rebuiltPool;
  } catch (error) {
    console.error('[Cache] Fallback error building candidate pool:', error);
    const expiredCache = includeArchived ? candidateCacheMixed : candidateCacheCurrent;
    if (expiredCache.length > 0) {
      console.warn(`[Cache] Falling back to expired ${includeArchived ? 'mixed' : 'current'} in-memory pool`);
      return expiredCache;
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
 * Articles are scored with the 4-component formula (0.60P + 0.15T +
 * 0.10R + 0.15Q) and then bucketed by that score:
 *   High  (fullScore > 0.40): 12 articles — random selection, max 5 per publisher
 *   Mid   (fullScore > 0.20): 8 articles  — random selection, max 5 per publisher
 *   Tail  (fullScore ≤ 0.20): 10 articles — sorted by tailScore (T+R), max 5 per publisher
 *
 * A hard per-publisher cap of 5 articles ensures feed diversity regardless
 * of how many articles a single publisher has in the candidate pool.
 * Overflow cascades down when capped articles are skipped.
 */
export function interleaveArticlesByCategory<T extends { category: string }>(articles: T[]): T[] {
  const remainingByCategory = new Map<string, T[]>();
  for (const article of articles) {
    const category = article.category || 'Uncategorized';
    const group = remainingByCategory.get(category) || [];
    group.push(article);
    remainingByCategory.set(category, group);
  }

  const result: T[] = [];
  let lastCategory = '';
  let consecutiveCount = 0;

  while (result.length < articles.length) {
    const available = Array.from(remainingByCategory.entries()).filter(([, group]) => group.length > 0);
    const alternatives = consecutiveCount >= 2
      ? available.filter(([category]) => category !== lastCategory)
      : available;
    // A run beyond two is unavoidable only when every remaining item has the
    // same category. Choose the largest remaining group to avoid leaving a
    // single-category tail when a better interleave is possible.
    const candidates = alternatives.length > 0 ? alternatives : available;
    const largestSize = Math.max(...candidates.map(([, group]) => group.length));
    const largestGroups = candidates.filter(([, group]) => group.length === largestSize);
    const [category, group] = largestGroups[Math.floor(Math.random() * largestGroups.length)];
    const article = group.shift();
    if (!article) continue;

    result.push(article);
    if (category === lastCategory) {
      consecutiveCount += 1;
    } else {
      lastCategory = category;
      consecutiveCount = 1;
    }
  }

  return result;
}

/**
 * Keeps the already-randomized feed varied without changing its membership.
 * The optional first article is fixed (the Dashboard hero). Every following
 * position prefers a publisher that was not used in the preceding `spacing`
 * cards. If every remaining card would repeat a recent publisher, the earliest
 * remaining card is used so a publisher-skewed pool can still be fully served.
 */
export function spaceArticlesByPublisher<T extends { id: string; publicationName: string }>(
  articles: T[],
  spacing = 3,
  fixedFirstArticleId?: string
): T[] {
  if (articles.length <= 1 || spacing < 1) return [...articles];

  const remaining = [...articles];
  const result: T[] = [];
  if (fixedFirstArticleId) {
    const fixedIndex = remaining.findIndex((article) => article.id === fixedFirstArticleId);
    if (fixedIndex >= 0) result.push(remaining.splice(fixedIndex, 1)[0]);
  }

  while (remaining.length > 0) {
    const recentPublishers = new Set(
      result.slice(Math.max(0, result.length - spacing)).map((article) => article.publicationName)
    );
    const eligibleIndex = remaining.findIndex((article) => !recentPublishers.has(article.publicationName));
    result.push(remaining.splice(eligibleIndex >= 0 ? eligibleIndex : 0, 1)[0]);
  }

  return result;
}

export function assembleFeedWithTranches(
  scoredList: { article: Article; fullScore: number; tailScore: number }[],
  totalSize = 30,
  totalArticlesRead = 0,
  opts: {
    highThreshold?: number;
    midThreshold?: number;
    highSize?: number;
    midSize?: number;
    tailSize?: number;
    publisherCap?: number;
    newUserThreshold?: number;
    maxArticlesPerCategory?: number;
    minDistinctCategories?: number;
  } = {}
): Article[] {
  const {
    highThreshold = 0.40,
    midThreshold = 0.20,
    highSize = 12,
    midSize = 8,
    tailSize = 10,
    publisherCap = 5,
    newUserThreshold = 30,
    maxArticlesPerCategory = 15,
    minDistinctCategories = 4,
  } = opts;
  if (scoredList.length === 0) return [];

  const highBucket: typeof scoredList = [];
  const midBucket: typeof scoredList = [];
  const tailBucket: typeof scoredList = [];

  for (const item of scoredList) {
    if (item.fullScore > highThreshold) {
      highBucket.push(item);
    } else if (item.fullScore > midThreshold) {
      midBucket.push(item);
    } else {
      tailBucket.push(item);
    }
  }

  const PUB_CAP = publisherCap;
  const pubCountsInFeed = new Map<string, number>();
  const categoryCountsInFeed = new Map<string, number>();
  const finalFeed: Article[] = [];
  let remainingCount = totalSize;

  // Helper: iterate a shuffled (or sorted) bucket, pick articles respecting the
  // per-publisher cap, and return how many were picked.
  function pickFromBucket(
    bucket: typeof scoredList,
    target: number,
    enforceCategoryCap = true
  ): Article[] {
    const picked: Article[] = [];
    for (const item of bucket) {
      if (picked.length >= target) break;
      const pub = item.article.publicationName;
      const current = pubCountsInFeed.get(pub) || 0;
      const category = item.article.category || 'Uncategorized';
      const categoryCount = categoryCountsInFeed.get(category) || 0;
      if (current >= PUB_CAP) continue;
      if (enforceCategoryCap && categoryCount >= maxArticlesPerCategory) continue;
      pubCountsInFeed.set(pub, current + 1);
      categoryCountsInFeed.set(category, categoryCount + 1);
      picked.push(item.article);
    }
    return picked;
  }

  let targetHigh = highSize;
  let targetMid = midSize;
  let targetTail = tailSize;

  // Reserve the opening card for the strongest eligible article, regardless of
  // tranche. Every other slot remains randomized/category-varied, so this keeps
  // the intended discovery mix rather than making the feed deterministic.
  let startupAnchorId: string | undefined;
  const startupAnchor = [...scoredList].sort((a, b) => b.fullScore - a.fullScore)[0];
  const pickedHigh: Article[] = [];
  const pickedMid: Article[] = [];
  const pickedTail: Article[] = [];
  if (startupAnchor) {
    const anchorArticle = startupAnchor.article;
    const anchorCategory = anchorArticle.category || 'Uncategorized';
    pubCountsInFeed.set(anchorArticle.publicationName, 1);
    categoryCountsInFeed.set(anchorCategory, 1);
    startupAnchorId = anchorArticle.id;

    if (startupAnchor.fullScore > highThreshold && targetHigh > 0) {
      pickedHigh.push(anchorArticle);
      highBucket.splice(highBucket.indexOf(startupAnchor), 1);
    } else if (startupAnchor.fullScore > midThreshold && targetMid > 0) {
      pickedMid.push(anchorArticle);
      midBucket.splice(midBucket.indexOf(startupAnchor), 1);
    } else if (targetTail > 0) {
      pickedTail.push(anchorArticle);
      tailBucket.splice(tailBucket.indexOf(startupAnchor), 1);
    }
  }

  // High Tranche — random selection for every remaining slot, respecting caps.
  shuffleArray(highBucket);
  pickedHigh.push(...pickFromBucket(highBucket, Math.max(0, targetHigh - pickedHigh.length)));
  finalFeed.push(...pickedHigh);
  remainingCount -= pickedHigh.length;
  if (pickedHigh.length < targetHigh) targetMid += (targetHigh - pickedHigh.length);

  // Mid Tranche — random selection for every remaining slot, respecting caps.
  shuffleArray(midBucket);
  pickedMid.push(...pickFromBucket(midBucket, Math.max(0, targetMid - pickedMid.length)));
  finalFeed.push(...pickedMid);
  remainingCount -= pickedMid.length;
  if (pickedMid.length < targetMid) targetTail += (targetMid - pickedMid.length);

  // Tail — sorted by tailScore (T+R), or randomized for new users
  if (totalArticlesRead < newUserThreshold) {
    shuffleArray(tailBucket);
  } else {
    tailBucket.sort((a, b) => b.tailScore - a.tailScore);
  }
  pickedTail.push(...pickFromBucket(tailBucket, Math.max(0, targetTail - pickedTail.length)));
  finalFeed.push(...pickedTail);
  remainingCount -= pickedTail.length;

  // Final fallback if pool was very small
  if (remainingCount > 0) {
    const usedIds = new Set(finalFeed.map(a => a.id));
    const leftovers = scoredList.filter(s => !usedIds.has(s.article.id));
    leftovers.sort((a, b) => b.tailScore - a.tailScore);
    const pickedLeftovers = pickFromBucket(leftovers, remainingCount);
    finalFeed.push(...pickedLeftovers);
    // If every eligible remaining article is already at the category cap, relax
    // only that cap so a small/skewed pool still returns a full feed.
    if (pickedLeftovers.length < remainingCount) {
      const usedIdsAfterCap = new Set(finalFeed.map(a => a.id));
      const relaxedLeftovers = scoredList
        .filter(s => !usedIdsAfterCap.has(s.article.id))
        .sort((a, b) => b.tailScore - a.tailScore);
      finalFeed.push(...pickFromBucket(relaxedLeftovers, remainingCount - pickedLeftovers.length, false));
    }
  }

  // When eligible alternatives exist, replace an overrepresented category item
  // with the strongest missing category candidate. This preserves feed size,
  // uniqueness, and publisher caps while meeting the minimum-category goal.
  const usedIds = new Set(finalFeed.map(article => article.id));
  const distinctCategories = new Set(finalFeed.map(article => article.category || 'Uncategorized'));
  const categoryCounts = new Map<string, number>();
  for (const article of finalFeed) {
    const category = article.category || 'Uncategorized';
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
  }
  const publisherCounts = new Map<string, number>();
  for (const article of finalFeed) {
    publisherCounts.set(article.publicationName, (publisherCounts.get(article.publicationName) || 0) + 1);
  }
  const replacementCandidates = [...scoredList].sort((a, b) => b.fullScore - a.fullScore);
  while (distinctCategories.size < minDistinctCategories) {
    const candidate = replacementCandidates.find(({ article }) =>
      !usedIds.has(article.id) &&
      !distinctCategories.has(article.category || 'Uncategorized') &&
      (publisherCounts.get(article.publicationName) || 0) < PUB_CAP
    );
    if (!candidate) break;

    let replaceIndex = -1;
    let replaceScore = Number.POSITIVE_INFINITY;
    for (let index = 0; index < finalFeed.length; index += 1) {
      const article = finalFeed[index];
      const category = article.category || 'Uncategorized';
      if (article.id === startupAnchorId || (categoryCounts.get(category) || 0) <= 1) continue;
      const score = scoredList.find(s => s.article.id === article.id)?.fullScore ?? 0;
      if (score < replaceScore) {
        replaceScore = score;
        replaceIndex = index;
      }
    }
    if (replaceIndex < 0) break;

    const removed = finalFeed[replaceIndex];
    const removedCategory = removed.category || 'Uncategorized';
    categoryCounts.set(removedCategory, (categoryCounts.get(removedCategory) || 1) - 1);
    publisherCounts.set(removed.publicationName, (publisherCounts.get(removed.publicationName) || 1) - 1);
    usedIds.delete(removed.id);

    finalFeed[replaceIndex] = candidate.article;
    const candidateCategory = candidate.article.category || 'Uncategorized';
    categoryCounts.set(candidateCategory, (categoryCounts.get(candidateCategory) || 0) + 1);
    publisherCounts.set(candidate.article.publicationName, (publisherCounts.get(candidate.article.publicationName) || 0) + 1);
    usedIds.add(candidate.article.id);
    distinctCategories.add(candidateCategory);
    if ((categoryCounts.get(removedCategory) || 0) === 0) distinctCategories.delete(removedCategory);
  }

  // Preserve variety without letting the final random order create topic fatigue.
  // This only changes display order; selection, scores, and publisher caps are final.
  const categoryInterleavedFeed = interleaveArticlesByCategory(finalFeed);

  // Interleaving is intentionally random/category-aware, but the Dashboard hero
  // must make a strong first impression. Move the reserved highest-scoring card
  // to index 0, then repair publisher repetition without changing membership.
  const anchorIndex = startupAnchorId
    ? categoryInterleavedFeed.findIndex(article => article.id === startupAnchorId)
    : -1;
  const heroFirstFeed = anchorIndex > 0
    ? [categoryInterleavedFeed[anchorIndex], ...categoryInterleavedFeed.filter((_, index) => index !== anchorIndex)]
    : categoryInterleavedFeed;
  const orderedFeed = spaceArticlesByPublisher(heroFirstFeed, 3, startupAnchorId);

  console.log(`[Tranche Selector] High: ${pickedHigh.length}, Mid: ${pickedMid.length}, Tail: ${pickedTail.length}`);

  return orderedFeed;
}

/**
 * Cron that runs every 3 days to delete old low-quality articles.
 * Deletes the bottom 3% of articles older than 3 months,
 * ranked by peakTrendingScore (ascending).
 * This keeps the database bounded and within Firestore free tier.
 * Saved articles are NOT protected — users have their own copy in
 * users/{uid}/saved_articles/ subcollection.
 *
 * Note: Cloud Scheduler requires an explicit unit. "every 3 days" is rejected
 * at deploy time; "every 72 hours" is the valid equivalent.
 */
export const cronCleanupOldArticles = onSchedule('every 72 hours', async () => {
  console.log('[Cron] Starting old article cleanup...');
  try {
    // Step 1: Immediately delete ALL paywalled articles.
    // Paywalled articles are never shown to users and never included in candidate pools.
    // Purging them keeps the collection smaller and reduces query costs for all other crons.
    try {
      const paywallSnap = await db.collection('articles')
        .where('isPaywalled', '==', true)
        .get();

      if (!paywallSnap.empty) {
        const batchSize = 500;
        let paywallDeleted = 0;
        for (let i = 0; i < paywallSnap.docs.length; i += batchSize) {
          const batch = db.batch();
          paywallSnap.docs.slice(i, i + batchSize).forEach(doc => batch.delete(doc.ref));
          await batch.commit();
          paywallDeleted += Math.min(batchSize, paywallSnap.docs.length - i);
        }
        console.log(`[Cron] Deleted ${paywallDeleted} paywalled articles.`);
      } else {
        console.log('[Cron] No paywalled articles to delete.');
      }
    } catch (paywallErr: any) {
      console.warn('[Cron] Paywalled article cleanup failed (non-fatal):', paywallErr.message);
    }

    // Step 2: Delete low-quality old articles (bottom performers older than 3 months).
    //
    // Instead of reading ALL old articles (which grows unbounded and costs
    // proportionally more Firestore reads every cycle), we query the 500
    // worst-scoring candidates directly via a composite index. The result is
    // a fixed 500-read ceiling every 72 hours regardless of collection size.
    const threeMonthsAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);

    const SAMPLE_LIMIT = 500;
    const DELETE_FRACTION = 0.03;

    const snapshot = await db.collection('articles')
      .where('publishDate', '<', threeMonthsAgo)
      .orderBy('peakTrendingScore', 'asc')
      .limit(SAMPLE_LIMIT)
      .get();

    if (snapshot.empty) {
      console.log('[Cron] No articles older than 3 months, nothing to clean.');
      return;
    }

    const oldArticles: { id: string; ref: admin.firestore.DocumentReference; peakTrendingScore: number }[] = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.isPaywalled) return;
      oldArticles.push({
        id: doc.id,
        ref: doc.ref,
        peakTrendingScore: data.peakTrendingScore || data.trendingScore || 0,
      });
    });

    // Already ordered by peakTrendingScore ascending — pick the worst fraction.
    const deleteCount = Math.max(1, Math.floor(oldArticles.length * DELETE_FRACTION));
    const toDelete = oldArticles.slice(0, deleteCount);

    console.log(`[Cron] ${oldArticles.length} old articles sampled. Deleting bottom ${deleteCount}.`);

    const batchSize = 500;
    for (let i = 0; i < toDelete.length; i += batchSize) {
      const batch = db.batch();
      const chunk = toDelete.slice(i, i + batchSize);
      chunk.forEach(({ ref }) => {
        batch.delete(ref);
      });
      await batch.commit();
    }

    console.log(`[Cron] Deleted ${deleteCount} old low-quality articles.`);
  } catch (error) {
    console.error('[Cron] Error during old article cleanup:', error);
  }
});

export const getRankedFeed = onCall({ secrets: [gaApiSecret] }, async (request): Promise<RankedFeedResult> => {
  // P0 Security: Always use the verified auth UID, never the client-supplied userId.
  if (!request.auth) {
    throw new Error('unauthenticated');
  }
  const userId = request.auth.uid;
  const { seenArticleIds, client_id, includeScores, configOverride } = request.data as {
    userId?: string;
    seenArticleIds: string[];
    client_id?: string;
    includeScores?: boolean;
    configOverride?: ScoringConfig;
  };
  // GA4 web-stream client_id (32-hex UUID generated client-side). Never fall back
  // to the Auth UID — analytics.ts will mint a random id if this is missing.
  const clientId = client_id || '';
  console.log(`[getRankedFeed] userId: ${userId}, seen limit: ${(seenArticleIds || []).length}`);

  // Single source of truth for all tunable values (cached ~60s per instance).
  // If the caller supplied a preview config override, use it for THIS request only
  // (no Firestore read, no cache touch). Otherwise load the live cached config.
  const cfg = prepareConfig(configOverride) ?? await loadScoringConfig();

  let categoryWeights: Record<string, number> = {};
  let categoryLengthWeights: Record<string, number> = {};
  let publisherWeights: Record<string, number> = {};
  let includeArchivedArticles = false;
  let totalArticlesRead = 0;
  let lastReadDate = 0;
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      const data = userDoc.data() as UserProfile & { isActive?: boolean };
      if (data.isActive === false) {
        throw new HttpsError('permission-denied', 'This account has been disabled.');
      }
      categoryWeights = data.categoryWeights || {};
      categoryLengthWeights = data.categoryLengthWeights || {};
      publisherWeights = data.publisherWeights || {};
      includeArchivedArticles = data.includeArchivedArticles || false;
      totalArticlesRead = data.totalArticlesRead || 0;
      lastReadDate = data.lastReadDate || 0;
    }
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.warn('[getRankedFeed] Could not fetch user profile');
  }

  try {
    const pool = await getOrUpdateCandidatePool(includeArchivedArticles);

    if (pool.length === 0) {
      return { articles: [], generatedAt: Date.now(), remainingCount: 0 };
    }

    const publisherQualities = await getOrUpdatePublisherQualities();
    const generatedAt = Date.now();
    const feedId = randomUUID();
    const userStage = getUserStage(totalArticlesRead, lastReadDate, generatedAt);
    const daysSinceLastRead = lastReadDate > 0
      ? Math.max(0, Math.floor((generatedAt - lastReadDate) / (24 * 60 * 60 * 1000)))
      : -1;
    const profileConcentration = getProfileConcentration(categoryWeights);

    const seenSet = new Set(seenArticleIds || []);
    // Final defense: neither stale pool documents nor an emergency fallback may
    // expose a webpage-only/archived article unless the user explicitly opted in.
    const unseenArticles = pool.filter(article =>
      !seenSet.has(article.id) && (includeArchivedArticles || article.rssStatus === 'current')
    );

    const scored = unseenArticles.map((article) => {
      const daysOld = Math.max(0, (Date.now() - article.publishDate) / (1000 * 60 * 60 * 24));

      const compKey = `${article.category}::${article.lengthStyle}`;
      const catWeight = categoryLengthWeights[compKey] ?? categoryWeights[article.category] ?? 1.0;
      const rawQuality = publisherQualities[article.publicationName] ?? article.qualityScore ?? 0.8;

      const P = getPersonalizationScore(catWeight, article.publicationName, publisherWeights, cfg);
      const T = normalizeT(article.trendingScore || 0, cfg.scoring.maxTrendingScore);
      const R = normalizeR(daysOld);
      const Q = normalizeQ(rawQuality);

      const fullScore = scorePersonalized(P, T, R, Q, cfg.scoring);
      const tailScore = scoreTail(T, R, {
        trending: cfg.scoring.tailTrending,
        recency: cfg.scoring.tailRecency,
      });

      return { article, fullScore, tailScore };
    });

    const finalFeed = assembleFeedWithTranches(scored, cfg.tranche.feedSize, totalArticlesRead, {
      highThreshold: cfg.tranche.highThreshold,
      midThreshold: cfg.tranche.midThreshold,
      highSize: cfg.tranche.highSize,
      midSize: cfg.tranche.midSize,
      tailSize: cfg.tranche.tailSize,
      publisherCap: cfg.tranche.publisherCap,
      newUserThreshold: cfg.tranche.newUserThreshold,
      maxArticlesPerCategory: cfg.tranche.maxArticlesPerCategory,
      minDistinctCategories: cfg.tranche.minDistinctCategories,
    });

    // B2 Fix: Gate detailed score logging behind the emulator flag so production
    // doesn't ship article titles (PII) and score breakdowns to billable logs.
    if (process.env.FUNCTIONS_EMULATOR === 'true') {
      console.log(`[getRankedFeed] --- Top 5 by fullScore ---`);
      [...scored].sort((a, b) => b.fullScore - a.fullScore).slice(0, 5).forEach((s, i) => {
        const daysOld = Math.max(0, (Date.now() - s.article.publishDate) / (1000 * 60 * 60 * 24));
        const compKey = `${s.article.category}::${s.article.lengthStyle}`;
        const catWeight = categoryLengthWeights[compKey] ?? categoryWeights[s.article.category] ?? 1.0;
        const rawQuality = publisherQualities[s.article.publicationName] ?? s.article.qualityScore ?? 0.8;
        const P = getPersonalizationScore(catWeight, s.article.publicationName, publisherWeights, cfg);
        const T = normalizeT(s.article.trendingScore || 0, cfg.scoring.maxTrendingScore);
        const R = normalizeR(daysOld);
        const Q = normalizeQ(rawQuality);
        console.log(
          `  #${i + 1} "${s.article.title.substring(0, 50)}..." ` +
          `fullScore=${s.fullScore.toFixed(3)} tailScore=${s.tailScore.toFixed(3)} ` +
          `P=${P.toFixed(2)} T=${T.toFixed(2)} R=${R.toFixed(2)} Q=${Q.toFixed(2)}`
        );
      });
    }

    // --- Analytics: article_shown + feed_generated events ---
    // Build a lookup from article ID to its scored entry (includes all component scores).
    const scoredById = new Map<string, (typeof scored)[number]>();
    for (const s of scored) {
      scoredById.set(s.article.id, s);
    }

    // High-fidelity mode: per-article scoring details, returned only when the
    // testing dashboard explicitly asks for them (default behavior unchanged).
    const scoreDetailById = new Map<string, ArticleScoreDetail>();

    // Determine tranche per article in the final feed.
    const feedArticleShownEvents: Array<{ name: string; params: Record<string, any> }> = [];
    const distinctPublishers = new Set<string>();
    const distinctCategories = new Set<string>();

    finalFeed.forEach((article, index) => {
      const s = scoredById.get(article.id);
      if (!s) return;

      distinctPublishers.add(article.publicationName);
      distinctCategories.add(article.category);

      const tranche =
        s.fullScore > cfg.tranche.highThreshold ? 'high' :
        s.fullScore > cfg.tranche.midThreshold ? 'mid' : 'tail';

      // Dominant component: which of the 4 contributes most to fullScore.
      const dayCheck = Math.max(0, (Date.now() - article.publishDate) / (1000 * 60 * 60 * 24));
      const compP = getPersonalizationScore(
        categoryLengthWeights[`${article.category}::${article.lengthStyle}`] ?? categoryWeights[article.category] ?? 1.0,
        article.publicationName,
        publisherWeights,
        cfg
      );
      const compT = normalizeT(article.trendingScore || 0, cfg.scoring.maxTrendingScore);
      const compR = normalizeR(dayCheck);
      const compQ = normalizeQ(publisherQualities[article.publicationName] ?? article.qualityScore ?? 0.8);
      const contributions: [string, number][] = [
        ['P', cfg.scoring.personalization * compP],
        ['T', cfg.scoring.trending * compT],
        ['R', cfg.scoring.recency * compR],
        ['Q', cfg.scoring.quality * compQ],
      ];
      const dominantComponent = contributions.reduce((a, b) => (b[1] > a[1] ? b : a))[0];

      if (includeScores) {
        scoreDetailById.set(article.id, {
          scoreP: compP,
          scoreT: compT,
          scoreR: compR,
          scoreQ: compQ,
          finalScore: s.fullScore,
          tranche,
          dominant: dominantComponent as 'P' | 'T' | 'R' | 'Q',
        });
      }

      const impressionId = `${feedId}:${index}`;
      const hasPublisherHistory = Object.prototype.hasOwnProperty.call(publisherWeights, article.publicationName);
      const categoryWeight = categoryLengthWeights[`${article.category}::${article.lengthStyle}`]
        ?? categoryWeights[article.category]
        ?? 1.0;
      // A neutral category has no expressed onboarding preference or learned signal yet.
      const isDiscoveryCategory = Math.abs(categoryWeight - 1.0) < 0.0001;

      feedArticleShownEvents.push({
        name: 'article_shown',
        params: {
          user_id: userId,
          feed_id: feedId,
          impression_id: impressionId,
          user_stage: userStage,
          prior_qualifying_reads: totalArticlesRead,
          days_since_last_read: daysSinceLastRead,
          profile_concentration: profileConcentration,
          is_new_publisher: hasPublisherHistory ? 0 : 1,
          is_new_category: isDiscoveryCategory ? 1 : 0,
          article_id: article.id,
          publisher_id: article.publicationName,
          category_id: article.category,
          tranche,
          dominant_component: dominantComponent,
          score_p: compP,
          score_t: compT,
          score_r: compR,
          score_q: compQ,
          final_score: s.fullScore,
          position: index,
        },
      });
    });

    // feed_generated — one event per feed load
    feedArticleShownEvents.unshift({
      name: 'feed_generated',
      params: {
        user_id: userId,
          feed_id: feedId,
          user_stage: userStage,
          prior_qualifying_reads: totalArticlesRead,
          days_since_last_read: daysSinceLastRead,
          profile_concentration: profileConcentration,

        tranche_high_count: finalFeed.filter((_, i) => {
          const s = scoredById.get(finalFeed[i].id);
          return s && s.fullScore > cfg.tranche.highThreshold;
        }).length,
        tranche_mid_count: finalFeed.filter((_, i) => {
          const s = scoredById.get(finalFeed[i].id);
          return s && s.fullScore > cfg.tranche.midThreshold && s.fullScore <= cfg.tranche.highThreshold;
        }).length,
        tranche_tail_count: finalFeed.filter((_, i) => {
          const s = scoredById.get(finalFeed[i].id);
          return s && s.fullScore <= cfg.tranche.midThreshold;
        }).length,
        distinct_publisher_count: distinctPublishers.size,
        distinct_category_count: distinctCategories.size,
      },
    });

    // Fire-and-forget — analytics events don't block the response
    sendGAEvents(clientId, feedArticleShownEvents).catch(() => {});

    console.log(`[getRankedFeed] Returning ${finalFeed.length} articles to client (pool size: ${pool.length})`);

    // Add transient recommendation context to the callable response. It is never
    // written into articles/candidate pools, and lets later actions identify this
    // exact article appearance rather than merely the article ID.
    const responseArticles = finalFeed.map((article, index) => ({
      ...article,
      recommendationContext: { feedId, impressionId: `${feedId}:${index}` },
    }));

    // High-fidelity mode: attach each article's exact server-computed scores.
    // Articles are shallow-cloned so the shared candidate-pool cache is untouched.
    if (includeScores) {
      const enrichedArticles = responseArticles.map((article) => {
        const detail = scoreDetailById.get(article.id);
        return detail ? { ...article, _score: detail } : article;
      });
      return {
        articles: enrichedArticles,
        generatedAt,
        remainingCount: Math.max(0, unseenArticles.length - finalFeed.length),
      };
    }

    return {
      articles: responseArticles,
      generatedAt,
      remainingCount: Math.max(0, unseenArticles.length - finalFeed.length),
    };
  } catch (error: any) {
    console.error('[getRankedFeed] Error:', error);
    throw new Error('Failed to rank feed');
  }
});





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
} from './constants.js';
import { controlDashboardSecret, gaApiSecret, sendGAEvents } from './analytics.js';
import { isControlDashboardAdmin } from './dashboardAuth.js';
import { loadScoringConfig, prepareConfig, ScoringConfig, sigmoid } from './scoringConfig.js';

// --- Configuration ---
const CACHE_LIFETIME_MS = 10 * 60 * 1000; // 10 minutes memory cache

// Publisher seed latent — configurable via `latent.publisherSeed` in the
// scoring config; DEFAULT_PUBLISHER_LATENT remains the compiled fallback.
const PUBLISHER_SEED_FALLBACK = 1.386;

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
 * Sigmoid-blend of unbounded category and publisher latent scores x.
 * Neutral x = 0.0 → sigmoid(0) = 0.50 (true neutral).
 * Strong enthusiast  x = 2.20 → sigmoid(2.20) ≈ 0.90.
 * Strong rejection   x = -2.20 → sigmoid(-2.20) ≈ 0.10.
 *
 * Known publishers use 60% category and 40% publisher. A publisher
 * with no stored interaction history uses the configurable cold‑start
 * blend instead.
 */
function normalizeP(
  categoryLatent: number,
  publisherLatent: number,
  categoryShare: number = 0.6,
  publisherShare: number = 0.4,
  steepness: number = 1
): number {
  return categoryShare * sigmoid(categoryLatent, steepness) + publisherShare * sigmoid(publisherLatent, steepness);
}

function getUserStage(totalArticlesRead: number, lastReadDate: number, now: number): 'new' | 'learning' | 'established' | 'inactive_returning' {
  const daysSinceLastRead = lastReadDate > 0 ? Math.floor((now - lastReadDate) / (24 * 60 * 60 * 1000)) : null;
  if (totalArticlesRead > 0 && daysSinceLastRead !== null && daysSinceLastRead >= 14) return 'inactive_returning';
  if (totalArticlesRead <= 2) return 'new';
  if (totalArticlesRead <= 14) return 'learning';
  return 'established';
}

function getProfileConcentration(categoryWeights: Record<string, number>): number {
  // Compute Herfindahl on sigmoid-mapped probabilities (not raw latents) so
  // negative latents contribute meaningfully and the metric stays in [0,1].
  const probs = Object.values(categoryWeights)
    .filter((x) => Number.isFinite(x))
    .map((x) => sigmoid(x));
  const total = probs.reduce((sum, p) => sum + p, 0);
  return total > 0 ? probs.reduce((sum, p) => sum + (p / total) ** 2, 0) : 0;
}

function getPersonalizationScore(
  categoryWeight: number,
  publisherName: string,
  publisherWeights: Record<string, number>,
  cfg: ScoringConfig
): number {
  const hasPublisherHistory = Object.prototype.hasOwnProperty.call(publisherWeights, publisherName);
  const publisherWeight = publisherWeights[publisherName] ?? 0.0;
  return normalizeP(
    categoryWeight,
    publisherWeight,
    hasPublisherHistory ? 0.6 : cfg.scoring.publisherColdStartCategoryWeight,
    hasPublisherHistory ? 0.4 : cfg.scoring.publisherColdStartPublisherWeight,
    cfg.sigmoid.steepness
  );
}

/**
 * T — Trending [0, 1] via saturation sigmoid.
 * T = S / (S + k), where k = trendingHalfSat (default 25).
 * Score of 0 → T = 0.0, score of 25 → T = 0.5, no cap needed.
 */
function normalizeT(trendingScore: number, halfSat: number): number {
  const s = Math.max(0, trendingScore || 0);
  return s / (s + halfSat);
}

/**
 * R — Recency [0, 1] via single monotone decay.
 * R = 1 / (1 + daysOld / τ), where τ = recencyDaysConstant (default 14).
 */
function normalizeR(daysOld: number, daysConstant: number): number {
  if (daysOld <= 0) return 1.0;
  return 1 / (1 + daysOld / daysConstant);
}

/**
 * Q — Publisher Quality [0, 1] via sigmoid of latent y.
 * Publishers collection stores unbounded latent y (seed 1.386 → σ=0.8).
 */
function normalizeQ(publisherQualityScore: number, steepness: number = 1): number {
  return sigmoid(publisherQualityScore, steepness);
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
  limit: number,
  allowStickerFallback = true
): Promise<Article[]> {
  const now = Date.now();
  const fourWeeksAgo = now - 4 * 7 * 24 * 60 * 60 * 1000;
  const results: Article[] = [];

  // Audit fix (isFresh sticker): articles carry an isFresh boolean stamped at
  // ingestion and flipped daily, so the freshness filter runs server-side and
  // we fetch only what we need (~1x instead of 3x). Until the one-off backfill
  // has stamped legacy articles, a sticker query may legitimately return zero;
  // allowStickerFallback reruns once with the original in-memory date filter.
  const stickerMode = true;
  const fetchCap = stickerMode ? limit : limit * 3;

  const runQuery = async (scoreMin: number, scoreMax: number | null, cap: number) => {
    try {
      let q = db.collection('articles')
        .where('isPaywalled', '==', false)
        .where('random_score', '>=', scoreMin);
      if (scoreMax !== null) {
        q = (q as any).where('random_score', '<', scoreMax);
      }
      if (stickerMode) {
        q = (q as any).where('isFresh', '==', fresh);
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
      if (stickerMode) {
        q = (q as any).where('isFresh', '==', fresh);
      }
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

  // Audit fix (isFresh): legacy fallback - until every article carries the
  // sticker (run firebase/scripts/oneoff/backfillIsFresh.js once after deploy),
  // a sticker-mode query can match nothing. Detect that state and rerun once
  // with the original in-memory date filtering so pools are never empty.
  if (stickerMode && results.length === 0 && allowStickerFallback) {
    console.warn('[CandidatePool] Sticker query empty (fresh=' + fresh + ', currentOnly=' + currentOnly + ') - falling back to legacy date filter.');
    return queryRandomSample(fresh, currentOnly, threshold, limit, false);
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
    const cfgPool = (await loadScoringConfig()).pool;
    const now = Date.now();
    // Single random threshold shared across all 4 queries this run.
    // Changes on every invocation so the pool content is always different.
    const threshold = Math.random();
    console.log(`[Cron] Using random_score threshold: ${threshold.toFixed(6)}`);

    // Run all 4 queries in parallel for speed
    const [freshCurrent, oldCurrent, freshMixed, oldMixed] = await Promise.all([
      queryRandomSample(true,  true,  threshold, cfgPool.boxQueryLimit),  // Fresh active  (Box 1)
      queryRandomSample(false, true,  threshold, cfgPool.boxQueryLimit),  // Old active    (Box 1)
      queryRandomSample(true,  false, threshold, cfgPool.boxQueryLimit),  // Fresh any     (Box 2)
      queryRandomSample(false, false, threshold, cfgPool.boxQueryLimit),  // Old any       (Box 2)
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
/**
 * Audit fix (isFresh): expire freshness stickers for quiet articles.
 * The decay batch below only visits popular articles (trendingScore above 1),
 * so low-engagement articles would otherwise keep isFresh=true forever after
 * crossing the 28-day line, gradually polluting fresh pool queries with stale
 * content. Bounded at about 2,000 flips per day; steady state touches only the
 * handful of newly-crossed articles. Requires composite index
 * (isFresh ASC, publishDate ASC) - see firestore.indexes.json.
 */
async function expireStaleStickers(expiryDays: number, flipCap: number, batchSize: number): Promise<number> {
  const cutoff = Date.now() - expiryDays * 24 * 60 * 60 * 1000;
  let flipped = 0;
  while (flipped < flipCap) {
    const snap = await db.collection('articles')
      .where('isFresh', '==', true)
      .where('publishDate', '<', cutoff)
      .orderBy('publishDate', 'asc')
      .limit(batchSize)
      .get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.forEach(doc => batch.update(doc.ref, { isFresh: false }));
    await batch.commit();
    flipped += snap.size;
  }
  return flipped;
}

export const cronDecayTrendingScores = onSchedule('every 24 hours', async () => {
  console.log('[Cron] Starting daily trendingScore decay...');
  const cfgDecay = await loadScoringConfig();
  const m = cfgDecay.maintenance;

  // Audit fix (isFresh): expire aged-out stickers FIRST so quiet articles are
  // maintained even though the early-return below skips the decay batch when
  // there are no hot articles.
  try {
    const expired = await expireStaleStickers(m.stickerExpiryDays, m.stickerFlipCap, m.deleteBatchSize);
    if (expired > 0) {
      console.log(`[Cron] Expired isFresh sticker on ${expired} aged-out article(s).`);
    }
  } catch (err) {
    console.error('[Cron] Error expiring stale isFresh stickers:', err);
  }

  const decayRate = cfgDecay.trending.decayRate;
  try {
    // C1 Fix: Raised threshold from 0.1 to 1.0.
    // Articles with trendingScore < the configured minimum are effectively
    // zero-signal — decaying them does not meaningfully change rankings but
    // wastes most of the daily write budget.
    const snapshot = await db.collection('articles')
      .where('trendingScore', '>', m.trendingDecayMinScore)
      .get();

    if (snapshot.empty) {
      console.log(`[Cron] No articles with trendingScore > ${m.trendingDecayMinScore}, nothing to decay.`);
      return;
    }

    const batchSize = m.deleteBatchSize;
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
        // Audit fix (isFresh): hot articles also refresh their freshness sticker,
        // so ones crossing the 28-day line stop matching fresh pool queries.
        const dData = doc.data();
        const stillFresh = Date.now() - (dData.publishDate || 0) < 28 * 24 * 60 * 60 * 1000;
        batch.update(doc.ref, { trendingScore: newScore, random_score: Math.random(), isFresh: stillFresh });
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
  const cfgPool = (await loadScoringConfig()).pool;
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
          cacheTimestampMixed = now;
          return candidateCacheMixed;
        } else {
          candidateCacheCurrent = data.articles as Article[];
          cacheTimestampCurrent = now;
          return candidateCacheCurrent;
        }
      }
    }
  } catch (err) {
    console.error(`[Cache] Failed to fetch ${docName}, falling back to on-the-fly generation:`, err);
  }

  console.log('[Cache] Fallback triggered. Querying stratified buckets on-the-fly...');
  try {
        const freshCutoff = Date.now() - (cfgPool.fallbackFreshCutoffDays * 24 * 60 * 60 * 1000);

    const freshSnapshot = await db
      .collection('articles')
      .where('publishDate', '>=', freshCutoff)
      .orderBy('publishDate', 'desc')
      .limit(cfgPool.fallbackQueryCap)
      .get();

    const qualitySnapshot = await db
      .collection('articles')
      .where('publishDate', '<', freshCutoff)
      .orderBy('publishDate', 'desc')
      .limit(cfgPool.fallbackQueryCap)
      .get();

    const freshArticles: Article[] = [];
    freshSnapshot.forEach((doc) => {
      const data = doc.data() as Article;
      if (
        !data.isPaywalled &&
        (includeArchived || data.rssStatus === 'current') &&
        (data.wordCount === undefined || data.wordCount >= cfgPool.minArticleWords)
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
        (data.wordCount === undefined || data.wordCount >= cfgPool.minArticleWords)
      ) {
        archiveArticles.push({ ...data, id: doc.id });
      }
    });

    shuffleArray(freshArticles);
    shuffleArray(archiveArticles);

        const articlesMap = new Map<string, Article>();
    [...freshArticles.slice(0, cfgPool.boxQueryLimit), ...archiveArticles.slice(0, cfgPool.boxQueryLimit)].forEach(a => {
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
      // Stored quality values are unbounded latent y — feed them directly
      // through sigmoid() at scoring time. No clamp.
      if (data && typeof data.qualityScore === 'number') {
        const pubKey = (data.name && typeof data.name === 'string') ? data.name : doc.id;
        tempQualities[pubKey] = data.qualityScore;
      }
    });
    publisherQualityCache = tempQualities;
    publisherCacheTimestamp = now;
    console.log(`[Cache] Loaded live latent quality scores for ${Object.keys(publisherQualityCache).length} publishers`);
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


/**
 * Single-pass greedy feed selection with subtractive penalty steps.
 *
 * Every candidate is re-scored at each pick:
 *   Adjusted = BaseScore − (P_cat × N_cat) − (P_pub × N_pub) + jitter
 * Discovery slots (every 5th card, starting at position 4) zero out
 * personalization and pick purely on trending, recency, and quality.
 */
export function selectFeed(
  scoredList: { article: Article; fullScore: number; P?: number; T?: number; R?: number; Q?: number }[],
  totalSize = 30,
  _totalArticlesRead = 0,
  opts: {
    categoryPenaltyStep?: number;
    publisherPenaltyStep?: number;
    discoverySlotInterval?: number;
    jitterRange?: number;
    maxArticlesPerCategory?: number;
    minDistinctCategories?: number;
  } = {}
): Article[] {
  const {
    categoryPenaltyStep = 0.15,
    publisherPenaltyStep = 0.25,
    discoverySlotInterval = 5,
    jitterRange = 0.03,
    maxArticlesPerCategory = 15,
    minDistinctCategories = 4,
  } = opts;
  if (scoredList.length === 0) return [];

  const w = SCORE_WEIGHTS;
  const candidates = [...scoredList].sort((a, b) => b.fullScore - a.fullScore);

  // Startup anchor: highest-scoring article at position 0
  const anchor = candidates[0];
  const startupAnchorId = anchor.article.id;
  const selected: Article[] = [];
  const usedIds = new Set<string>();
  const catCounts = new Map<string, number>();
  const pubCounts = new Map<string, number>();

  selected.push(anchor.article);
  usedIds.add(anchor.article.id);
  catCounts.set(anchor.article.category || 'Uncategorized', 1);
  pubCounts.set(anchor.article.publicationName, 1);

  // Remaining candidates (excluding anchor)
  const pool = candidates.slice(1);

  // Randomize which position within each block of `discoverySlotInterval` cards
  // is the discovery slot. A fixed "every 5th card" cadence lets users learn to
  // skip those cards on autopilot, defeating discovery's purpose.
  const discoveryPhase = Math.floor(Math.random() * discoverySlotInterval);

  for (let pos = 1; pos < totalSize && pool.length > 0; pos++) {
    // Discovery slot: one randomized position per block, zero out personalization
    const isDiscoverySlot = pos % discoverySlotInterval === discoveryPhase;

    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < pool.length; i++) {
      const s = pool[i];
      const cat = s.article.category || 'Uncategorized';
      const pub = s.article.publicationName;
      const catN = catCounts.get(cat) || 0;
      const pubN = pubCounts.get(pub) || 0;

      // Hard safety net: do not exceed per-category cap
      if (catN >= maxArticlesPerCategory) continue;

      // Base score
      const baseScore = isDiscoverySlot
        ? w.trending * (s.T ?? 0) + w.recency * (s.R ?? 0) + w.quality * (s.Q ?? 0)
        : s.fullScore;

      // Cumulative linear penalty (subtractive, so elite articles survive longer)
      const penalty = categoryPenaltyStep * catN + publisherPenaltyStep * pubN;
      const adjusted = baseScore - penalty;

      // Jitter: uniform random in [-jitterRange, +jitterRange]
      const jitter = (Math.random() * 2 - 1) * jitterRange;
      const final = adjusted + jitter;

      if (final > bestScore) {
        bestScore = final;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) break;  // no eligible remaining candidates

    const picked = pool.splice(bestIdx, 1)[0];
    const category = picked.article.category || 'Uncategorized';
    selected.push(picked.article);
    usedIds.add(picked.article.id);
    catCounts.set(category, (catCounts.get(category) || 0) + 1);
    pubCounts.set(picked.article.publicationName, (pubCounts.get(picked.article.publicationName) || 0) + 1);
  }
// Fill any remaining slots if pool still has candidates
  for (const s of pool) {
    if (selected.length >= totalSize) break;
    selected.push(s.article);
  }

  // minDistinctCategories fixup: replace weakest overrepresented-category
  // article with best missing-category candidate
  const distinct = new Set(selected.map(a => a.category || 'Uncategorized'));
  if (distinct.size < minDistinctCategories) {
    const publisherCounts = new Map<string, number>();
    const categoryCounts = new Map<string, number>();
    for (const a of selected) {
      publisherCounts.set(a.publicationName, (publisherCounts.get(a.publicationName) || 0) + 1);
      const cat = a.category || 'Uncategorized';
      categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
    }
    const replacements = [...scoredList].sort((a, b) => b.fullScore - a.fullScore);
    while (distinct.size < minDistinctCategories) {
      const cand = replacements.find(({ article }) =>
        !usedIds.has(article.id) &&
        !distinct.has(article.category || 'Uncategorized')
      );
      if (!cand) break;
      let replaceIdx = -1;
      let weakestScore = Number.POSITIVE_INFINITY;
      for (let i = 0; i < selected.length; i++) {
        const a = selected[i];
        if (a.id === startupAnchorId) continue;
        const cnt = categoryCounts.get(a.category || 'Uncategorized') || 0;
        if (cnt <= 1) continue;
        const fs = scoredList.find(s => s.article.id === a.id)?.fullScore ?? 0;
        if (fs < weakestScore) { weakestScore = fs; replaceIdx = i; }
      }
      if (replaceIdx < 0) break;
      const removed = selected[replaceIdx];
      const rmCat = removed.category || 'Uncategorized';
      categoryCounts.set(rmCat, Math.max(0, (categoryCounts.get(rmCat) || 1) - 1));
      publisherCounts.set(removed.publicationName, Math.max(0, (publisherCounts.get(removed.publicationName) || 1) - 1));
      usedIds.delete(removed.id);
      selected[replaceIdx] = cand.article;
      const newCat = cand.article.category || 'Uncategorized';
      categoryCounts.set(newCat, (categoryCounts.get(newCat) || 0) + 1);
      publisherCounts.set(cand.article.publicationName, (publisherCounts.get(cand.article.publicationName) || 0) + 1);
      usedIds.add(cand.article.id);
      distinct.add(newCat);
      if ((categoryCounts.get(rmCat) || 0) === 0) distinct.delete(rmCat);
    }
  }

  // Preserve variety without letting the final order create topic fatigue.
  const interleaved = interleaveArticlesByCategory(selected);

  // Move reserved startup anchor to position 0
  const anchorIdx = interleaved.findIndex(a => a.id === startupAnchorId);
  const heroFirst = anchorIdx > 0
    ? [interleaved[anchorIdx], ...interleaved.filter((_, i) => i !== anchorIdx)]
    : interleaved;
  const ordered = spaceArticlesByPublisher(heroFirst, 3, startupAnchorId);

  console.log(`[Select Feed] Selected ${selected.length} of ${scoredList.length} candidates`);
  return ordered;
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
  const cfgMaintenance = (await loadScoringConfig()).maintenance;
  try {
    // Step 1: Immediately delete ALL paywalled articles.
    // Paywalled articles are never shown to users and never included in candidate pools.
    // Purging them keeps the collection smaller and reduces query costs for all other crons.
    try {
      const paywallSnap = await db.collection('articles')
        .where('isPaywalled', '==', true)
        .get();

      if (!paywallSnap.empty) {
        const batchSize = cfgMaintenance.deleteBatchSize;
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
    // proportionally more Firestore reads every cycle), we query the worst-scoring
    // candidates directly via a composite index. The result is a fixed read
    // ceiling every 72 hours regardless of collection size.
    const minAgeCutoff = Date.now() - (cfgMaintenance.cleanupMinAgeDays * 24 * 60 * 60 * 1000);

    const SAMPLE_LIMIT = cfgMaintenance.cleanupSampleSize;
    const DELETE_FRACTION = cfgMaintenance.cleanupDeleteFraction;

    const snapshot = await db.collection('articles')
      .where('publishDate', '<', minAgeCutoff)
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

    const batchSize = cfgMaintenance.deleteBatchSize;
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

export const getRankedFeed = onCall({ secrets: [gaApiSecret, controlDashboardSecret] }, async (request): Promise<RankedFeedResult> => {
  // P0 Security: Always use the verified auth UID, never the client-supplied userId.
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
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
  const requestStartedAt = Date.now();
  console.log(`[getRankedFeed] userId: ${userId}, seen limit: ${(seenArticleIds || []).length}`);

  // Single source of truth for all tunable values (cached ~60s per instance).
  // H3 Fix: a preview configOverride is honored ONLY for Control Dashboard
  // admins (valid dashboard_secret). Regular app users silently get the
  // published config — any override they send is ignored.
  const isAdminCaller = isControlDashboardAdmin(request);
  const cfg = prepareConfig(isAdminCaller ? configOverride : undefined) ?? await loadScoringConfig();
  const configReadyAt = Date.now();

  let categoryWeights: Record<string, number> = {};
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
      publisherWeights = data.publisherWeights || {};
      includeArchivedArticles = data.includeArchivedArticles || false;
      totalArticlesRead = data.totalArticlesRead || 0;
      lastReadDate = data.lastReadDate || 0;
    }
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.warn('[getRankedFeed] Could not fetch user profile');
  }
  const profileReadyAt = Date.now();

  try {
    const candidateCacheWasWarm = (includeArchivedArticles ? candidateCacheMixed : candidateCacheCurrent).length > 0
      && (Date.now() - (includeArchivedArticles ? cacheTimestampMixed : cacheTimestampCurrent)) < CACHE_LIFETIME_MS;
    const pool = await getOrUpdateCandidatePool(includeArchivedArticles);
    const poolReadyAt = Date.now();

    if (pool.length === 0) {
      console.log(`[Feed Timing] config=${configReadyAt - requestStartedAt}ms profile=${profileReadyAt - configReadyAt}ms pool=${poolReadyAt - profileReadyAt}ms poolWarm=${candidateCacheWasWarm} total=${poolReadyAt - requestStartedAt}ms empty=true`);
      return { articles: [], generatedAt: Date.now(), remainingCount: 0 };
    }

    const publisherCacheWasWarm = Object.keys(publisherQualityCache).length > 0
      && (Date.now() - publisherCacheTimestamp) < CACHE_LIFETIME_MS;
    const publisherQualities = await getOrUpdatePublisherQualities();
    const publisherReadyAt = Date.now();
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

      const catWeight = categoryWeights[article.category] ?? 0;
      const rawQuality = publisherQualities[article.publicationName] ?? cfg.latent.publisherSeed;

      const P = getPersonalizationScore(catWeight, article.publicationName, publisherWeights, cfg);
      const T = normalizeT(article.trendingScore || 0, cfg.scoring.trendingHalfSat);
      const R = normalizeR(daysOld, cfg.scoring.recencyDaysConstant);
      const Q = normalizeQ(rawQuality, cfg.sigmoid.steepness);

      const fullScore = scorePersonalized(P, T, R, Q, cfg.scoring);

      return { article, fullScore, P, T, R, Q };
    });

    const finalFeed = selectFeed(scored, cfg.selection.feedSize, totalArticlesRead, {
      categoryPenaltyStep: cfg.selection.categoryPenaltyStep,
      publisherPenaltyStep: cfg.selection.publisherPenaltyStep,
      discoverySlotInterval: cfg.selection.discoverySlotInterval,
      jitterRange: cfg.selection.jitterRange,
      maxArticlesPerCategory: cfg.selection.maxArticlesPerCategory,
      minDistinctCategories: cfg.selection.minDistinctCategories,
    });
    const selectionReadyAt = Date.now();

    // B2 Fix: Gate detailed score logging behind the emulator flag so production
    // doesn't ship article titles (PII) and score breakdowns to billable logs.
    if (process.env.FUNCTIONS_EMULATOR === 'true') {
      console.log(`[getRankedFeed] --- Top 5 by fullScore ---`);
      [...scored].sort((a, b) => b.fullScore - a.fullScore).slice(0, 5).forEach((s, i) => {
        console.log(
          `  #${i + 1} "${s.article.title.substring(0, 50)}..." ` +
          `score=${s.fullScore.toFixed(3)} ` +
          `P=${s.P?.toFixed(2) ?? '?'} T=${s.T?.toFixed(2) ?? '?'} R=${s.R?.toFixed(2) ?? '?'} Q=${s.Q?.toFixed(2) ?? '?'}`
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
        s.fullScore > 0.40 ? 'high' :
        s.fullScore > 0.20 ? 'mid' : 'tail';

      const contributions: [string, number][] = [
        ['P', cfg.scoring.personalization * (s.P ?? 0)],
        ['T', cfg.scoring.trending * (s.T ?? 0)],
        ['R', cfg.scoring.recency * (s.R ?? 0)],
        ['Q', cfg.scoring.quality * (s.Q ?? 0)],
      ];
      const dominantComponent = contributions.reduce((a, b) => (b[1] > a[1] ? b : a))[0];

      if (isAdminCaller && includeScores) {
        scoreDetailById.set(article.id, {
          scoreP: s.P ?? 0,
          scoreT: s.T ?? 0,
          scoreR: s.R ?? 0,
          scoreQ: s.Q ?? 0,
          finalScore: s.fullScore,
          tranche,
          dominant: dominantComponent as 'P' | 'T' | 'R' | 'Q',
        });
      }

      const impressionId = `${feedId}:${index}`;
      const hasPublisherHistory = Object.prototype.hasOwnProperty.call(publisherWeights, article.publicationName);
      const categoryWeight = categoryWeights[article.category] ?? 0;
      const isDiscoveryCategory = Math.abs(categoryWeight) < 0.05;

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
          score_p: s.P ?? 0,
          score_t: s.T ?? 0,
          score_r: s.R ?? 0,
          score_q: s.Q ?? 0,
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
          return s && s.fullScore > 0.40;
        }).length,
        tranche_mid_count: finalFeed.filter((_, i) => {
          const s = scoredById.get(finalFeed[i].id);
          return s && s.fullScore > 0.20 && s.fullScore <= 0.40;
        }).length,
        tranche_tail_count: finalFeed.filter((_, i) => {
          const s = scoredById.get(finalFeed[i].id);
          return s && s.fullScore <= 0.20;
        }).length,
        distinct_publisher_count: distinctPublishers.size,
        distinct_category_count: distinctCategories.size,
      },
    });

    // Fire-and-forget — analytics events don't block the response
    sendGAEvents(clientId, feedArticleShownEvents).catch(() => {});
    const responsePreparedAt = Date.now();

    console.log(`[Feed Timing] config=${configReadyAt - requestStartedAt}ms profile=${profileReadyAt - configReadyAt}ms pool=${poolReadyAt - profileReadyAt}ms publisher=${publisherReadyAt - poolReadyAt}ms selection=${selectionReadyAt - publisherReadyAt}ms response=${responsePreparedAt - selectionReadyAt}ms total=${responsePreparedAt - requestStartedAt}ms poolWarm=${candidateCacheWasWarm} publisherWarm=${publisherCacheWasWarm} pool=${pool.length} unseen=${unseenArticles.length} returned=${finalFeed.length}`);
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
    if (isAdminCaller && includeScores) {
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





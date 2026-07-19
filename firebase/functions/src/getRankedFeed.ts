// ============================================================
// SubTick — getRankedFeed (HTTPS Callable)
// 5-component scoring formula, cached, time-stratified,
// with inverted diversity scoring & 10% exploration.
// Returns top 100 with dynamic real-time publisher quality scores.
// ============================================================

import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Article, RankedFeedResult, UserProfile } from './types.js';
import {
  SCORE_WEIGHTS,
} from './constants.js';

const db = admin.firestore();

// --- Configuration ---
const RETURN_FEED_SIZE = 100;
const EXPLORATION_COUNT = 10; // 10% of returned feed is random/wildcard exploration
const CACHE_LIFETIME_MS = 10 * 60 * 1000; // 10 minutes memory cache

// Global Cache Variables (persistent across function container instances)
let candidateCache: Article[] = [];
let cacheTimestamp = 0;

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
 * Pulls 150 newest articles & 150 highest-quality older articles of all time,
 * deduplicates them, and caches the 300 candidates in memory for 10 minutes.
 */
async function getOrUpdateCandidatePool(): Promise<Article[]> {
  const now = Date.now();
  if (candidateCache.length > 0 && (now - cacheTimestamp) < CACHE_LIFETIME_MS) {
    console.log(`[Cache] Serving ${candidateCache.length} articles from memory (freshness: ${Math.round((now - cacheTimestamp) / 1000)}s)`);
    return candidateCache;
  }

  console.log('[Cache] Cache expired or empty. Querying stratified buckets from Firestore...');

  try {
    // Bucket A: Fresh (150 newest articles)
    const freshSnapshot = await db
      .collection('articles')
      .orderBy('publishDate', 'desc')
      .limit(150)
      .get();

    // Bucket B: Archive/Quality (150 highest-quality articles)
    // Auto-indexed by single field qualityScore
    const qualitySnapshot = await db
      .collection('articles')
      .orderBy('qualityScore', 'desc')
      .limit(150)
      .get();

    const articlesMap = new Map<string, Article>();

    freshSnapshot.forEach((doc) => {
      const data = doc.data() as Article;
      // "Anti-Stub" Filter: Drop extremely short articles or paywalled ones
      if (!data.isPaywalled && (data.wordCount === undefined || data.wordCount >= 150)) {
        articlesMap.set(doc.id, { ...data, id: doc.id });
      }
    });

    qualitySnapshot.forEach((doc) => {
      const data = doc.data() as Article;
      if (!data.isPaywalled && (data.wordCount === undefined || data.wordCount >= 150)) {
        articlesMap.set(doc.id, { ...data, id: doc.id });
      }
    });

    candidateCache = Array.from(articlesMap.values());
    cacheTimestamp = now;
    console.log(`[Cache] Rebuilt candidate pool cache. Total articles: ${candidateCache.length} (deduplicated)`);
    return candidateCache;
  } catch (error) {
    console.error('[Cache] Error building candidate pool:', error);
    if (candidateCache.length > 0) {
      console.warn('[Cache] Falling back to expired candidate pool cache');
      return candidateCache;
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
 * Stage 2: Personalization & Exploration
 * Filters seen article IDs, scores candidates against user weights,
 * sorts them, and applies the 10% Exploration Rule to inject non-preferred categories.
 */
function assembleFeedWithExploration(
  scoredList: { article: Article; score: number }[],
  categoryWeights: Record<string, number>,
  publisherQualities: Record<string, number>,
  totalSize = RETURN_FEED_SIZE,
  explorationCount = EXPLORATION_COUNT
): Article[] {
  if (scoredList.length === 0) return [];

  // Standard count is 90 articles (90%)
  const standardCount = Math.max(0, totalSize - explorationCount);
  
  // Take top 90 standard articles
  const topStandard = scoredList.slice(0, standardCount).map(s => s.article);
  const standardIds = new Set(topStandard.map(a => a.id));

  // Identify non-preferred categories (weight <= 1.0)
  const nonPreferredCategories = new Set<string>();
  Object.entries(categoryWeights).forEach(([cat, w]) => {
    if (w <= 1.0) {
      nonPreferredCategories.add(cat);
    }
  });

  // Filter remaining articles for exploration
  const remainingCandidates = scoredList
    .slice(standardCount)
    .map(s => s.article)
    .filter(a => !standardIds.has(a.id));

  // Filter exploration candidates to non-preferred categories
  const explorationCandidates = remainingCandidates.filter(a => nonPreferredCategories.has(a.category));

  let chosenExploration: Article[] = [];

  if (explorationCandidates.length > 0) {
    // Score them purely on non-category features (Recency, Quality, Trending, Diversity) so they compete fairly
    const scoredExploration = explorationCandidates.map((article) => {
      const daysOld = Math.max(0, (Date.now() - article.publishDate) / (1000 * 60 * 60 * 24));
      const C = 1.0; // treat category weight as neutral
      const T = Math.max(0.1, 1.0 + (article.trendingScore || 0) / 2.5);
      const R = 2.0 / (1.0 + daysOld / 7);
      const Q = publisherQualities[article.publicationName] ?? article.qualityScore ?? 0.8;
      const score =
        SCORE_WEIGHTS.categoryBoost * C +
        SCORE_WEIGHTS.trendingBoost * T +
        SCORE_WEIGHTS.recencyBoost * R +
        SCORE_WEIGHTS.qualityBoost * Q;
      return { article, score };
    });

    scoredExploration.sort((a, b) => b.score - a.score);
    chosenExploration = scoredExploration.slice(0, explorationCount).map(s => s.article);
    console.log(`[Exploration] Salted in ${chosenExploration.length} wildcard exploration articles from categories: ${Array.from(new Set(chosenExploration.map(e => e.category))).join(', ')}`);
  }

  // If we couldn't find enough exploration candidates, fill the rest with standard scored articles
  let finalFeed = [...topStandard, ...chosenExploration];
  if (finalFeed.length < totalSize) {
    const missingCount = totalSize - finalFeed.length;
    const addedFromScored = remainingCandidates
      .filter(a => !chosenExploration.some(ex => ex.id === a.id))
      .slice(0, missingCount);
    finalFeed = [...finalFeed, ...addedFromScored];
  }

  return finalFeed.slice(0, totalSize);
}

export const getRankedFeed = onCall(async (request): Promise<RankedFeedResult> => {
  const { userId, seenArticleIds } = request.data as { userId: string; seenArticleIds: string[] };
  console.log(`[getRankedFeed] userId: ${userId}, seen limit: ${(seenArticleIds || []).length}`);

  let categoryWeights: Record<string, number> = {};
  let categoryLengthWeights: Record<string, number> = {};
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      const data = userDoc.data() as UserProfile;
      categoryWeights = data.categoryWeights || {};
      categoryLengthWeights = data.categoryLengthWeights || {};
    }
  } catch (err) {
    console.warn('[getRankedFeed] Could not fetch user profile');
  }

  try {
    // STAGE 1: Fetch candidate pool (from memory cache or time-stratified query)
    const pool = await getOrUpdateCandidatePool();

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
      const personalizationWeight = categoryLengthWeights[compKey] ?? categoryWeights[article.category] ?? 1.0;
      
      const pubCount = pubCounts[article.publicationName] || 1;
      
      // Use dynamic, crowd-sourced publisher quality score. Falls back to static seed if no feedback gathered yet
      const dynamicQuality = publisherQualities[article.publicationName] ?? article.qualityScore ?? 0.8;
      
      const score = calculateCompositeScore(article, personalizationWeight, pubCount, dynamicQuality);
      return { article, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // Assemble the top 100 with the 10% Exploration Rule
    const finalFeed = assembleFeedWithExploration(scored, categoryWeights, publisherQualities, RETURN_FEED_SIZE, EXPLORATION_COUNT);

    // --- Log top 5 articles with per-component scores for debugging ---
    console.log(`[getRankedFeed] User weights: ${JSON.stringify(categoryWeights)}, Style weights: ${JSON.stringify(categoryLengthWeights)}`);
    console.log(`[getRankedFeed] --- Top 5 Scored Articles ---`);
    scored.slice(0, 5).forEach((s, i) => {
      const daysOld = Math.max(0, (Date.now() - s.article.publishDate) / (1000 * 60 * 60 * 24));
      const compKey = `${s.article.category}::${s.article.lengthStyle}`;
      const personalizationWeight = categoryLengthWeights[compKey] ?? categoryWeights[s.article.category] ?? 1.0;
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

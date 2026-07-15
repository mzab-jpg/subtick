// ============================================================
// SubTick — getRankedFeed (HTTPS Callable)
// 5-component scoring formula, excludes seen IDs, returns top 30.
// ============================================================

import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Article, RankedFeedResult, UserProfile } from './types.js';
import {
  SCORE_WEIGHTS,
  CANDIDATE_POOL_SIZE,
  MAX_FEED_ARTICLES,
} from './constants.js';

const db = admin.firestore();

function calculateCompositeScore(
  article: Article,
  userCategoryWeight: number,
  articlesInSamePub: number
): number {
  const daysOld = Math.max(0, (Date.now() - article.publishDate) / (1000 * 60 * 60 * 24));

  const C = Math.max(0.1, userCategoryWeight / 1.0);
  const T = Math.max(0.1, 1.0 + (article.trendingScore || 0) / 2.5);
  const R = 2.0 / (1.0 + daysOld / 7);
  const Q = article.qualityScore || 0.5;
  const U = 0.3 + (Math.min(1.0, articlesInSamePub / 20) * 0.7);

  return (
    SCORE_WEIGHTS.categoryBoost * C +
    SCORE_WEIGHTS.trendingBoost * T +
    SCORE_WEIGHTS.recencyBoost * R +
    SCORE_WEIGHTS.qualityBoost * Q +
    SCORE_WEIGHTS.crossUserCollab * U
  );
}

export const getRankedFeed = onCall(async (request): Promise<RankedFeedResult> => {
  const { userId, seenArticleIds } = request.data as { userId: string; seenArticleIds: string[] };
  console.log(`[getRankedFeed] userId: ${userId}, seen: ${(seenArticleIds || []).length}`);

  let categoryWeights: Record<string, number> = {};
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      categoryWeights = (userDoc.data() as UserProfile).categoryWeights || {};
    }
  } catch (err) {
    console.warn('[getRankedFeed] Could not fetch user profile');
  }

  try {
    // Fetch latest articles without filter (avoids composite index requirement)
    // Then filter paywalled + seen in memory — same result, no index needed
    const snapshot = await db
      .collection('articles')
      .orderBy('publishDate', 'desc')
      .limit(CANDIDATE_POOL_SIZE)
      .get();

    if (snapshot.empty) {
      return { articles: [], generatedAt: Date.now(), remainingCount: 0 };
    }

    const seenSet = new Set(seenArticleIds || []);
    const articles: Article[] = [];

    snapshot.forEach((doc) => {
      const article = doc.data() as Article;
      // Filter paywalled + seen in memory instead of via Firestore query
      if (article.isPaywalled) return;
      if (seenSet.has(article.id)) return;
      articles.push({ ...article, id: doc.id });
    });

    const pubCounts: Record<string, number> = {};
    articles.forEach((a) => {
      pubCounts[a.publicationName] = (pubCounts[a.publicationName] || 0) + 1;
    });

    const scored = articles.map((article) => {
      const userWeight = categoryWeights[article.category] || 1.0;
      const pubCount = pubCounts[article.publicationName] || 1;
      const score = calculateCompositeScore(article, userWeight, pubCount);
      return { article, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const ranked = scored.slice(0, MAX_FEED_ARTICLES).map((s) => s.article);

    // --- Log top 5 articles with per-component scores for debugging ---
    console.log(`[getRankedFeed] User weights: ${JSON.stringify(categoryWeights)}`);
    console.log(`[getRankedFeed] --- Top 5 Scored Articles ---`);
    scored.slice(0, 5).forEach((s, i) => {
      const daysOld = Math.max(0, (Date.now() - s.article.publishDate) / (1000 * 60 * 60 * 24));
      const userWeight = categoryWeights[s.article.category] || 1.0;
      const pubCount = pubCounts[s.article.publicationName] || 1;
      const C = Math.max(0.1, userWeight / 1.0);
      const T = Math.max(0.1, 1.0 + (s.article.trendingScore || 0) / 2.5);
      const R = 2.0 / (1.0 + daysOld / 7);
      const Q = s.article.qualityScore || 0.5;
      const U = 0.3 + (Math.min(1.0, pubCount / 20) * 0.7);
      console.log(
        `  #${i + 1} [${s.article.category}] "${s.article.title.substring(0, 60)}..." ` +
        `score=${s.score.toFixed(3)} C=${C.toFixed(2)} T=${T.toFixed(2)} R=${R.toFixed(2)} Q=${Q.toFixed(2)} U=${U.toFixed(2)}`
      );
    });
    console.log(`[getRankedFeed] Returning ${ranked.length} articles (pool: ${articles.length})`);
    return {
      articles: ranked,
      generatedAt: Date.now(),
      remainingCount: Math.max(0, articles.length - ranked.length),
    };
  } catch (error: any) {
    console.error('[getRankedFeed] Error:', error);
    throw new Error('Failed to rank feed');
  }
});
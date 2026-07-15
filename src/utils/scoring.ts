// ============================================================
// SubTick — Client-Side Scoring Utilities
// (Mirrors the 5-component formula used server-side in getRankedFeed)
// ============================================================

import { Article } from '../types';
import { SCORE_WEIGHTS } from './constants';

/**
 * 5-Component Scoring Formula:
 * Score = (0.30 × C) + (0.20 × T) + (0.25 × R) + (0.15 × Q) + (0.10 × U)
 *
 * 1. Category Boost (C): max(0.1, userCategoryWeight / 1.0)
 * 2. Trending Boost (T): max(0.1, 1.0 + articleTrendingScore / 2.5)
 * 3. Recency Boost (R): 2.0 / (1.0 + daysOld / 7)
 * 4. Quality Boost (Q): articleQualityScore
 * 5. Cross-User Collaboration (U): 0.3 + (min(1.0, articlesInSamePub / 20) × 0.7)
 */

/**
 * Calculate the composite score for a single article against a user's category weight.
 * Used client-side for displaying feed card preview rankings.
 */
export function calculateArticleScore(
  article: Article,
  userCategoryWeight: number,
  articlesInSamePub: number = 1
): number {
  const daysOld = Math.max(0, (Date.now() - article.publishDate) / (1000 * 60 * 60 * 24));

  const C = Math.max(0.1, userCategoryWeight / 1.0);
  const T = Math.max(0.1, 1.0 + (article.trendingScore || 0) / 2.5);
  const R = 2.0 / (1.0 + daysOld / 7);
  const Q = article.qualityScore || 0.5;
  const U = 0.3 + (Math.min(1.0, articlesInSamePub / 20) * 0.7);

  const score =
    SCORE_WEIGHTS.categoryBoost * C +
    SCORE_WEIGHTS.trendingBoost * T +
    SCORE_WEIGHTS.recencyBoost * R +
    SCORE_WEIGHTS.qualityBoost * Q +
    SCORE_WEIGHTS.crossUserCollab * U;

  return Math.round(score * 1000) / 1000; // Round to 3 decimal places
}

/**
 * Sort an array of articles by their composite score, highest first.
 */
export function rankArticles(
  articles: Article[],
  userCategoryWeights: Record<string, number>
): Article[] {
  return [...articles].sort((a, b) => {
    const weightA = userCategoryWeights[a.category] || 1.0;
    const weightB = userCategoryWeights[b.category] || 1.0;
    const scoreA = calculateArticleScore(a, weightA);
    const scoreB = calculateArticleScore(b, weightB);
    return scoreB - scoreA;
  });
}

/**
 * Select a "Surprise Me" article: an article from index 10+ in the ranked queue.
 * If the queue is too short, falls back to the last article.
 */
export function selectSurpriseArticle(rankedArticles: Article[], minIndex: number = 10): Article | null {
  if (rankedArticles.length <= minIndex) {
    return rankedArticles.length > 0 ? rankedArticles[rankedArticles.length - 1] : null;
  }
  // Pick a random index between minIndex and the end of the array
  const randomIndex = minIndex + Math.floor(Math.random() * (rankedArticles.length - minIndex));
  return rankedArticles[randomIndex];
}

/**
 * Estimate reading time in minutes based on body HTML length.
 * Rough heuristic: ~238 words per minute, ~5 characters per word, ~1 word per 5 HTML chars.
 */
export function estimateReadMinutes(htmlContent: string): number {
  const textLength = htmlContent.replace(/<[^>]*>/g, '').length;
  const estimatedWords = textLength / 5;
  const minutes = Math.ceil(estimatedWords / 238);
  return Math.max(1, minutes);
}
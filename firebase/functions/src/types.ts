// ============================================================
// SubTick — Cloud Functions Type Definitions
// ============================================================

export interface UserProfile {
  userId: string;
  isOnboarded: boolean;
  selectedCategoryIds: string[];
  notInterestedCategoryIds: string[];
  categoryWeights: Record<string, number>;
  categoryLengthWeights?: Record<string, number>;
  publisherWeights?: Record<string, number>;
  themePreference: 'system' | 'light' | 'dark';
  linkedGoogleAccount: boolean;
  totalArticlesRead: number;
  weeklyReadCount: number;
  currentStreakDays: number;
  lastReadDate: number;
  averageWpm: number;
  dashboardMetricIds: string[];
  includeArchivedArticles?: boolean;
  totalReadTimeMs?: number;
  weightUpdatedAt?: number; // Watermark: timestamp of the last event processed by updateWeights
  lastUpdated: number;
}

export interface Article {
  id: string;
  title: string;
  author: string;
  publicationName: string;
  publicationUrl: string;
  feedUrl: string;
  category: string;
  lengthStyle: string;
  guid?: string;
  isTruncatedFeed?: boolean;
  bodyHtml?: string; // Optional for legacy fallback; no longer populated
  description?: string;
  publishDate: number;
  cacheTimestamp: number;
  isPaywalled: boolean;
  headerImageUrl?: string;
  wordCount?: number;
  estimatedReadMinutes: number;
  trendingScore: number;
  peakTrendingScore: number; // All-time high trendingScore — never decays, used for cleanup ranking
  qualityScore: number;
  isSeed: boolean;
  rssStatus?: 'current' | 'archived';
  frontendRules?: {
    removeCss?: string[];
    injectCss?: string;
  };
}

export interface ArticleScoreDetail {
  /** Normalized personalization component [0,1] computed by the real algorithm. */
  scoreP: number;
  /** Normalized trending component [0,1]. */
  scoreT: number;
  /** Normalized recency component [0,1]. */
  scoreR: number;
  /** Normalized quality component [0,1]. */
  scoreQ: number;
  /** Full weighted final score (0.60P + 0.15T + 0.10R + 0.15Q). */
  finalScore: number;
  /** Tranche the article landed in during feed assembly. */
  tranche: 'high' | 'mid' | 'tail';
  /** Scoring component that contributed most to the final score. */
  dominant: 'P' | 'T' | 'R' | 'Q';
}

export type BehaviorEventType =
  | 'swipe_next'
  | 'swipe_not_interested'
  | 'like'
  | 'unlike'
  | 'save'
  | 'unsave'
  | 'read_thorough'
  | 'read_skim'
  | 'read_shallow'
  | 'quick_exit';

export interface BehaviorEvent {
  id: string; // Client-generated ID used as Firestore document ID for idempotent retries
  articleId: string;
  userId: string;
  eventType: BehaviorEventType;
  timestamp: number;
  articleCategory: string;
  lengthStyle: string;
  publicationName?: string;
  sessionDuration: number;
  scrollDepth: number;
  actualWordCount?: number;
}

export interface RankedFeedResult {
  articles: Article[];
  generatedAt: number;
  remainingCount: number;
}

export interface FeedSource {
  url: string;
  category: string;
  publicationName: string;
  qualityScore: number;
  isActive?: boolean;
  forceArchived?: boolean;
  frontendRules?: {
    removeCss?: string[];
    injectCss?: string;
  };
}
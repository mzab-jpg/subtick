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
  themePreference: 'system' | 'light' | 'dark';
  linkedGoogleAccount: boolean;
  totalArticlesRead: number;
  totalArticlesSaved: number;
  totalArticlesLiked: number;
  weeklyReadCount: number;
  currentStreakDays: number;
  lastReadDate: number;
  averageWpm: number;
  dashboardMetricIds: string[];
  includeArchivedArticles?: boolean;
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
  qualityScore: number;
  isSeed: boolean;
  rssStatus?: 'current' | 'archived';
}

export type BehaviorEventType =
  | 'swipe_next'
  | 'swipe_not_interested'
  | 'like'
  | 'save'
  | 'read_thorough'
  | 'read_skim'
  | 'read_shallow'
  | 'quick_exit';

export interface BehaviorEvent {
  articleId: string;
  userId: string;
  eventType: BehaviorEventType;
  timestamp: number;
  articleCategory: string;
  lengthStyle: string;
  sessionDuration: number;
  scrollDepth: number;
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
}

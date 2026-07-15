// ============================================================
// SubTick — Cloud Functions Type Definitions
// ============================================================

export interface UserProfile {
  userId: string;
  isOnboarded: boolean;
  selectedCategoryIds: string[];
  notInterestedCategoryIds: string[];
  categoryWeights: Record<string, number>;
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
  bodyHtml: string;
  description?: string;
  publishDate: number;
  cacheTimestamp: number;
  isPaywalled: boolean;
  headerImageUrl?: string;
  estimatedReadMinutes: number;
  trendingScore: number;
  qualityScore: number;
  isSeed: boolean;
}

export type BehaviorEventType =
  | 'swipe_next'
  | 'swipe_not_interested'
  | 'scroll_80'
  | 'like'
  | 'save'
  | 'dwell_5min'
  | 'quick_exit'
  | 'scroll_20'
  | 'scroll_40';

export interface BehaviorEvent {
  articleId: string;
  userId: string;
  eventType: BehaviorEventType;
  timestamp: number;
  articleCategory: string;
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
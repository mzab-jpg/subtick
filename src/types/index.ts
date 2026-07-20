// ============================================================
// SubTick — Central Type Definitions
// ============================================================

// --- User Profile (Firestore: users/{userId}) ---
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
  totalArticlesSaved: number;
  totalArticlesLiked: number;
  weeklyReadCount: number;
  currentStreakDays: number;
  lastReadDate: number; // ms timestamp
  averageWpm: number;
  dashboardMetricIds: string[]; // up to 3 metric card IDs selected by user
  includeArchivedArticles?: boolean; // Whether user opts-in to reading raw Substack URIs for old articles
  totalReadTimeMs?: number; // total active reading time in ms
  lastUpdated: number;
}

// --- Article (Firestore: articles/{id}) ---
export interface Article {
  id: string; // Generated hash of URL/title to prevent duplicates
  title: string;
  author: string;
  publicationName: string;
  publicationUrl: string;
  feedUrl: string;
  category: string; // Matches category ids
  lengthStyle: string; // "short", "medium", "long"
  guid?: string;
  isTruncatedFeed?: boolean;
  bodyHtml?: string; // Optional for legacy fallback; no longer populated
  description?: string;
  publishDate: number; // ms timestamp
  cacheTimestamp: number; // ms timestamp when fetched
  isPaywalled: boolean;
  headerImageUrl?: string;
  wordCount?: number;
  estimatedReadMinutes: number;
  trendingScore: number; // Daily calculated score
  qualityScore: number; // Baseline publisher score (0.0 to 1.0)
  isSeed: boolean; // Set to false for real fetched RSS items
  rssStatus?: 'current' | 'archived'; // Indicates if article is available in live RSS
}

// --- Behavior Event (Firestore: behavior_events/{id}) ---
export interface BehaviorEvent {
  articleId: string;
  userId: string;
  eventType: BehaviorEventType;
  timestamp: number;
  articleCategory: string;
  lengthStyle: string;
  publicationName?: string;
  sessionDuration: number; // ms spent in active session
  scrollDepth: number; // Max scroll percentage (0.0 - 1.0)
  actualWordCount?: number;
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

// --- Feed Request (Firestore: feed_requests/{id}) ---
export interface FeedRequest {
  userId: string;
  url: string;
  description?: string;
  timestamp: number;
  status: 'pending' | 'approved' | 'rejected';
}

// --- Category Definition ---
export interface CategoryDefinition {
  id: string;
  name: string;
  emoji: string;
  description: string;
}

// --- Pending Behavior Event (offline queue) ---
export interface PendingBehaviorEvent {
  id: string; // uuid
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
  synced: boolean;
}

// --- Ranked Feed Result ---
export interface RankedFeedResult {
  articles: Article[];
  generatedAt: number;
  remainingCount: number;
}

// --- Dashboard Metric ---
export interface DashboardMetric {
  id: string;
  label: string;
  emoji: string;
  value: string | number;
}

// --- Theme ---
export type ThemeMode = 'system' | 'light' | 'dark';

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceSecondary: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
  primaryLight: string;
  accent: string;
  border: string;
  error: string;
  success: string;
  warning: string;
  cardShadow: string;
  hudBackground: string;
  progressBar: string;
  progressBarBackground: string;
  skeleton: string;
  skeletonHighlight: string;
  chipSelectedBg: string;
  chipNotInterestedBg: string;
  chipNeutralBg: string;
  chipSelectedText: string;
  chipNotInterestedText: string;
  chipNeutralText: string;
}

// --- Navigation Param Lists ---
export type RootStackParamList = {
  Dashboard: { onboardingSelections?: any };
  Onboarding: undefined;
  Reader: { articleId: string; queueArticleIds?: string[]; startIndex?: number; userWpm?: number; mode?: 'feed' | 'history' | 'saved'; mockArticle?: Article; mockHtml?: string };
  Settings: undefined;
  History: undefined;
  SavedReads: undefined;
};

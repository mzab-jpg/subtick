// ============================================================
// SubTick — Central Type Definitions
// ============================================================

// --- User Profile (Firestore: users/{userId}) ---
export interface UserProfile {
  userId: string;
  isOnboarded: boolean;
  isActive?: boolean; // Default true; soft-delete flag for admin safety
  selectedCategoryIds: string[];
  notInterestedCategoryIds: string[];
  categoryWeights: Record<string, number>;
  categoryLengthWeights?: Record<string, number>;
  publisherWeights?: Record<string, number>;
  themePreference: 'system' | 'light' | 'dark';
  linkedGoogleAccount: boolean;
  userEmail?: string; // Email from linked Google account
  seenArticleIds?: string[]; // Cross-device seen article dedup (capped at 1000)
  totalArticlesRead: number;
  weeklyReadCount: number;
  currentStreakDays: number;
  lastReadDate: number; // ms timestamp
  averageWpm: number;
  dashboardMetricIds: string[]; // up to 3 metric card IDs selected by user
  includeArchivedArticles?: boolean; // Whether user opts-in to reading raw Substack URIs for old articles
  totalReadTimeMs?: number; // total active reading time in ms
  weightUpdatedAt?: number; // Watermark: timestamp of the last event processed by updateWeights
  weightsDecayedAt?: number; // Timestamp of the last time preference decay was applied
  quickExitCategorySignals?: Record<string, Record<string, number>>; // server-owned category -> distinct article IDs -> quick-exit timestamps
  lastUpdated: number;
}

// --- Article (Firestore: articles/{id}) ---
export interface RecommendationContext {
  /** Identifies the particular recommendation batch that contained this article. */
  feedId: string;
  /** Identifies this one article at this one position in that recommendation batch. */
  impressionId: string;
}

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
  peakTrendingScore: number; // All-time high trendingScore — never decays, used for cleanup ranking
  qualityScore: number; // Baseline publisher score (0.0 to 1.0)
  isSeed: boolean; // Set to false for real fetched RSS items
  rssStatus?: 'current' | 'archived'; // Indicates if article is available in live RSS
  frontendRules?: {
    removeCss?: string[];   // CSS selectors to hide (e.g. subscribe widgets, paywall overlays)
    injectCss?: string;     // Raw CSS to inject for per-publisher styling fixes
  };
  /** Present only on articles returned by the ranked-feed callable. Never stored on articles. */
  recommendationContext?: RecommendationContext;
}

// --- Behavior Event (Firestore: behavior_events/{id}) ---
export interface BehaviorEvent {
  id: string; // Client-generated ID used as Firestore document ID for idempotent retries
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
  /** Present when this action came from a ranked recommendation. */
  feedId?: string;
  impressionId?: string;
}

export type BehaviorEventType =
  | 'read_session' // Raw session telemetry; the backend assigns the final read outcome.
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
  /** Present when this action came from a ranked recommendation. */
  feedId?: string;
  impressionId?: string;
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
  Reader: {
    articleId: string;
    queueArticleIds?: string[];
    /** Recommendation context by article ID; present only for a live ranked-feed queue. */
    recommendationContexts?: Record<string, RecommendationContext>;
    startIndex?: number;
    userWpm?: number;
    mode?: 'feed' | 'history' | 'saved';
    mockArticle?: Article;
  };
  Settings: undefined;
  History: undefined;
  SavedReads: undefined;
  CategoryPreferences: undefined;
  DashboardStats: undefined;
  DeveloperOptions: undefined;
  Feedback: undefined;
  FeedRequest: undefined;
  Account: undefined;
};

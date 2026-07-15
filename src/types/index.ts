// ============================================================
// SubTick — Central Type Definitions
// ============================================================

// --- User Profile (Firestore: users/{userId}) ---
export interface UserProfile {
  userId: string;
  isOnboarded: boolean;
  selectedCategoryIds: string[];
  notInterestedCategoryIds: string[];
  categoryWeights: Record<string, number>; // e.g. { "tech": 1.5, "finance": 0.2 }
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
  bodyHtml: string; // Cleaned, sanitized HTML
  description?: string;
  publishDate: number; // ms timestamp
  cacheTimestamp: number; // ms timestamp when fetched
  isPaywalled: boolean;
  headerImageUrl?: string;
  estimatedReadMinutes: number;
  trendingScore: number; // Daily calculated score
  qualityScore: number; // Baseline publisher score (0.0 to 1.0)
  isSeed: boolean; // Set to false for real fetched RSS items
}

// --- Behavior Event (Firestore: behavior_events/{id}) ---
export interface BehaviorEvent {
  articleId: string;
  userId: string;
  eventType: BehaviorEventType;
  timestamp: number;
  articleCategory: string;
  sessionDuration: number; // ms spent in active session
  scrollDepth: number; // Max scroll percentage (0.0 - 1.0)
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
  sessionDuration: number;
  scrollDepth: number;
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
  Onboarding: undefined;
  Dashboard: undefined;
  Reader: { articleId: string; queueArticleIds: string[]; startIndex: number };
  Settings: undefined;
};
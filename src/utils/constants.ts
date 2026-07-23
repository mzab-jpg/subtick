// ============================================================
// SubTick — Constants & Configuration
// ============================================================

// --- Type Scale ---
// Every fontSize in the app must use one of these 6 values.
// Do not use arbitrary font sizes anywhere.
export const TEXT_XS   = 11;  // Publisher eyebrow labels (uppercase, tight tracking)
export const TEXT_SM   = 13;  // Metadata, timestamps, captions, helper text
export const TEXT_BASE = 16;  // Body, buttons, inputs, category names
export const TEXT_LG   = 18;  // Screen headers, section titles, article list titles
export const TEXT_XL   = 24;  // App name / primary screen title
export const TEXT_2XL  = 28;  // Hero article headline

import { CategoryDefinition } from '../types';

// --- Category Definitions ---
export const CATEGORIES: CategoryDefinition[] = [
  {
    id: 'Technology & Innovation',
    name: 'Tech & Innovation',
    emoji: '💻',
    description: 'Software, startups, AI, and the future of computing',
  },
  {
    id: 'Business & Finance',
    name: 'Business & Finance',
    emoji: '📈',
    description: 'Markets, investing, economics, and business strategy',
  },
  {
    id: 'Politics & Global Affairs',
    name: 'Politics & Global Affairs',
    emoji: '🏛️',
    description: 'Policy, governance, and current affairs analysis',
  },
  {
    id: 'Arts & Culture',
    name: 'Arts & Culture',
    emoji: '🎭',
    description: 'Media, internet culture, arts, and social commentary',
  },
  {
    id: 'Science & Health',
    name: 'Science & Health',
    emoji: '🔬',
    description: 'Public health, rationality, and scientific discovery',
  },
  {
    id: 'Philosophy & Human Behavior',
    name: 'Philosophy & Human Behavior',
    emoji: '🧠',
    description: 'Deep thinking, psychology, and cognitive science',
  },
];

// --- Default Category Weights ---
export const DEFAULT_SELECTED_WEIGHT = 1.5;
export const DEFAULT_NOT_INTERESTED_WEIGHT = 0.2;
export const DEFAULT_NEUTRAL_WEIGHT = 1.0;

// --- Scoring Formula Weights ---
export const SCORE_WEIGHTS = {
  categoryBoost: 0.3,
  trendingBoost: 0.2,
  recencyBoost: 0.25,
  qualityBoost: 0.15,
  crossUserCollab: 0.1,
};

// --- Feedback Delta Multipliers (Δ) ---
// Must stay in sync with firebase/functions/src/constants.ts
export const FEEDBACK_DELTAS: Record<string, number> = {
  save: 0.55,
  like: 0.40,
  read_thorough: 0.30,
  read_skim: 0.10,
  read_shallow: 0.00,
  swipe_next: 0.00,
  quick_exit: -0.20,
  swipe_not_interested: -0.40,
};

// --- Learning Rate ---
export const LEARNING_RATE = 0.08;

// --- Weight Clamping ---
export const MIN_CATEGORY_WEIGHT = 0.1;
export const MAX_CATEGORY_WEIGHT = 5.0;

// --- Daily Decay Rate ---
export const DAILY_DECAY_RATE = 0.995; // 0.5% daily decay

// --- Feed Configuration ---
export const MAX_FEED_ARTICLES = 30;
export const CANDIDATE_POOL_SIZE = 200;
export const SURPRISE_ME_MIN_INDEX = 10;

// --- Quick Exit Thresholds (15 seconds, <20% scroll) ---
// These match the thresholds used in useBehaviorTracker.ts concludeSession()
export const QUICK_EXIT_MAX_DURATION_MS = 15_000;
export const QUICK_EXIT_MAX_SCROLL = 0.2;

// --- Dwell Threshold ---
export const DWELL_THRESHOLD_MS = 5 * 60_000; // 5 minutes

// --- Available Dashboard Metrics ---
export const DASHBOARD_METRIC_DEFS = [
  { id: 'streak', label: 'Streak Days', emoji: '🔥' },
  { id: 'avgWpm', label: 'Avg WPM', emoji: '⏱️' },
  { id: 'totalReadTime', label: 'Hours Read', emoji: '⏳' },
  { id: 'totalRead', label: 'Finished', emoji: '📚' },
  { id: 'topCategory', label: 'Top Category', emoji: '📈' },
  { id: 'weeklyReads', label: 'Weekly Reads', emoji: '📊' },
];

// --- Default Average WPM Fallback ---
export const DEFAULT_AVG_WPM = 200;

// --- Default Dashboard Metrics (shown if user hasn't customized) ---
export const DEFAULT_DASHBOARD_METRIC_IDS = ['streak', 'totalReadTime', 'avgWpm'];

// --- Firebase Emulator Configuration ---
// In dev mode (__DEV__), the app connects to Firebase Emulator Suite on localhost.
// In production, these are ignored and live Firebase services are used.
export const FIREBASE_EMULATOR_CONFIG = {
  auth: { host: 'localhost', port: 9099 },
  firestore: { host: 'localhost', port: 8080 },
  functions: { host: 'localhost', port: 5001 },
};

// --- Offline Sync Configuration ---
export const BEHAVIOR_QUEUE_KEY = '@subtick_behavior_queue';
export const SEEN_ARTICLES_KEY = '@subtick_seen_articles';
export const SAVED_ARTICLES_KEY = '@subtick_saved_articles';
// Stores lightweight metadata objects (title, publicationName, category) for local list rendering
export const SEEN_ARTICLES_META_KEY = '@subtick_seen_articles_meta';
export const SAVED_ARTICLES_META_KEY = '@subtick_saved_articles_meta';
// Prefix for per-article flags marking RSS feeds as permanently failed on this device
export const RSS_FAILED_KEY_PREFIX = '@subtick_rss_failed_';
export const SYNC_BATCH_SIZE = 20;
export const MAX_QUEUE_SIZE = 500;

// --- Paywall Detection Keywords ---
export const PAYWALL_KEYWORDS = [
  'To read this post, subscribe',
  'Paid subscription required',
  'This post is for paid subscribers',
  'Upgrade to paid',
  'Subscribe to continue reading',
  'Behind the paywall',
  'This content is for subscribers only',
  'You\'ve reached the free preview',
  'Subscribe now to read the full post',
  'Continue reading with a paid subscription',
  'free preview',
  'start your 7-day free trial',
  'unlock this post',
  'read the rest of this',
  'upgrade your subscription',
  'exclusive to paid',
  'to read the rest',
  'keep reading with a 7-day',
  'keep reading with a free trial',
  'this is a free preview',
  'subscribe to read',
  'upgrade to read',
  'paid subscribers only',
  'this post is for paid',
];

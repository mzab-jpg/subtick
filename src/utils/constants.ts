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

// --- Category Definitions (9 categories) ---
export const CATEGORIES: CategoryDefinition[] = [
  {
    id: 'Politics',
    name: 'Politics',
    emoji: '🏛️',
    description: 'U.S. politics, world affairs, policy, and international relations',
  },
  {
    id: 'Business',
    name: 'Business',
    emoji: '💼',
    description: 'Business strategy, entrepreneurship, and economics',
  },
  {
    id: 'Finance',
    name: 'Finance',
    emoji: '📈',
    description: 'Investing, markets, crypto, and financial analysis',
  },
  {
    id: 'Technology',
    name: 'Technology',
    emoji: '💻',
    description: 'Software, AI, programming, and tech industry analysis',
  },
  {
    id: 'Science',
    name: 'Science',
    emoji: '🔬',
    description: 'Scientific discovery, climate, medicine, and rationality',
  },
  {
    id: 'History',
    name: 'History',
    emoji: '📜',
    description: 'History, archaeology, and long-form historical essays',
  },
  {
    id: 'Culture',
    name: 'Culture',
    emoji: '🎨',
    description: 'Literature, philosophy, arts, religion, and design',
  },
  {
    id: 'Lifestyle',
    name: 'Lifestyle',
    emoji: '🌿',
    description: 'Health, wellness, food, travel, home, and fashion',
  },
  {
    id: 'Entertainment',
    name: 'Entertainment',
    emoji: '🎬',
    description: 'Film, TV, music, fiction, comics, and humor',
  },
];

// --- Default Category Weights ---
export const DEFAULT_SELECTED_WEIGHT = 1.5;
export const DEFAULT_NOT_INTERESTED_WEIGHT = 0.2;
export const DEFAULT_NEUTRAL_WEIGHT = 1.0;

// --- Feed Configuration ---
export const MAX_FEED_ARTICLES = 30;
// A3 Fix: Skip only the 3 visible cards (hero + 2 rows), not 10 invisible positions.
export const SURPRISE_ME_MIN_INDEX = 3;

// --- Quick Exit Thresholds ---
// Named constants matching the thresholds in useBehaviorTracker.ts concludeSession()
export const QUICK_EXIT_MAX_DURATION_MS = 15_000; // 15 seconds
export const QUICK_EXIT_MAX_SCROLL = 0.2;         // 20% scroll depth

// --- Available Dashboard Metrics ---
export const DASHBOARD_METRIC_DEFS = [
  { id: 'streak', label: 'Streak Days', emoji: '🔥' },
  { id: 'avgWpm', label: 'Avg WPM', emoji: '⏱️' },
  { id: 'totalReadTime', label: 'Hours Read', emoji: '⏳' },
  { id: 'totalRead', label: 'Finished', emoji: '📚' },
  { id: 'topCategory', label: 'Top Category', emoji: '📈' },
  { id: 'weeklyReads', label: 'Weekly Reads', emoji: '📊' },
];

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


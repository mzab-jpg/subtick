// ============================================================
// SubTick — Constants & Configuration
// ============================================================

// --- Type Scale ---
// Every fontSize in the app must use one of these 6 values.
// Do not use arbitrary font sizes anywhere.
// Hero article headline

import { CategoryDefinition, ThemeFonts } from '../types';
export const TEXT_XS   = 11;  // Publisher eyebrow labels (uppercase, tight tracking)
export const TEXT_SM   = 13;  // Metadata, timestamps, captions, helper text
export const TEXT_BASE = 16;  // Body, buttons, inputs, category names
export const TEXT_LG   = 18;  // Screen headers, section titles, article list titles
export const TEXT_XL   = 24;  // App name / primary screen title
export const TEXT_2XL  = 28;

// --- Mono Label (JetBrains Mini-Label) ---
// The app's universal metadata voice: publishers, read times, percentages,
// section labels. Always pair with `fontFamily: fonts.mono`, uppercase text,
// and 0.08em letterSpacing. Consumes ThemeFonts so the family stays in sync.
export const MONO_LABEL_BASE: Pick<
  import('react-native').TextStyle,
  'fontSize' | 'letterSpacing' | 'textTransform' | 'fontWeight'
> = {
  fontSize: 10,
  letterSpacing: 0.8, // 0.08em at 10px
  textTransform: 'uppercase',
  fontWeight: '500',
};

export function monoLabel(fonts: ThemeFonts): import('react-native').TextStyle {
  return { ...MONO_LABEL_BASE, fontFamily: fonts.mono };
}

// --- Category Definitions (9 categories) ---
// CONTRACT: this list must stay in sync with the SERVER's canonical copy in
// firebase/functions/src/categories.ts (`DASHBOARD_CATEGORIES_ARRAY`).
// `npm run test:category-contract` fails loudly if they drift. Update BOTH
// together when categories change. Future: move this list into the server's
// system/scoringConfig and fetch it, so there is exactly one source.
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
export const DEFAULT_SELECTED_WEIGHT = 0.85;   // latent x → σ ≈ 0.70
export const DEFAULT_NOT_INTERESTED_WEIGHT = -0.85; // latent x → σ ≈ 0.30
export const DEFAULT_NEUTRAL_WEIGHT = 0.0;     // latent x → σ = 0.50

// --- Feed Configuration ---
export const MAX_FEED_ARTICLES = 30;
// A3 Fix: Skip only the 3 visible cards (hero + 2 rows), not 10 invisible positions.
export const SURPRISE_ME_MIN_INDEX = 3;

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
// Audit fix: outbox for save-mirror writes that failed while offline
export const PENDING_SAVE_MIRRORS_KEY = '@subtick_pending_save_mirrors';

// --- WPM Calibration Guardrails (WPM Fix) ---
// Mirrors firebase/functions/src/constants.ts — keep both in sync.
// Only sessions inside the human-plausibility band may recalibrate a user's
// displayed reading speed; skims and abandoned opens are excluded.
export const MIN_PLAUSIBLE_WPM = 80;   // below: idle/paused screen, not reading
export const MAX_PLAUSIBLE_WPM = 600;  // above: scrolling/skimming, not reading
// Sessions consuming fewer words than this carry no reliable pace signal.
export const MIN_WPM_CALIBRATION_WORDS = 150;


// ============================================================
// SubTick — scoringConfig.ts
// SINGLE SOURCE OF TRUTH for every tunable algorithm value.
//
// The compiled defaults below are identical to today's hard-coded
// values. At runtime, functions load the active config from the
// `system/scoringConfig` Firestore document, merge it over defaults,
// clamp values into safe ranges, and cache ~60s per warm instance.
// `updateScoringConfig` (callable) writes that document, so the
// Control Dashboard and the live algorithm always agree.
// ============================================================

import * as admin from 'firebase-admin';
import {
  SCORE_WEIGHTS,
  SCORE_WEIGHTS_TAIL,
  FEEDBACK_DELTAS,
  LEARNING_RATE,
  MIN_CATEGORY_WEIGHT,
  MAX_CATEGORY_WEIGHT,
  DAILY_DECAY_RATE,
  TRENDING_DECAY_RATE,
  MAX_TRENDING_SCORE,
  DEFAULT_SELECTED_WEIGHT,
  DEFAULT_NOT_INTERESTED_WEIGHT,
  DEFAULT_NEUTRAL_WEIGHT,
} from './constants.js';

const db = admin.firestore();

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------
export type ReadEventType =
  | 'read_thorough'
  | 'read_skim'
  | 'read_shallow'
  | 'quick_exit'
  | 'swipe_next';

export interface ScoringConfig {
  schemaVersion: number;
  scoring: {
    personalization: number; // SCORE_WEIGHTS.personalization (0.60)
    trending: number;        // SCORE_WEIGHTS.trending (0.15)
    recency: number;         // SCORE_WEIGHTS.recency (0.10)
    quality: number;         // SCORE_WEIGHTS.quality (0.15)
    tailTrending: number;    // SCORE_WEIGHTS_TAIL.trending (0.43)
    tailRecency: number;     // SCORE_WEIGHTS_TAIL.recency (0.57)
    maxTrendingScore: number;// MAX_TRENDING_SCORE (50)
    // Used only until a user has any stored interaction with a publisher.
    publisherColdStartCategoryWeight: number; // 0.90
    publisherColdStartPublisherWeight: number; // 0.10
  };
  feedback: Record<string, number>; // FEEDBACK_DELTAS (per action)
  learning: {
    baseRate: number;           // LEARNING_RATE (0.08)
    categoryMultiplier: number; // 1.0
    lengthMultiplier: number;   // 1.5
    publisherMultiplier: number;// 2.0
    minWeight: number;          // MIN_CATEGORY_WEIGHT (0.1)
    maxWeight: number;          // MAX_CATEGORY_WEIGHT (5.0)
    dailyDecayRate: number;     // DAILY_DECAY_RATE (0.995)
    defaultSelectedWeight: number;      // DEFAULT_SELECTED_WEIGHT (1.5)
    defaultNotInterestedWeight: number; // DEFAULT_NOT_INTERESTED_WEIGHT (0.2)
    defaultNeutralWeight: number;       // DEFAULT_NEUTRAL_WEIGHT (1.0)
    repeatedQuickExitThreshold: number; // 3 distinct articles in one category
    repeatedQuickExitLookbackDays: number; // 14
  };
  trending: {
    decayRate: number; // TRENDING_DECAY_RATE (0.9057) — used by the decay cron
    save: number; unsave: number; like: number; unlike: number;
    read_thorough: number; read_skim: number; read_shallow: number;
  };
  quality: {
    save: number; unsave: number; like: number; unlike: number;
    read_thorough: number; read_skim: number;
    swipe_not_interested: number; quick_exit: number;
  };
  tranche: {
    highThreshold: number; // 0.40
    midThreshold: number;  // 0.20
    highSize: number;      // 12
    midSize: number;       // 8
    tailSize: number;      // 10
    publisherCap: number;  // 5
    newUserThreshold: number; // 30 (below this → tail randomised)
    feedSize: number;      // 30 (RETURN_FEED_SIZE)
    maxArticlesPerCategory: number; // 15, relaxed only when alternatives are exhausted
    minDistinctCategories: number;  // 4, when eligible alternatives exist
  };
  classification: {
    quickExitDepth: number;     // 0.2
    quickExitTimeoutSec: number;// 15
    thoroughDepth: number;      // 0.70
    thoroughTimeFraction: number; // 0.60
    shallowDepth: number;       // 0.40
  };
}

// ------------------------------------------------------------------
// Defaults — EXACTLY the current hard-coded values. The safe fallback.
// ------------------------------------------------------------------
export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  schemaVersion: 1,
  scoring: {
    personalization: SCORE_WEIGHTS.personalization,
    trending: SCORE_WEIGHTS.trending,
    recency: SCORE_WEIGHTS.recency,
    quality: SCORE_WEIGHTS.quality,
    tailTrending: SCORE_WEIGHTS_TAIL.trending,
    tailRecency: SCORE_WEIGHTS_TAIL.recency,
    maxTrendingScore: MAX_TRENDING_SCORE,
    publisherColdStartCategoryWeight: 0.90,
    publisherColdStartPublisherWeight: 0.10,
  },
  feedback: { ...FEEDBACK_DELTAS },
  learning: {
    baseRate: LEARNING_RATE,
    categoryMultiplier: 1.0,
    lengthMultiplier: 1.5,
    publisherMultiplier: 2.0,
    minWeight: MIN_CATEGORY_WEIGHT,
    maxWeight: MAX_CATEGORY_WEIGHT,
    dailyDecayRate: DAILY_DECAY_RATE,
    defaultSelectedWeight: DEFAULT_SELECTED_WEIGHT,
    defaultNotInterestedWeight: DEFAULT_NOT_INTERESTED_WEIGHT,
    defaultNeutralWeight: DEFAULT_NEUTRAL_WEIGHT,
    repeatedQuickExitThreshold: 3,
    repeatedQuickExitLookbackDays: 14,
  },
  trending: {
    decayRate: TRENDING_DECAY_RATE,
    save: 3.0, unsave: -3.0, like: 2.0, unlike: -2.0,
    read_thorough: 1.5, read_skim: 0.5, read_shallow: 0.2,
  },
  quality: {
    save: 0.010, unsave: -0.010, like: 0.005, unlike: -0.005,
    read_thorough: 0.005, read_skim: 0.001,
    swipe_not_interested: -0.010, quick_exit: -0.005,
  },
  tranche: {
    highThreshold: 0.40,
    midThreshold: 0.20,
    highSize: 12,
    midSize: 8,
    tailSize: 10,
    publisherCap: 5,
    newUserThreshold: 30,
    feedSize: 30,
    maxArticlesPerCategory: 15,
    minDistinctCategories: 4,
  },
  classification: {
    quickExitDepth: 0.2,
    quickExitTimeoutSec: 15,
    thoroughDepth: 0.70,
    thoroughTimeFraction: 0.60,
    shallowDepth: 0.40,
  },
};

// ------------------------------------------------------------------
// Helpers: deep merge + value clamping
// ------------------------------------------------------------------
export function deepMerge(base: any, overrides: any): any {
  if (Array.isArray(base) || Array.isArray(overrides)) {
    return overrides !== undefined ? overrides : base;
  }
  if (base !== null && typeof base === 'object' && overrides !== null && typeof overrides === 'object') {
    const out: any = { ...base };
    for (const key of Object.keys(overrides)) {
      out[key] = deepMerge(base[key], overrides[key]);
    }
    return out;
  }
  return overrides !== undefined ? overrides : base;
}

// Safe range map (dotted path → [min, max]). Unknown numeric leaves are
// sanity-clamped so a bad write can never poison the algorithm.
const NUM_RANGES: Record<string, [number, number]> = {
  'scoring.personalization': [0, 1.5], 'scoring.trending': [0, 1.5], 'scoring.recency': [0, 1.5], 'scoring.quality': [0, 1.5],
  'scoring.tailTrending': [0, 1.5], 'scoring.tailRecency': [0, 1.5], 'scoring.maxTrendingScore': [1, 200],
  'scoring.publisherColdStartCategoryWeight': [0, 1], 'scoring.publisherColdStartPublisherWeight': [0, 1],
  'learning.baseRate': [0, 1], 'learning.categoryMultiplier': [0, 5], 'learning.lengthMultiplier': [0, 5], 'learning.publisherMultiplier': [0, 5],
  'learning.minWeight': [0.01, 1], 'learning.maxWeight': [1, 10], 'learning.dailyDecayRate': [0.5, 1],
  'learning.defaultSelectedWeight': [1, 5], 'learning.defaultNotInterestedWeight': [0.01, 1], 'learning.defaultNeutralWeight': [0.5, 2],
  'learning.repeatedQuickExitThreshold': [1, 20], 'learning.repeatedQuickExitLookbackDays': [1, 90],
  'trending.decayRate': [0.5, 1],
  'tranche.highThreshold': [0, 1], 'tranche.midThreshold': [0, 1], 'tranche.highSize': [1, 50], 'tranche.midSize': [1, 50], 'tranche.tailSize': [1, 50],
  'tranche.publisherCap': [1, 30], 'tranche.newUserThreshold': [0, 500], 'tranche.feedSize': [1, 100],
  'tranche.maxArticlesPerCategory': [1, 100], 'tranche.minDistinctCategories': [1, 20],
  'classification.quickExitDepth': [0, 1], 'classification.quickExitTimeoutSec': [1, 120],
  'classification.thoroughDepth': [0, 1], 'classification.thoroughTimeFraction': [0.1, 2], 'classification.shallowDepth': [0, 1],
};

for (const key of Object.keys(FEEDBACK_DELTAS)) NUM_RANGES[`feedback.${key}`] = [-1, 1];
for (const key of Object.keys(DEFAULT_SCORING_CONFIG.trending)) NUM_RANGES[`trending.${key}`] = [-10, 10];
for (const key of Object.keys(DEFAULT_SCORING_CONFIG.quality)) NUM_RANGES[`quality.${key}`] = [-0.2, 0.2];

const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function clampConfig(cfg: any): any {
  const walk = (node: any, path: string): any => {
    if (node === null || typeof node !== 'object') {
      if (typeof node === 'number' && Number.isFinite(node)) {
        const [lo, hi] = NUM_RANGES[path] || [-1000, 1000];
        return clampNum(node, lo, hi);
      }
      return node;
    }
    const out: any = Array.isArray(node) ? [] : {};
    for (const k of Object.keys(node)) {
      out[k] = walk(node[k], path ? `${path}.${k}` : k);
    }
    return out;
  };
  const clamped = walk(cfg, '');
  const coldStart = clamped.scoring;
  const coldStartTotal = coldStart.publisherColdStartCategoryWeight + coldStart.publisherColdStartPublisherWeight;
  if (coldStartTotal > 0) {
    coldStart.publisherColdStartCategoryWeight /= coldStartTotal;
    coldStart.publisherColdStartPublisherWeight /= coldStartTotal;
  } else {
    coldStart.publisherColdStartCategoryWeight = 0.90;
    coldStart.publisherColdStartPublisherWeight = 0.10;
  }
  return clamped;
}

// ------------------------------------------------------------------
// Runtime loader — reads system/scoringConfig, merges over defaults,
// clamps, caches ~60s per warm container.
// ------------------------------------------------------------------
/**
 * Build a request-scoped ScoringConfig from an override (e.g. the Control
 * Dashboard sending a draft config for a "preview before publish" run).
 * Merges over compiled defaults, clamps every numeric leaf, and returns it.
 * Does NOT read or write Firestore, and does NOT touch the shared cache —
 * the override is used only for the single calling request. Returns
 * undefined when no override is supplied, so callers can fall back to the
 * normal cached loadScoringConfig().
 */
export function prepareConfig(override?: Partial<ScoringConfig>): ScoringConfig | undefined {
  if (!override) return undefined;
  return clampConfig(deepMerge(JSON.parse(JSON.stringify(DEFAULT_SCORING_CONFIG)), override)) as ScoringConfig;
}

const CONFIG_CACHE_TTL_MS = 60 * 1000;
let configCache: ScoringConfig | null = null;
let configCacheTimestamp = 0;

export async function loadScoringConfig(): Promise<ScoringConfig> {
  const now = Date.now();
  if (configCache && now - configCacheTimestamp < CONFIG_CACHE_TTL_MS) {
    return configCache;
  }
  try {
    const snap = await db.collection('system').doc('scoringConfig').get();
    if (snap.exists) {
      const stored = snap.data() as any;
      const merged = clampConfig(deepMerge(JSON.parse(JSON.stringify(DEFAULT_SCORING_CONFIG)), stored));
      merged.schemaVersion = Number.isFinite(merged.schemaVersion) ? merged.schemaVersion : 1;
      configCache = merged as ScoringConfig;
    } else {
      configCache = JSON.parse(JSON.stringify(DEFAULT_SCORING_CONFIG)) as ScoringConfig;
    }
    configCacheTimestamp = now;
  } catch (err: any) {
    console.warn('[scoringConfig] Config read failed, using defaults:', err.message);
    configCache = JSON.parse(JSON.stringify(DEFAULT_SCORING_CONFIG)) as ScoringConfig;
    configCacheTimestamp = now;
  }
  return configCache;
}

/** Force the next load to re-read Firestore (called after updateScoringConfig). */
export function invalidateConfigCache(): void {
  configCache = null;
  configCacheTimestamp = 0;
}

// ------------------------------------------------------------------
// Read classification — answers "what counts as a skim / thorough read?"
// Every raw read_session is classified on the server using these live rules.
// ------------------------------------------------------------------
export function classifyRead(
  cfg: ScoringConfig,
  scrollDepth: number,
  sessionDurationMs: number,
  actualWordCount: number,
  wpm: number
): ReadEventType {
  const c = cfg.classification;

  if (scrollDepth < c.quickExitDepth && sessionDurationMs < c.quickExitTimeoutSec * 1000) {
    return 'quick_exit';
  }
  if (scrollDepth >= c.thoroughDepth) {
    const expectedMs = actualWordCount > 0 ? (actualWordCount / Math.max(50, wpm || 200)) * 60000 : 0;
    if (expectedMs <= 0 || sessionDurationMs >= expectedMs * c.thoroughTimeFraction) {
      return 'read_thorough';
    }
    return 'read_skim';
  }
  if (scrollDepth >= c.shallowDepth) {
    return 'read_shallow';
  }
  return 'swipe_next';
}
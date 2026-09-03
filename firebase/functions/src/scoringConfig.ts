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

import { db } from './firebaseAdmin.js';
import {
  SCORE_WEIGHTS,
  FEEDBACK_DELTAS,
  TRENDING_DECAY_RATE,
  TRENDING_HALF_SAT,
  RECENCY_DAYS_CONSTANT,
  LATENT_CLAMP,
  LATENT_NIGHTLY_DECAY,
  LATENT_DRIFT_FLOOR,
  DEFAULT_PUBLISHER_LATENT,
  DEFAULT_SELECTED_LATENT,
  DEFAULT_NOT_INTERESTED_LATENT,
  DEFAULT_NEUTRAL_LATENT,
  MIN_PLAUSIBLE_WPM,
  MAX_PLAUSIBLE_WPM,
  MIN_WPM_CALIBRATION_WORDS,
  PAYWALL_KEYWORDS,
} from './constants.js';

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
    personalization: number;
    trending: number;
    recency: number;
    quality: number;
    trendingHalfSat: number;
    recencyDaysConstant: number;
    publisherColdStartCategoryWeight: number;
    publisherColdStartPublisherWeight: number;
  };
  feedback: Record<string, number>;
  engagement: {
    fullRatio: number;
    skimRatio: number;
    flingRatio: number;
    skimPenalty: number;
    flingPenalty: number;
  };
  latent: {
    clamp: number;
    nightlyDecay: number;
    driftFloor: number;
    publisherSeed: number;
    selectedLatent: number;
    notInterestedLatent: number;
    neutralLatent: number;
  };
  /** Shape of the preference-strength curve: σ(steepness · x). */
  sigmoid: {
    steepness: number;
  };
  /** How strongly user actions move each preference axis. */
  learning: {
    categorySensitivity: number;
    lengthSensitivity: number;
    publisherSensitivity: number;
    positiveSensitivity: number;
    rejectionSensitivity: number;
  };
  /** Threshold-based quick-exit rejection (accidental taps no longer hit at full strength). */
  rejection: {
    categoryMinQuickExits: number;
    lengthMinQuickExits: number;
    publisherMinQuickExits: number;
    windowMs: number;
    maxCategoryPenalty: number;
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
  selection: {
    feedSize: number;
    categoryPenaltyStep: number;
    publisherPenaltyStep: number;
    discoverySlotInterval: number;
    jitterRange: number;
    maxArticlesPerCategory: number;
    minDistinctCategories: number;
  };
  classification: {
    quickExitDepth: number;
    quickExitTimeoutSec: number;
    thoroughDepth: number;
    shallowDepth: number;
  };
  /** Human reading-speed plausibility bands (WPM calibration + engagement fallback). */
  wpm: {
    minPlausible: number;
    maxPlausible: number;
    minCalibrationWords: number;
  };
  /** Candidate-pool construction knobs (cron + on-the-fly fallback). */
  pool: {
    boxQueryLimit: number;
    fallbackFreshCutoffDays: number;
    fallbackQueryCap: number;
    minArticleWords: number;
  };
  /** RSS ingestion + event-sync throughput knobs. */
  ingestion: {
    feedChunkSize: number;
    parseTimeoutSec: number;
    ogTimeoutSec: number;
    maxEventsPerSync: number;
  };
  /** Housekeeping: cleanup crons, pruning, batch sizes. */
  maintenance: {
    cleanupMinAgeDays: number;
    cleanupSampleSize: number;
    cleanupDeleteFraction: number;
    stickerExpiryDays: number;
    stickerFlipCap: number;
    trendingDecayMinScore: number;
    seenTrimOver: number;
    seenTrimKeep: number;
    deleteBatchSize: number;
  };
  /** Paywall detection phrases (matched case-insensitively against title/description/body). */
  paywallKeywords: string[];
}

// ------------------------------------------------------------------
// Defaults — EXACTLY the current hard-coded values. The safe fallback.
// ------------------------------------------------------------------
export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  schemaVersion: 2,
  scoring: {
    personalization: SCORE_WEIGHTS.personalization,
    trending: SCORE_WEIGHTS.trending,
    recency: SCORE_WEIGHTS.recency,
    quality: SCORE_WEIGHTS.quality,
    trendingHalfSat: TRENDING_HALF_SAT,
    recencyDaysConstant: RECENCY_DAYS_CONSTANT,
    publisherColdStartCategoryWeight: 0.90,
    publisherColdStartPublisherWeight: 0.10,
  },
  feedback: { ...FEEDBACK_DELTAS },
  engagement: {
    fullRatio: 1.25,
    skimRatio: 2.0,
    flingRatio: 3.0,
    skimPenalty: 0.50,
    flingPenalty: 0.0,
  },
  latent: {
    clamp: LATENT_CLAMP,
    nightlyDecay: LATENT_NIGHTLY_DECAY,
    driftFloor: LATENT_DRIFT_FLOOR,
    publisherSeed: DEFAULT_PUBLISHER_LATENT,
    selectedLatent: DEFAULT_SELECTED_LATENT,
    notInterestedLatent: DEFAULT_NOT_INTERESTED_LATENT,
    neutralLatent: DEFAULT_NEUTRAL_LATENT,
  },
  sigmoid: {
    steepness: 1,
  },
  learning: {
    categorySensitivity: 1,
    lengthSensitivity: 1,
    publisherSensitivity: 1,
    positiveSensitivity: 1,
    rejectionSensitivity: 1,
  },
  rejection: {
    categoryMinQuickExits: 2,
    lengthMinQuickExits: 2,
    publisherMinQuickExits: 2,
    windowMs: 24 * 60 * 60 * 1000, // 24h rolling window
    maxCategoryPenalty: 0.6875,   // one real rejection's worth, capped
  },
  trending: {
    decayRate: TRENDING_DECAY_RATE,
    save: 3.0, unsave: -3.0, like: 2.0, unlike: -2.0,
    read_thorough: 1.5, read_skim: 0.5, read_shallow: 0.2,
  },
  quality: {
    save: 0.010, unsave: -0.010, like: 0.005, unlike: -0.005,
    read_thorough: 0.005, read_skim: 0.001,
    swipe_not_interested: -0.010, quick_exit: -0.010,
  },
  selection: {
    feedSize: 30,
    categoryPenaltyStep: 0.15,
    publisherPenaltyStep: 0.25,
    discoverySlotInterval: 5,
    jitterRange: 0.03,
    maxArticlesPerCategory: 15,
    minDistinctCategories: 4,
  },
  classification: {
    quickExitDepth: 0.2,
    quickExitTimeoutSec: 15,
    thoroughDepth: 0.70,
    shallowDepth: 0.40,
  },
  wpm: {
    minPlausible: MIN_PLAUSIBLE_WPM,
    maxPlausible: MAX_PLAUSIBLE_WPM,
    minCalibrationWords: MIN_WPM_CALIBRATION_WORDS,
  },
  pool: {
    boxQueryLimit: 500,
    fallbackFreshCutoffDays: 28,
    fallbackQueryCap: 2000,
    minArticleWords: 150,
  },
  ingestion: {
    feedChunkSize: 5,
    parseTimeoutSec: 15,
    ogTimeoutSec: 6,
    maxEventsPerSync: 100,
  },
  maintenance: {
    cleanupMinAgeDays: 90,
    cleanupSampleSize: 500,
    cleanupDeleteFraction: 0.03,
    stickerExpiryDays: 28,
    stickerFlipCap: 2000,
    trendingDecayMinScore: 1.0,
    seenTrimOver: 5000,
    seenTrimKeep: 4000,
    deleteBatchSize: 400,
  },
  paywallKeywords: [...PAYWALL_KEYWORDS],
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

// Safe range map (dotted path → [min, max, step]). Unknown numeric leaves are
// sanity-clamped so a bad write can never poison the algorithm. The step is
// ignored by clamping and used by the Control Dashboard dials.
export const NUM_RANGES: Record<string, [number, number, number]> = {
  'scoring.personalization': [0, 1.5, 0.01], 'scoring.trending': [0, 1.5, 0.01], 'scoring.recency': [0, 1.5, 0.01], 'scoring.quality': [0, 1.5, 0.01],
  'scoring.trendingHalfSat': [1, 200, 1], 'scoring.recencyDaysConstant': [1, 90, 1],
  'scoring.publisherColdStartCategoryWeight': [0, 1, 0.01], 'scoring.publisherColdStartPublisherWeight': [0, 1, 0.01],
  'engagement.fullRatio': [0.5, 3, 0.05], 'engagement.skimRatio': [1, 5, 0.05], 'engagement.flingRatio': [1, 8, 0.05],
  'engagement.skimPenalty': [0, 1, 0.01], 'engagement.flingPenalty': [0, 1, 0.01],
  'latent.clamp': [5, 50, 1], 'latent.nightlyDecay': [0.5, 1, 0.001], 'latent.driftFloor': [0, 3, 0.01],
  'latent.publisherSeed': [-3, 3, 0.01], 'latent.selectedLatent': [0, 3, 0.01], 'latent.notInterestedLatent': [-3, 0, 0.01],
  'sigmoid.steepness': [0.25, 4, 0.05],
  'learning.categorySensitivity': [0, 2, 0.05], 'learning.lengthSensitivity': [0, 2, 0.05],
  'learning.publisherSensitivity': [0, 2, 0.05], 'learning.positiveSensitivity': [0, 2, 0.05],
  'learning.rejectionSensitivity': [0, 2, 0.05],
  'selection.feedSize': [1, 100, 1], 'selection.categoryPenaltyStep': [0, 0.5, 0.01], 'selection.publisherPenaltyStep': [0, 0.5, 0.01],
  'selection.discoverySlotInterval': [1, 20, 1], 'selection.jitterRange': [0, 0.1, 0.005],
  'selection.maxArticlesPerCategory': [1, 100, 1], 'selection.minDistinctCategories': [1, 20, 1],
  'rejection.categoryMinQuickExits': [1, 20, 1], 'rejection.lengthMinQuickExits': [1, 20, 1],
  'rejection.publisherMinQuickExits': [1, 20, 1], 'rejection.windowMs': [24 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000],
  'rejection.maxCategoryPenalty': [0.1, 2, 0.01],
  'classification.quickExitDepth': [0, 1, 0.01], 'classification.quickExitTimeoutSec': [1, 120, 1],
  'classification.thoroughDepth': [0, 1, 0.01], 'classification.shallowDepth': [0, 1, 0.01],
  'wpm.minPlausible': [20, 300, 5], 'wpm.maxPlausible': [200, 1500, 10], 'wpm.minCalibrationWords': [0, 1000, 10],
  'pool.boxQueryLimit': [50, 1000, 50], 'pool.fallbackFreshCutoffDays': [7, 90, 1],
  'pool.fallbackQueryCap': [100, 5000, 100], 'pool.minArticleWords': [0, 1000, 10],
  'ingestion.feedChunkSize': [1, 20, 1], 'ingestion.parseTimeoutSec': [5, 60, 1],
  'ingestion.ogTimeoutSec': [2, 30, 1], 'ingestion.maxEventsPerSync': [20, 500, 10],
  'maintenance.cleanupMinAgeDays': [30, 365, 1], 'maintenance.cleanupSampleSize': [100, 2000, 50],
  'maintenance.cleanupDeleteFraction': [0, 0.2, 0.005], 'maintenance.stickerExpiryDays': [7, 90, 1],
  'maintenance.stickerFlipCap': [100, 10000, 100], 'maintenance.trendingDecayMinScore': [0, 10, 0.1],
  'maintenance.seenTrimOver': [1000, 20000, 100], 'maintenance.seenTrimKeep': [500, 15000, 100],
  'maintenance.deleteBatchSize': [100, 500, 10],
};

for (const key of Object.keys(FEEDBACK_DELTAS)) NUM_RANGES[`feedback.${key}`] = [-1, 1, 0.05];
for (const key of Object.keys(DEFAULT_SCORING_CONFIG.trending)) NUM_RANGES[`trending.${key}`] = [-10, 10, 0.1];
NUM_RANGES['trending.decayRate'] = [0.5, 1, 0.001]; // finer step than the generic trending range
for (const key of Object.keys(DEFAULT_SCORING_CONFIG.quality)) NUM_RANGES[`quality.${key}`] = [-0.2, 0.2, 0.005];
NUM_RANGES['engagement.fullRatio'] = [0.5, 3, 0.05];
NUM_RANGES['engagement.skimRatio'] = [1, 5, 0.05];
NUM_RANGES['engagement.flingRatio'] = [1, 8, 0.05];
NUM_RANGES['engagement.skimPenalty'] = [0, 1, 0.01];
NUM_RANGES['engagement.flingPenalty'] = [0, 1, 0.01];

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
// Sigmoid + latent + engagement math (pure, unit-testable)
// ------------------------------------------------------------------

/** Logistic sigmoid: maps unbounded latent x → (0,1), σ(0) = 0.5.
 *  steepness scales the input: higher = sharper dislike↔like transitions,
 *  lower = softer, more gradual preference strength. Default 1 (classic curve). */
export function sigmoid(x: number, steepness = 1): number {
  const s = Math.max(0.05, steepness);
  return 1 / (1 + Math.exp(-(s * x)));
}

/** Inverse sigmoid (log-odds). */
export function logit(p: number): number {
  const q = Math.max(1e-6, Math.min(1 - 1e-6, p));
  return Math.log(q / (1 - q));
}

/** Clamp a latent score to the safe write-time band. */
export function clampLatent(x: number, cfg?: Pick<ScoringConfig, 'latent'>): number {
  const limit = cfg?.latent?.clamp ?? 20;
  return Math.max(-limit, Math.min(limit, x));
}

/**
 * Engagement Index (E) — continuous trust for a read session.
 * pace penalty is derived from implied speed ÷ the user's own averageWpm,
 * so a naturally-fast reader is not misclassified as a skimmer.
 * E = scrollDepth × pacePenalty ∈ [0,1]; E scales learning deltas.
 */
export function computeEngagementIndex(
  scrollDepth: number,
  sessionDurationMs: number,
  actualWordCount: number | undefined,
  averageWpm: number | undefined,
  cfg: ScoringConfig
): number {
  const depth = Math.min(1, Math.max(0, scrollDepth || 0));
  if (!actualWordCount || actualWordCount <= 0 || sessionDurationMs <= 0) return depth;
  const consumedWords = Math.round(actualWordCount * depth);
  if (consumedWords < cfg.wpm.minCalibrationWords) return depth;
  const sessionWpm = consumedWords / (sessionDurationMs / 60_000);
  const baseline = averageWpm && averageWpm > 0 ? averageWpm : cfg.wpm.maxPlausible;
  const ratio = sessionWpm / baseline;
  const e = cfg.engagement;
  let pacePenalty: number;
  if (ratio <= e.fullRatio) pacePenalty = 1;
  else if (ratio <= e.skimRatio) {
    const t = (ratio - e.fullRatio) / Math.max(1e-6, e.skimRatio - e.fullRatio);
    pacePenalty = 1 - t * (1 - e.skimPenalty);
  } else if (ratio <= e.flingRatio) {
    const t = (ratio - e.skimRatio) / Math.max(1e-6, e.flingRatio - e.skimRatio);
    pacePenalty = e.skimPenalty - t * (e.skimPenalty - e.flingPenalty);
  } else {
    pacePenalty = e.flingPenalty;
  }
  return depth * pacePenalty;
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
// Read classification — answers "what counts as a read?"
// Stats spec (user-defined):
//   hours read & WPM  → every visit contributes (no label gates here)
//   Finished          → scrollDepth >= thoroughDepth (70%)
//   weekly reads      → scrollDepth >= shallowDepth  (40%)
// Pace plays no role in labelling; the WPM plausibility band guards
// speed calibration separately (see weightUpdater.ts).
// ------------------------------------------------------------------
export function classifyRead(
  cfg: ScoringConfig,
  scrollDepth: number,
  _sessionDurationMs: number,
  _actualWordCount: number,
  _wpm: number
): ReadEventType {
  const c = cfg.classification;

  if (scrollDepth < c.quickExitDepth && _sessionDurationMs < c.quickExitTimeoutSec * 1000) {
    return 'quick_exit';
  }
  if (scrollDepth >= c.thoroughDepth) {
    return 'read_thorough';
  }
  if (scrollDepth >= c.shallowDepth) {
    return 'read_shallow';
  }
  return 'swipe_next';
}
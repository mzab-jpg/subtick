// ============================================================
// SubTick — weightUpdater (Internal helper, called by syncBehaviorEvents)
// Computes weight adjustments using feedback delta multipliers,
// learning rate, clamping, and daily decay.
// Reads events from nested subcollections: users/{userId}/behavior_events
// ============================================================

import { db } from './firebaseAdmin.js';
import { BehaviorEvent, UserProfile } from './types.js';
import { DASHBOARD_CATEGORIES } from './categories.js';
import {
  FEEDBACK_DELTAS,
} from './constants.js';
import { sendGAEvents, sendGAUserProperties } from './analytics.js';
import {
  loadScoringConfig,
  ScoringConfig,
  sigmoid,
  clampLatent,
  computeEngagementIndex,
} from './scoringConfig.js';

export const READ_VISIT_TYPES = new Set<string>(['read_thorough', 'read_skim', 'read_shallow', 'swipe_next']);

/**
 * Threshold-based quick-exit rejection.
 *
 * A single quick exit (−0.6875, i.e. −2.5× a thorough read) punished all three
 * preference axes at full strength, but it cannot distinguish "opened the wrong
 * card and backed out" from "genuinely repelled by this content". That made
 * accidental taps suppress a category as strongly as real dislike.
 *
 * Instead we COUNT quick exits per preference axis inside a rolling window and
 * apply ONE capped penalty only once the axis's configured minimum is reached
 * (`rejection.*` in DEFAULT_SCORING_CONFIG). A positive signal on the same axis
 * clears the evidence, so a category is never permanently poisoned by a bad few
 * taps. All knobs are configurable for the future Control Dashboard work.
 */
type RejectionEvidence = Record<string, { count: number; windowStart: number }>;

const LENGTH_STYLES = ['short', 'medium', 'long'];

function axisMinQuickExits(key: string, cfg: ScoringConfig): number {
  const r = cfg.rejection;
  if (key.startsWith('pub::')) return r.publisherMinQuickExits;
  if (LENGTH_STYLES.includes(key)) return r.lengthMinQuickExits;
  return r.categoryMinQuickExits;
}

/** Per-axis learning multiplier: how fast THIS axis's preference moves. */
function axisLearningSensitivity(key: string, cfg: ScoringConfig): number {
  if (key.startsWith('pub::')) return cfg.learning.publisherSensitivity;
  if (LENGTH_STYLES.includes(key)) return cfg.learning.lengthSensitivity;
  return cfg.learning.categorySensitivity;
}

/** Axis keys a quick exit touches: category, length-style, and publisher. */
function quickExitAxisKeys(event: BehaviorEvent): string[] {
  const keys: string[] = [event.articleCategory];
  if (event.lengthStyle && LENGTH_STYLES.includes(event.lengthStyle)) keys.push(event.lengthStyle);
  if (event.publicationName) keys.push(`pub::${event.publicationName}`);
  return keys;
}

/**
 * Record one quick exit and, when an axis first crosses its minimum within the
 * window, apply a single capped penalty to that axis's latent.
 */
export function applyQuickExitRejection(
  event: BehaviorEvent,
  cfg: ScoringConfig,
  evidence: RejectionEvidence,
  latents: Record<string, number>,
  deltas: Record<string, number>,
  neutralLatent: number
): void {
  const windowMs = cfg.rejection.windowMs;
  const basePenalty = cfg.rejection.maxCategoryPenalty;

  for (const key of quickExitAxisKeys(event)) {
    if (!key) continue;
    const entry = evidence[key];
    if (!entry || event.timestamp - entry.windowStart > windowMs) {
      evidence[key] = { count: 0, windowStart: event.timestamp };
    }
    evidence[key].count += 1;

    // Apply exactly once, when the threshold is first crossed (capped). The
    // penalty scales by the rejection dial and by this axis's learning
    // sensitivity, so certified rejections hit as hard as configured.
    if (evidence[key].count === axisMinQuickExits(key, cfg)) {
      const magnitude = basePenalty
        * cfg.learning.rejectionSensitivity
        * axisLearningSensitivity(key, cfg);
      latents[key] = (latents[key] ?? neutralLatent) - magnitude;
      deltas[key] = (deltas[key] || 0) - magnitude;
    }
  }
}

/**
 * Attention Factor (Engagement-Credit Model) — geometry classifies, attention scales.
 *
 * Implied speed = words actually consumed (article length × furthest scroll)
 * ÷ active minutes, compared against two wide-moat absolute bands chosen so
 * measurement noise cannot flip them:
 *   ≤ MAX_PLAUSIBLE_WPM        → A = 1    (genuine reading)
 *   MAX..FLING_WPM             → A = 0.35 (skimmed through — partial trust)
 *   > FLING_WPM                → A = 0    (fling — algorithmically inert)
 *
 * Visits without a usable word count default to full strength; this is the
 * Engagement Index (E) — continuous trust for a read session, backed by
 * computeEngagementIndex (see scoringConfig.ts). Deliberate actions pass
 * unscaled; read visits scale by E = scrollDepth × pace-penalty.
 */
export function computeAttentionFactor(
  scrollDepth: number,
  sessionDurationMs: number,
  actualWordCount: number | undefined,
  cfg: ScoringConfig,
  averageWpm?: number
): number {
  return computeEngagementIndex(scrollDepth, sessionDurationMs, actualWordCount, averageWpm, cfg);
}

/**
 * Update category weights for a user based on their recent behavior events.
 * Apply latent steps (δ) scaled by the Engagement Index E.
 * Write-time clamped to ±latent.clamp; nightly drift pulls toward 0.0.
 *
 * NOTE: Reads directly from users/{userId}/behavior_events subcollection
 * which is inherently partitioned by user. Filters by timestamp in memory.
 */
export async function updateWeights(userId: string, clientId?: string, providedCfg?: ScoringConfig): Promise<void> {
  // GA4 web-stream client_id passed through from syncBehaviorEvents. Falls back
  // to '' if missing — analytics.ts will mint a random id. Never the Auth UID.
  const effectiveClientId = clientId || '';
  // Single source of truth for all tunable values (cached ~60s per instance).
  // Reuse a caller-supplied config (e.g. preview override) when given; else load live.
  const cfg = providedCfg ?? await loadScoringConfig();
  // 1. Fetch user profile
  const userRef = db.collection('users').doc(userId);
  const userDoc = await userRef.get();
  if (!userDoc.exists) {
    console.log(`[weightUpdater] User ${userId} not found`);
    return;
  }

  const profile = userDoc.data() as UserProfile;
  // One internal map lets category, category+length, and publisher preferences
  // receive the same elapsed-day decay even when no new event touches them.
  const currentWeights: Record<string, number> = {
    ...profile.categoryWeights,
    ...Object.fromEntries(Object.entries(profile.lengthWeights || {})),
    ...Object.fromEntries(Object.entries(profile.publisherWeights || {}).map(([publisher, weight]) => [`pub::${publisher}`, weight])),
  };
  const now = Date.now();

  // P0 Fix: Use a watermark (weightUpdatedAt) so we only process NEW events,
  // never replay events that were already applied in a previous sync.
  // On first run, fall back to 24h ago to bootstrap from recent history.
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const watermark = profile.weightUpdatedAt ?? oneDayAgo;

  // 2. Fetch only events that arrived AFTER the last processed watermark.
  const eventsSnapshot = await db
    .collection('users')
    .doc(userId)
    .collection('behavior_events')
    .where('timestamp', '>', watermark)
    .orderBy('timestamp', 'asc')
    .limit(100)
    .get();

  if (eventsSnapshot.empty) {
    console.log(`[weightUpdater] No new events since watermark (${new Date(watermark).toISOString()}) for ${userId}`);
    return;
  }

  // 3. Collect new events and track the most recent timestamp for the new watermark.
  const events: BehaviorEvent[] = [];
  let latestEventTimestamp = watermark;
  eventsSnapshot.forEach((doc) => {
    const event = doc.data() as BehaviorEvent;
    events.push(event);
    if (event.timestamp > latestEventTimestamp) {
      latestEventTimestamp = event.timestamp;
    }
  });

  console.log(`[weightUpdater] Processing ${events.length} new events for ${userId} (since ${new Date(watermark).toISOString()})`);

  // 4. Apply explicit/strong feedback deltas. A single quick exit stays
  // 4. Apply latent steps (δ) scaled by the Engagement Index for read visits;
  // deliberate tap-actions keep full strength. A quick exit is a single
  // asymmetric rejection step (δ_neg). No repeated-evidence counter.
  const updatedLatents = { ...currentWeights };
  const deltasByCategory: Record<string, number> = {};
  const neutralLatent = cfg.latent.neutralLatent ?? 0;

  const rejectionEvidence: RejectionEvidence = { ...(profile.rejectionEvidence || {}) };

  for (const event of events) {
    const category = event.articleCategory;
    if (!category) {
      console.warn(`[weightUpdater] Event missing category: ${event.eventType}`);
      continue;
    }

    // Category-contract safety net: an unknown category means the client/server
    // lists have drifted — surface it loudly instead of silently mis-ranking.
    if (!DASHBOARD_CATEGORIES.has(category)) {
      console.error(`[weightUpdater] Category "${category}" is not in DASHBOARD_CATEGORIES — client/server category lists have drifted?`);
    }

    // Threshold-based rejection: quick exits are counted per axis and only apply
    // once the configured minimum is reached within the window (accidental taps
    // no longer hit at full strength).
    if (event.eventType === 'quick_exit') {
      applyQuickExitRejection(event, cfg, rejectionEvidence, updatedLatents, deltasByCategory, neutralLatent);
      continue;
    }

    const isReadVisit = READ_VISIT_TYPES.has(event.eventType);
    const engagement = isReadVisit
      ? computeAttentionFactor(event.scrollDepth, event.sessionDuration, event.actualWordCount, cfg, profile.averageWpm)
      : 1;

    const rawDelta = ((cfg.feedback as any)[event.eventType] ?? 0) * engagement;
    if (rawDelta === 0) continue;

    // Sensitivity: the global positive/rejection dial × this axis's learning
    // multiplier decides how strongly this event moves each preference axis.
    const direction = rawDelta > 0 ? cfg.learning.positiveSensitivity : cfg.learning.rejectionSensitivity;

    // A positive signal clears that axis's rejection evidence — the category
    // isn't actually disliked after all. (Cleared regardless of sensitivity —
    // engaging positively proves the axis isn't disliked.)
    if (rawDelta > 0) {
      delete rejectionEvidence[category];
      if (event.lengthStyle && LENGTH_STYLES.includes(event.lengthStyle)) delete rejectionEvidence[event.lengthStyle];
      if (event.publicationName) delete rejectionEvidence[`pub::${event.publicationName}`];
    }

    const categoryDelta = rawDelta * direction * cfg.learning.categorySensitivity;
    if (categoryDelta === 0) continue;

    updatedLatents[category] = (updatedLatents[category] ?? neutralLatent) + categoryDelta;
    deltasByCategory[category] = (deltasByCategory[category] || 0) + categoryDelta;

    // Global length preference
    if (event.lengthStyle && LENGTH_STYLES.includes(event.lengthStyle)) {
      const lengthDelta = rawDelta * direction * cfg.learning.lengthSensitivity;
      updatedLatents[event.lengthStyle] = (updatedLatents[event.lengthStyle] ?? neutralLatent) + lengthDelta;
    }
    if (event.publicationName) {
      const pubKey = `pub::${event.publicationName}`;
      const pubDelta = rawDelta * direction * cfg.learning.publisherSensitivity;
      updatedLatents[pubKey] = (updatedLatents[pubKey] ?? neutralLatent) + pubDelta;
    }
  }

  // 5. Clamp latents to safe write-time band.
  for (const key of Object.keys(updatedLatents)) {
    updatedLatents[key] = clampLatent(updatedLatents[key], cfg);
  }

  // 6. Apply nightly latent drift toward 0.
  const decayReference = profile.weightsDecayedAt ?? profile.weightUpdatedAt ?? now;
  const elapsedDays = Math.floor(Math.max(0, now - decayReference) / (24 * 60 * 60 * 1000));
  const effectiveDecayRate = Math.pow(cfg.latent.nightlyDecay, elapsedDays);
  const decayedLatents = elapsedDays > 0 ? applyLatentDrift(updatedLatents, effectiveDecayRate, cfg.latent.driftFloor) : updatedLatents;
  if (elapsedDays > 0) {
    console.log(`[weightUpdater] Applying ${elapsedDays} day(s) of latent drift for ${userId}`);
  }

  // 7. Split latents back into category / length / publisher maps + Sync UI
  const newCategoryWeights: Record<string, number> = {};
  const newLengthWeights: Record<string, number> = {};
  const newPublisherWeights: Record<string, number> = {};

  const newSelectedCategoryIds = new Set(profile.selectedCategoryIds || []);
  const newNotInterestedCategoryIds = new Set(profile.notInterestedCategoryIds || []);
  let uiArraysChanged = false;

  for (const [key, val] of Object.entries(decayedLatents)) {
    if (key.startsWith('pub::')) {
      newPublisherWeights[key.replace('pub::', '')] = val;
    } else if (key === 'short' || key === 'medium' || key === 'long') {
      newLengthWeights[key] = val;
    } else {
      newCategoryWeights[key] = val;

      // Dynamic UI Sync: Adjust UI arrays based on latent confidence
      if (val <= cfg.latent.notInterestedLatent) {
        if (!newNotInterestedCategoryIds.has(key)) {
          newNotInterestedCategoryIds.add(key);
          newSelectedCategoryIds.delete(key);
          uiArraysChanged = true;
        }
      } else if (val >= cfg.latent.selectedLatent) {
        if (!newSelectedCategoryIds.has(key)) {
          newSelectedCategoryIds.add(key);
          newNotInterestedCategoryIds.delete(key);
          uiArraysChanged = true;
        }
      } else if (val > cfg.latent.notInterestedLatent && val < cfg.latent.selectedLatent && newNotInterestedCategoryIds.has(key)) {
        newNotInterestedCategoryIds.delete(key);
        uiArraysChanged = true;
      }
    }
  }

  // 8. Calculate Rolling Average WPM & Total Reading Time
  // We look for events where the user finished reading an article
  let newAverageWpm = profile.averageWpm || 200;
  let wpmUpdated = false;
  
  let newTotalReadTimeMs = profile.totalReadTimeMs || 0;
  let readTimeUpdated = false;
  
  let newTotalArticlesFinished = profile.totalArticlesRead || 0;
  let articlesFinishedUpdated = false;

  for (const event of events) {
    // Hours-read spec change: EVERY article visit's active time counts —
    // including shallow reads, not-interested swipes past 15s, and quick
    // exits. Only pure tap-actions (like/unlike/save/unsave/swipe-not-
    // interested toggles) are excluded, because they would double-count
    // seconds already recorded by that visit's main session record.
    if (
      event.eventType === 'read_thorough' || event.eventType === 'read_skim' ||
      event.eventType === 'read_shallow' || event.eventType === 'swipe_next' ||
      event.eventType === 'quick_exit'
    ) {
      newTotalReadTimeMs += event.sessionDuration;
      readTimeUpdated = true;
    }

    // Completion spec: Finished requires 70%+ depth — labelled read_thorough
    // by the classifier. The retired read_skim label stays accepted here so a
    // legacy in-flight event can never be silently dropped during rollout.
    if (event.eventType === 'read_thorough' || event.eventType === 'read_skim') {
      newTotalArticlesFinished++;
      articlesFinishedUpdated = true;
    }

    // WPM Fix — yardstick protection, now open to every visit per the stats
    // spec ("WPM is always counted"). Label gates removed; corruption is
    // prevented purely by the mechanical guards, which junk cannot pass:
    //   1. Consumed words only — article length × furthest scroll reached.
    //   2. Minimum-word floor — tiny snippets carry no pace signal.
    //   3. Human-plausibility band [MIN, MAX] — an abandoned open of a long
    //      article computes an absurd implied speed (e.g. ~10,000 WPM) and
    //      excludes itself; accepted contributions are clamped.
    if (event.sessionDuration > 0) {
      const depthFraction = Math.min(1, Math.max(0, event.scrollDepth || 0));
      const consumedWords = Math.round((event.actualWordCount || 0) * depthFraction);
      if (consumedWords >= cfg.wpm.minCalibrationWords) {
        const rawSessionWpm = consumedWords / (event.sessionDuration / 60_000);
        if (rawSessionWpm >= cfg.wpm.minPlausible && rawSessionWpm <= cfg.wpm.maxPlausible) {
          const clampedSessionWpm = Math.min(cfg.wpm.maxPlausible, rawSessionWpm);
          newAverageWpm = Math.round((newAverageWpm * 0.8) + (clampedSessionWpm * 0.2));
          wpmUpdated = true;
        }
      }
    }
  }

  // 9. Update Firestore — advance the watermark to the most recent processed event
  // Audit fix: bound seenArticleIds growth. The array is append-ordered, so
  // keeping the tail preserves the newest entries. Only rewritten when over
  // the cap, with 1,000 slots of headroom so a concurrent client-side
  // arrayUnion can never be lost by the trim.
  let prunedSeenArticleIds: string[] | null = null;
  if (Array.isArray(profile.seenArticleIds) && profile.seenArticleIds.length > cfg.maintenance.seenTrimOver) {
    const trimmedSeenIds = profile.seenArticleIds.slice(-cfg.maintenance.seenTrimKeep);
    prunedSeenArticleIds = trimmedSeenIds;
    console.log(`[weightUpdater] Pruned seenArticleIds from ${profile.seenArticleIds.length} to ${prunedSeenArticleIds.length}`);
  }

  // Persist threshold-rejection evidence only when it changed (including when
  // it was fully cleared by a positive signal).
  const rejectionEvidenceChanged = JSON.stringify(profile.rejectionEvidence || {}) !== JSON.stringify(rejectionEvidence);

  await userRef.update({
    categoryWeights: newCategoryWeights,
    lengthWeights: newLengthWeights,
    publisherWeights: newPublisherWeights,
    weightUpdatedAt: latestEventTimestamp,
    weightsDecayedAt: elapsedDays > 0 ? now : (profile.weightsDecayedAt ?? profile.weightUpdatedAt ?? now),
    ...(rejectionEvidenceChanged && { rejectionEvidence }),
    ...(uiArraysChanged && {
      selectedCategoryIds: Array.from(newSelectedCategoryIds),
      notInterestedCategoryIds: Array.from(newNotInterestedCategoryIds),
    }),
    ...(wpmUpdated && { averageWpm: newAverageWpm }),
    ...(readTimeUpdated && { totalReadTimeMs: newTotalReadTimeMs }),
    ...(articlesFinishedUpdated && { totalArticlesRead: newTotalArticlesFinished }),
    ...(prunedSeenArticleIds && { seenArticleIds: prunedSeenArticleIds }),
    lastUpdated: now,
  });

  // B2 Fix: Gate detailed weight logging behind the emulator flag so production
  // doesn't ship per-user category deltas to billable logs.
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    console.log(
      `[weightUpdater] Updated weights for ${userId}. ` +
      `Deltas: ${Object.entries(deltasByCategory).map(([k, v]) => `${k}${v >= 0 ? '+' : ''}${v.toFixed(3)}`).join(', ')}. ` +
      `Result: ${Object.entries(decayedLatents).slice(0, 5).map(([k, v]) => `${k}=${v.toFixed(3)}`).join(', ')}`
    );
  }

  // --- Analytics: weight_updated events ---
  const weightUpdatedEvents: Array<{ name: string; params: Record<string, any> }> = [];
  const triggerEventType = events.length > 0 ? events[events.length - 1].eventType : 'decay';

  for (const [key, val] of Object.entries(decayedLatents)) {
    const previousVal = currentWeights[key] ?? 0;
    if (Math.abs(val - previousVal) < 0.001) continue; // skip unchanged weights

    let entityType: string;
    let entityId: string;
    if (key.startsWith('pub::')) {
      entityType = 'publisher';
      entityId = key.replace('pub::', '');
    } else if (key === 'short' || key === 'medium' || key === 'long') {
      entityType = 'length';
      entityId = key;
    } else {
      entityType = 'category';
      entityId = key;
    }

    weightUpdatedEvents.push({
      name: 'weight_updated',
      params: {
        user_id: userId,
        entity_type: entityType,
        entity_id: entityId,
        old_value: previousVal,
        new_value: val,
        weight_delta: val - previousVal,
        trigger: triggerEventType,
      },
    });
  }

  // --- Analytics: user properties ---
  const categoryWeightsEntries = Object.entries(newCategoryWeights);
  const sortedByWeight = [...categoryWeightsEntries].sort((a, b) => b[1] - a[1]);
  const topCategoryWeight = sortedByWeight.length > 0 ? sortedByWeight[0][1] : 1.0;
  const categoriesAtCeiling = categoryWeightsEntries.filter(([, w]) => Math.abs(w) >= (cfg.latent.clamp || 20)).length;

  // Concentration score: Herfindahl-like metric — sum of squared fractions of total weight mass.
  const totalWeight = categoryWeightsEntries.reduce((sum, [, w]) => sum + w, 0);
  let concentrationScore = 0;
  if (totalWeight > 0) {
    concentrationScore = categoryWeightsEntries.reduce((sum, [, w]) => sum + Math.pow(w / totalWeight, 2), 0);
  }

  const userProps: Record<string, string> = {
    concentration_score: concentrationScore.toFixed(2),
    top_cat_weight: topCategoryWeight.toFixed(2),
    cats_at_ceiling: categoriesAtCeiling.toString(),
  };

  // Fire-and-forget — analytics events don't block weight updates
  sendGAEvents(effectiveClientId, weightUpdatedEvents).catch(() => {});
  sendGAUserProperties(effectiveClientId, userProps).catch(() => {});

  // 8. Update weekly read count and streak
  // B3 Fix: Pass the already-fetched events into updateReadStats instead of
  // having it run a second Firestore query on the same subcollection.
  await updateReadStats(userId, profile, events);
}

/**
 * Apply nightly latent drift toward a floor (default neutral 0.0).
 * Each latent's MAGNITUDE is scaled by rate (rate = λ^elapsedDays, e.g. 0.95
 * per day) but never crosses below `floor`, and the sign is preserved — so a
 * strong preference sags toward ±floor over a long absence instead of
 * collapsing to neutral, while active users re-earn full control via the same
 * steep daily rate.
 */
export function applyLatentDrift(latents: Record<string, number>, rate: number, floor = 0): Record<string, number> {
  const f = Math.max(0, floor);
  const drifted: Record<string, number> = {};
  for (const [key, val] of Object.entries(latents)) {
    const magnitude = Math.abs(val);
    const newMagnitude = magnitude <= f ? magnitude : Math.max(f, magnitude * rate);
    drifted[key] = (val < 0 ? -1 : 1) * newMagnitude;
  }
  return drifted;
}

/**
 * Update reading stats: weekly count, streak, and last read date.
 *
 * H2 Fix: the server copy of weeklyReadCount is now RECOUNTED directly from
 * this account's behavior_events history every sync instead of being
 * accumulated incrementally. The old accumulate-only math never subtracted
 * reads aging out of the 7-day window, so the stored value grew forever and
 * was wrong on every device except through luck. Because events belong to
 * the account (not any one phone), a recount keeps the server value accurate
 * everywhere — including after switching phones. Only a genuine qualifying
 * read in the current batch may advance the streak; non-reading actions
 * (save/like/unlike/etc.) can no longer fake or extend one.
 */
async function updateReadStats(
  userId: string,
  profile: UserProfile,
  newEvents: BehaviorEvent[]
): Promise<void> {
  const now = Date.now();
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

  // Single-field timestamp filter needs no composite index; the eventType
  // split happens in memory. limit(1000) is a runaway safeguard — a heavy
  // week of reading stays far below it, and exceeding it merely undercounts.
  const weekSnapshot = await db
    .collection('users')
    .doc(userId)
    .collection('behavior_events')
    .where('timestamp', '>=', oneWeekAgo)
    .limit(1000)
    .get();

  let weeklyReadCount = 0;
  weekSnapshot.forEach((doc) => {
    const eventType = doc.data().eventType;
    // Weekly-reads spec: 40%+ depth qualifies — labelled read_thorough (70%+)
    // or read_shallow (40–69%). The retired read_skim label stays accepted for
    // legacy records created before this spec change.
    if (eventType === 'read_thorough' || eventType === 'read_shallow' || eventType === 'read_skim') {
      weeklyReadCount += 1;
    }
  });

  // Streak advances when THIS batch contains a visit at least at the weekly
  // bar (40%+ depth) — keeping "a reading day" consistent with weekly reads.
  const hasQualifyingRead = newEvents.some(
    (event) => event.eventType === 'read_thorough' || event.eventType === 'read_shallow'
  );

  let streak = profile.currentStreakDays || 0;
  if (hasQualifyingRead) {
    const lastDate = new Date(profile.lastReadDate || 0);
    const today = new Date(now);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (lastDate.toDateString() === today.toDateString()) {
      // Already read today — streak unchanged
    } else if (lastDate.toDateString() === yesterday.toDateString()) {
      // Read yesterday — increment streak
      streak += 1;
    } else {
      // Streak broken — restart at 1
      streak = 1;
    }
  }

  await db.collection('users').doc(userId).update({
    weeklyReadCount,
    ...(hasQualifyingRead && { currentStreakDays: streak }),
    ...(hasQualifyingRead && { lastReadDate: now }),
    lastUpdated: now,
  });

  console.log(`[weightUpdater] Stats: weekly=${weeklyReadCount}${hasQualifyingRead ? `, streak=${streak}` : ' (no qualifying read — streak untouched)'}`);
}



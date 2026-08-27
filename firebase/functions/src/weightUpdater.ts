// ============================================================
// SubTick — weightUpdater (Internal helper, called by syncBehaviorEvents)
// Computes weight adjustments using feedback delta multipliers,
// learning rate, clamping, and daily decay.
// Reads events from nested subcollections: users/{userId}/behavior_events
// ============================================================

import { db } from './firebaseAdmin.js';
import { BehaviorEvent, UserProfile } from './types.js';
import {
  FEEDBACK_DELTAS,
  LEARNING_RATE,
  MIN_CATEGORY_WEIGHT,
  MAX_CATEGORY_WEIGHT,
  DAILY_DECAY_RATE,
  DEFAULT_SELECTED_WEIGHT,
  DEFAULT_NOT_INTERESTED_WEIGHT,
  MIN_PLAUSIBLE_WPM,
  MAX_PLAUSIBLE_WPM,
  MIN_WPM_CALIBRATION_WORDS,
} from './constants.js';
import { sendGAEvents, sendGAUserProperties } from './analytics.js';
import { loadScoringConfig, ScoringConfig } from './scoringConfig.js';

export const READ_VISIT_TYPES = new Set<string>(['read_thorough', 'read_skim', 'read_shallow', 'swipe_next']);

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
 * documented raw-webpage edge and is accepted knowingly.
 */
export function computeAttentionFactor(
  scrollDepth: number,
  sessionDurationMs: number,
  actualWordCount: number | undefined,
  cfg: ScoringConfig
): number {
  if (!actualWordCount || actualWordCount <= 0 || sessionDurationMs <= 0) return 1;
  const depthFraction = Math.min(1, Math.max(0, scrollDepth || 0));
  const consumedWords = Math.round(actualWordCount * depthFraction);
  if (consumedWords < MIN_WPM_CALIBRATION_WORDS) return 1;
  const impliedWpm = consumedWords / (sessionDurationMs / 60_000);
  if (impliedWpm > cfg.classification.flingWpm) return 0;
  if (impliedWpm > MAX_PLAUSIBLE_WPM) return 0.35;
  return 1;
}

/**
 * Update category weights for a user based on their recent behavior events.
 * Applies: Δ × L formula, clamps to [0.1, 5.0], and applies 0.5% daily decay.
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
    ...Object.fromEntries(Object.entries(profile.categoryLengthWeights || {})),
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
  // neutral; repeated exits are handled below as category-only weak evidence.
  const updatedWeights = { ...currentWeights };
  const deltasByCategory: Record<string, number> = {};
  const quickExitSignals: Record<string, Record<string, number>> = { ...(profile.quickExitCategorySignals || {}) };
  const quickExitCutoff = now - cfg.learning.repeatedQuickExitLookbackDays * 24 * 60 * 60 * 1000;
  const categoryL = cfg.learning.baseRate * cfg.learning.categoryMultiplier;
  const lengthL = cfg.learning.baseRate * cfg.learning.lengthMultiplier;
  const publisherL = cfg.learning.baseRate * cfg.learning.publisherMultiplier;

  for (const event of events) {
    const category = event.articleCategory;
    if (!category) {
      console.warn(`[weightUpdater] Event missing category: ${event.eventType}`);
      continue;
    }
    if (['read_thorough', 'read_skim', 'like', 'save'].includes(event.eventType)) {
      // Clear evidence accumulated before this clear positive signal. Any later
      // quick exits in the same batch begin a fresh, chronological count.
      delete quickExitSignals[category];
    }

    if (event.eventType === 'quick_exit') {
      const signals = Object.fromEntries(
        Object.entries(quickExitSignals[category] || {}).filter(([, timestamp]) => timestamp >= quickExitCutoff)
      ) as Record<string, number>;
      if (event.articleId) signals[event.articleId] = event.timestamp;
      quickExitSignals[category] = signals;
      continue;
    }

    // Engagement-Credit Model: read-session visits have their deltas scaled by
    // the attention factor; deliberate tap-actions keep full strength by design.
    const isReadVisit = READ_VISIT_TYPES.has(event.eventType);
    const attention = isReadVisit
      ? computeAttentionFactor(event.scrollDepth, event.sessionDuration, event.actualWordCount, cfg)
      : 1;

    const delta = ((cfg.feedback as any)[event.eventType] ?? 0) * attention;
    if (delta === 0) continue;
    updatedWeights[category] = (updatedWeights[category] ?? 1.0) + delta * categoryL;
    deltasByCategory[category] = (deltasByCategory[category] || 0) + delta * categoryL;

    if (event.lengthStyle) {
      const compKey = `${category}::${event.lengthStyle}`;
      updatedWeights[compKey] = (updatedWeights[compKey] ?? profile.categoryLengthWeights?.[compKey] ?? 1.0) + delta * lengthL;
    }
    if (event.publicationName) {
      const pubKey = `pub::${event.publicationName}`;
      updatedWeights[pubKey] = (updatedWeights[pubKey] ?? profile.publisherWeights?.[event.publicationName] ?? 1.0) + delta * publisherL;
    }
  }

  // Reaching the threshold applies feedback.quick_exit exactly once to the
  // category only. Positive events above have already cleared earlier evidence.
  for (const category of Object.keys(quickExitSignals)) {
    const signals = Object.fromEntries(
      Object.entries(quickExitSignals[category]).filter(([, timestamp]) => timestamp >= quickExitCutoff)
    ) as Record<string, number>;
    if (Object.keys(signals).length >= cfg.learning.repeatedQuickExitThreshold) {
      const weakDelta = (cfg.feedback as any).quick_exit ?? FEEDBACK_DELTAS.quick_exit ?? 0;
      if (weakDelta !== 0) {
        updatedWeights[category] = (updatedWeights[category] ?? 1.0) + weakDelta * categoryL;
        deltasByCategory[category] = (deltasByCategory[category] || 0) + weakDelta * categoryL;
      }
      delete quickExitSignals[category];
    } else if (Object.keys(signals).length > 0) {
      quickExitSignals[category] = signals;
    } else {
      delete quickExitSignals[category];
    }
  }

  // 5. Clamp all weights to [MIN, MAX]
  for (const cat of Object.keys(updatedWeights)) {
    updatedWeights[cat] = Math.max(
      cfg.learning.minWeight,
      Math.min(cfg.learning.maxWeight, updatedWeights[cat])
    );
  }

  // 6. Apply daily decay ONLY once per day — not on every sync.
  // Check if at least 23 hours have passed since the last weight update.
  const decayReference = profile.weightsDecayedAt ?? profile.weightUpdatedAt ?? now;
  const elapsedDays = Math.floor(Math.max(0, now - decayReference) / (24 * 60 * 60 * 1000));
  const effectiveDecayRate = Math.pow(cfg.learning.dailyDecayRate, elapsedDays);
  const decayedWeights = elapsedDays > 0 ? applyDecay(updatedWeights, effectiveDecayRate) : updatedWeights;
  if (elapsedDays > 0) {
    console.log(`[weightUpdater] Applying ${elapsedDays} day(s) of decay for ${userId}`);
  }

  // 7. Extract the 2D/3D weights back out of decayedWeights and Sync UI Arrays
  const newCategoryWeights: Record<string, number> = {};
  const newCategoryLengthWeights: Record<string, number> = {};
  const newPublisherWeights: Record<string, number> = {};

  const newSelectedCategoryIds = new Set(profile.selectedCategoryIds || []);
  const newNotInterestedCategoryIds = new Set(profile.notInterestedCategoryIds || []);
  let uiArraysChanged = false;

  for (const [key, val] of Object.entries(decayedWeights)) {
    if (key.startsWith('pub::')) {
      newPublisherWeights[key.replace('pub::', '')] = val;
    } else if (key.includes('::')) {
      newCategoryLengthWeights[key] = val;
    } else {
      newCategoryWeights[key] = val;

      // Dynamic UI Sync: Adjust UI arrays based on algorithm confidence
      if (val <= cfg.learning.defaultNotInterestedWeight) {
        if (!newNotInterestedCategoryIds.has(key)) {
          newNotInterestedCategoryIds.add(key);
          newSelectedCategoryIds.delete(key);
          uiArraysChanged = true;
        }
      } else if (val >= cfg.learning.defaultSelectedWeight) {
        if (!newSelectedCategoryIds.has(key)) {
          newSelectedCategoryIds.add(key);
          newNotInterestedCategoryIds.delete(key);
          uiArraysChanged = true;
        }
      } else if (val > cfg.learning.defaultNotInterestedWeight && val < cfg.learning.defaultSelectedWeight && newNotInterestedCategoryIds.has(key)) {
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
      if (consumedWords >= MIN_WPM_CALIBRATION_WORDS) {
        const rawSessionWpm = consumedWords / (event.sessionDuration / 60_000);
        if (rawSessionWpm >= MIN_PLAUSIBLE_WPM && rawSessionWpm <= MAX_PLAUSIBLE_WPM) {
          const clampedSessionWpm = Math.min(MAX_PLAUSIBLE_WPM, rawSessionWpm);
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
  if (Array.isArray(profile.seenArticleIds) && profile.seenArticleIds.length > 5000) {
    const trimmedSeenIds = profile.seenArticleIds.slice(-4000);
    prunedSeenArticleIds = trimmedSeenIds;
    console.log(`[weightUpdater] Pruned seenArticleIds from ${profile.seenArticleIds.length} to ${prunedSeenArticleIds.length}`);
  }

  await userRef.update({
    categoryWeights: newCategoryWeights,
    categoryLengthWeights: newCategoryLengthWeights,
    publisherWeights: newPublisherWeights,
    weightUpdatedAt: latestEventTimestamp, // P0 Fix: advance watermark so events are never replayed
    weightsDecayedAt: elapsedDays > 0 ? now : (profile.weightsDecayedAt ?? profile.weightUpdatedAt ?? now),
    quickExitCategorySignals: quickExitSignals,
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
      `Result: ${Object.entries(decayedWeights).slice(0, 5).map(([k, v]) => `${k}=${v.toFixed(3)}`).join(', ')}`
    );
  }

  // --- Analytics: weight_updated events ---
  const weightUpdatedEvents: Array<{ name: string; params: Record<string, any> }> = [];
  const triggerEventType = events.length > 0 ? events[events.length - 1].eventType : 'decay';

  for (const [key, val] of Object.entries(decayedWeights)) {
    const previousVal = currentWeights[key] ?? 1.0;
    if (Math.abs(val - previousVal) < 0.001) continue; // skip unchanged weights

    let entityType: string;
    let entityId: string;
    if (key.startsWith('pub::')) {
      entityType = 'publisher';
      entityId = key.replace('pub::', '');
    } else if (key.includes('::')) {
      entityType = 'category_length';
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
  const categoriesAtCeiling = categoryWeightsEntries.filter(([, w]) => w >= cfg.learning.maxWeight).length;

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
 * Apply 0.5% daily decay to pull extreme weights back towards 1.0.
 */
export function applyDecay(weights: Record<string, number>, rate: number = DAILY_DECAY_RATE): Record<string, number> {
  const decayed: Record<string, number> = {};
  for (const [cat, weight] of Object.entries(weights)) {
    // Move weight towards 1.0 by the decay rate
    decayed[cat] = 1.0 + (weight - 1.0) * rate;
    // Re-clamp for safety
    decayed[cat] = Math.max(MIN_CATEGORY_WEIGHT, Math.min(MAX_CATEGORY_WEIGHT, decayed[cat]));
  }
  return decayed;
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



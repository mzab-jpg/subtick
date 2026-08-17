// ============================================================
// SubTick — weightUpdater (Internal helper, called by syncBehaviorEvents)
// Computes weight adjustments using feedback delta multipliers,
// learning rate, clamping, and daily decay.
// Reads events from nested subcollections: users/{userId}/behavior_events
// ============================================================

import * as admin from 'firebase-admin';
import { BehaviorEvent, UserProfile } from './types.js';
import {
  FEEDBACK_DELTAS,
  LEARNING_RATE,
  MIN_CATEGORY_WEIGHT,
  MAX_CATEGORY_WEIGHT,
  DAILY_DECAY_RATE,
  DEFAULT_SELECTED_WEIGHT,
  DEFAULT_NOT_INTERESTED_WEIGHT,
} from './constants.js';
import { sendGAEvents, sendGAUserProperties } from './analytics.js';
import { loadScoringConfig, ScoringConfig } from './scoringConfig.js';

const db = admin.firestore();

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

    const delta = (cfg.feedback as any)[event.eventType] ?? 0;
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
    // Accumulate total reading time for any valid read event
    // Exclude toggle events (like/unlike/save/unsave) and non-reading swipes
    if (event.eventType !== 'quick_exit' && event.eventType !== 'swipe_next' && event.eventType !== 'swipe_not_interested'
        && event.eventType !== 'like' && event.eventType !== 'unlike' && event.eventType !== 'save' && event.eventType !== 'unsave') {
      newTotalReadTimeMs += event.sessionDuration;
      readTimeUpdated = true;
    }

    // Completion remains tied to the server's read classification.
    if (event.eventType === 'read_thorough' || event.eventType === 'read_skim') {
      newTotalArticlesFinished++;
      articlesFinishedUpdated = true;
    }

    // WPM is deliberately independent of reading classification: words divided
    // by active foreground time. The client sends the rendered count when it has
    // one and otherwise supplies the stored article count at Reader exit.
    const wordCount = event.actualWordCount;
    if (wordCount && wordCount > 0 && event.sessionDuration > 0) {
      const sessionWpm = wordCount / (event.sessionDuration / 60_000);
      newAverageWpm = Math.round((newAverageWpm * 0.8) + (sessionWpm * 0.2));
      wpmUpdated = true;
    }
  }

  // 9. Update Firestore — advance the watermark to the most recent processed event
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
 * B3 Fix: Accepts the already-fetched events from updateWeights instead of
 * running a second Firestore query. The existing profile.weeklyReadCount was
 * correct as of the last sync; we add the new reads from this batch to get
 * the updated weekly total. This eliminates one Firestore read per sync.
 */
async function updateReadStats(
  userId: string,
  profile: UserProfile,
  newEvents: BehaviorEvent[]
): Promise<void> {
  const now = Date.now();
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

  // Count new reads from the already-fetched events that fall within the 7-day window.
  // The existing profile.weeklyReadCount was correct as of the last sync.
  let newReadsThisWeek = 0;
  for (const event of newEvents) {
    if (
      event.timestamp >= oneWeekAgo &&
      (event.eventType === 'read_thorough' || event.eventType === 'read_skim')
    ) {
      newReadsThisWeek++;
    }
  }
  const weeklyReadCount = (profile.weeklyReadCount || 0) + newReadsThisWeek;

  // Streak logic
  let streak = profile.currentStreakDays || 0;
  const lastDate = new Date(profile.lastReadDate || 0);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (lastDate.toDateString() === today.toDateString()) {
    // Already read today — streak unchanged
  } else if (lastDate.toDateString() === yesterday.toDateString()) {
    // Read yesterday — increment streak
    streak++;
  } else {
    // Streak broken — reset to 1
    streak = 1;
  }

  await db.collection('users').doc(userId).update({
    weeklyReadCount,
    currentStreakDays: streak,
    lastReadDate: now,
    lastUpdated: now,
  });

  console.log(`[weightUpdater] Stats: weekly=${weeklyReadCount}, streak=${streak}`);
}



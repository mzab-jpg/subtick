// ============================================================
// SubTick — weightUpdater (Internal helper, called by syncBehaviorEvents)
// Computes weight adjustments using feedback delta multipliers,
// learning rate, clamping, and daily decay.
// ============================================================

import * as admin from 'firebase-admin';
import { BehaviorEvent, UserProfile } from './types.js';
import {
  FEEDBACK_DELTAS,
  LEARNING_RATE,
  MIN_CATEGORY_WEIGHT,
  MAX_CATEGORY_WEIGHT,
  DAILY_DECAY_RATE,
} from './constants.js';

const db = admin.firestore();

/**
 * Update category weights for a user based on their recent behavior events.
 * Applies: Δ × L formula, clamps to [0.1, 5.0], and applies 0.5% daily decay.
 *
 * NOTE: All queries use userId-only filters (auto-indexed) to avoid composite
 * index requirements. Timestamp/eventType filtering is done in memory.
 */
export async function updateWeights(userId: string): Promise<void> {
  // 1. Fetch user profile
  const userRef = db.collection('users').doc(userId);
  const userDoc = await userRef.get();
  if (!userDoc.exists) {
    console.log(`[weightUpdater] User ${userId} not found`);
    return;
  }

  const profile = userDoc.data() as UserProfile;
  const currentWeights = { ...profile.categoryWeights };

  // 2. Fetch ALL recent behavior events for this user (userId is auto-indexed)
  //    Then filter by timestamp in memory to avoid composite index
  const eventsSnapshot = await db
    .collection('behavior_events')
    .where('userId', '==', userId)
    .limit(100)
    .get();

  if (eventsSnapshot.empty) {
    console.log(`[weightUpdater] No behavior events for user ${userId}`);
    return;
  }

  // 3. Filter to recent events (last 24 hours) in memory
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const events: BehaviorEvent[] = [];
  eventsSnapshot.forEach((doc) => {
    const event = doc.data() as BehaviorEvent;
    if (event.timestamp >= oneDayAgo) {
      events.push(event);
    }
  });

  if (events.length === 0) {
    console.log(`[weightUpdater] No recent events for ${userId} (all older than 24h)`);
    return;
  }

  console.log(`[weightUpdater] Processing ${events.length} recent events for ${userId}`);

  // 4. Apply feedback deltas
  const updatedWeights = { ...currentWeights };
  const deltasByCategory: Record<string, number> = {};

  for (const event of events) {
    const category = event.articleCategory;
    const delta = FEEDBACK_DELTAS[event.eventType] || 0;

    if (!category) {
      console.warn(`[weightUpdater] Event missing category: ${event.eventType}`);
      continue;
    }

    if (!updatedWeights[category]) {
      updatedWeights[category] = 1.0;
    }

    // Apply: NewWeight = CurrentWeight + (Δ × L)
    updatedWeights[category] += delta * LEARNING_RATE;
    deltasByCategory[category] = (deltasByCategory[category] || 0) + delta * LEARNING_RATE;
  }

  // 5. Clamp all weights to [MIN, MAX]
  for (const cat of Object.keys(updatedWeights)) {
    updatedWeights[cat] = Math.max(
      MIN_CATEGORY_WEIGHT,
      Math.min(MAX_CATEGORY_WEIGHT, updatedWeights[cat])
    );
  }

  // 6. Apply daily decay
  const decayedWeights = applyDecay(updatedWeights);

  // 7. Update Firestore
  await userRef.update({
    categoryWeights: decayedWeights,
    lastUpdated: Date.now(),
  });

  console.log(
    `[weightUpdater] Updated weights for ${userId}. ` +
    `Deltas: ${Object.entries(deltasByCategory).map(([k, v]) => `${k}${v >= 0 ? '+' : ''}${v.toFixed(3)}`).join(', ')}. ` +
    `Result: ${Object.entries(decayedWeights).slice(0, 5).map(([k, v]) => `${k}=${v.toFixed(3)}`).join(', ')}`
  );

  // 8. Update weekly read count and streak
  await updateReadStats(userId, profile);
}

/**
 * Apply 0.5% daily decay to pull extreme weights back towards 1.0.
 */
function applyDecay(weights: Record<string, number>): Record<string, number> {
  const decayed: Record<string, number> = {};
  for (const [cat, weight] of Object.entries(weights)) {
    // Move weight towards 1.0 by the decay rate
    decayed[cat] = 1.0 + (weight - 1.0) * DAILY_DECAY_RATE;
    // Re-clamp for safety
    decayed[cat] = Math.max(MIN_CATEGORY_WEIGHT, Math.min(MAX_CATEGORY_WEIGHT, decayed[cat]));
  }
  return decayed;
}

/**
 * Update reading stats: weekly count, streak, and last read date.
 * Also uses userId-only query to avoid composite index.
 */
async function updateReadStats(
  userId: string,
  profile: UserProfile
): Promise<void> {
  const now = Date.now();
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

  // Fetch all events for this user, filter in memory
  const weeklySnap = await db
    .collection('behavior_events')
    .where('userId', '==', userId)
    .get();

  // Count "reads" this week
  let weeklyReadCount = 0;
  weeklySnap.forEach((doc) => {
    const event = doc.data() as BehaviorEvent;
    if (
      event.timestamp >= oneWeekAgo &&
      (event.eventType === 'swipe_next' || event.eventType === 'scroll_80')
    ) {
      weeklyReadCount++;
    }
  });

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
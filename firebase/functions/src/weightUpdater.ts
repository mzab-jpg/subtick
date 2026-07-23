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

const db = admin.firestore();

/**
 * Update category weights for a user based on their recent behavior events.
 * Applies: Δ × L formula, clamps to [0.1, 5.0], and applies 0.5% daily decay.
 *
 * NOTE: Reads directly from users/{userId}/behavior_events subcollection
 * which is inherently partitioned by user. Filters by timestamp in memory.
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

    // Apply Dimension-Specific Learning Rates:
    // Publisher = 0.16 (2.0x of L), Length = 0.12 (1.5x of L), Category = 0.08 (1.0x of L)
    const categoryL = LEARNING_RATE * 1.0; // 0.08
    const lengthL = LEARNING_RATE * 1.5;   // 0.12
    const publisherL = LEARNING_RATE * 2.0;  // 0.16

    // Category Weight Update
    updatedWeights[category] += delta * categoryL;
    deltasByCategory[category] = (deltasByCategory[category] || 0) + delta * categoryL;

    // --- 2D Matrix Style Learning ---
    // If the event has a lengthStyle, update the categoryLengthWeights (e.g. "Technology & Innovation::long")
    const lengthStyle = event.lengthStyle;
    if (lengthStyle) {
      const compKey = `${category}::${lengthStyle}`;
      if (!profile.categoryLengthWeights) profile.categoryLengthWeights = {};
      if (!updatedWeights[compKey]) {
        updatedWeights[compKey] = profile.categoryLengthWeights[compKey] || 1.0;
      }
      updatedWeights[compKey] += delta * lengthL;
    }

    // --- 3D Matrix Publisher Learning ---
    // If the event has a publisher, update the specific publisher weight
    const publisherName = event.publicationName;
    if (publisherName) {
      const pubKey = `pub::${publisherName}`;
      if (!profile.publisherWeights) profile.publisherWeights = {};
      if (!updatedWeights[pubKey]) {
        updatedWeights[pubKey] = profile.publisherWeights[publisherName] || 1.0;
      }
      updatedWeights[pubKey] += delta * publisherL;
    }
  }

  // 5. Clamp all weights to [MIN, MAX]
  for (const cat of Object.keys(updatedWeights)) {
    updatedWeights[cat] = Math.max(
      MIN_CATEGORY_WEIGHT,
      Math.min(MAX_CATEGORY_WEIGHT, updatedWeights[cat])
    );
  }

  // 6. Apply daily decay ONLY once per day — not on every sync.
  // Check if at least 23 hours have passed since the last weight update.
  const TWENTY_THREE_HOURS = 23 * 60 * 60 * 1000;
  const shouldApplyDecay = (now - watermark) >= TWENTY_THREE_HOURS;
  const decayedWeights = shouldApplyDecay ? applyDecay(updatedWeights) : updatedWeights;
  if (shouldApplyDecay) {
    console.log(`[weightUpdater] Applying daily decay for ${userId}`);
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
      if (val <= DEFAULT_NOT_INTERESTED_WEIGHT) {
        if (!newNotInterestedCategoryIds.has(key)) {
          newNotInterestedCategoryIds.add(key);
          newSelectedCategoryIds.delete(key);
          uiArraysChanged = true;
        }
      } else if (val >= DEFAULT_SELECTED_WEIGHT) {
        if (!newSelectedCategoryIds.has(key)) {
          newSelectedCategoryIds.add(key);
          newNotInterestedCategoryIds.delete(key);
          uiArraysChanged = true;
        }
      } else if (val > DEFAULT_NOT_INTERESTED_WEIGHT && val < DEFAULT_SELECTED_WEIGHT && newNotInterestedCategoryIds.has(key)) {
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
    if (event.eventType !== 'quick_exit' && event.eventType !== 'swipe_next' && event.eventType !== 'swipe_not_interested') {
      newTotalReadTimeMs += event.sessionDuration;
      readTimeUpdated = true;
    }

    // If they scrolled deep, they likely finished it
    if ((event.eventType === 'read_thorough' || event.eventType === 'read_skim') && event.scrollDepth >= 0.8 && event.sessionDuration > 10000) {
      newTotalArticlesFinished++;
      articlesFinishedUpdated = true;

      // We use the exact word count extracted from the live WebView, falling back to DB only if missing
      let wordCount = event.actualWordCount;

      if (!wordCount || wordCount <= 0) {
        try {
          const articleDoc = await db.collection('articles').doc(event.articleId).get();
          if (articleDoc.exists) {
            const articleData = articleDoc.data();
            // Discard WPM calculation if the RSS feed was truncated, as the db word count is false
            if (!articleData?.isTruncatedFeed) {
              wordCount = articleData?.wordCount;
            }
          }
        } catch (e) {
          console.warn('[weightUpdater] Failed to fetch article for WPM calculation', e);
        }
      }

      if (wordCount && wordCount > 0) {
        const minutesSpent = event.sessionDuration / 60000;
        const sessionWpm = wordCount / minutesSpent;
        
        // Strict bounds check: Discard artifacts of speed skimming or left-open phones
        if (sessionWpm >= 150 && sessionWpm <= 750) {
          // Rolling average: 80% old, 20% new
          newAverageWpm = Math.round((newAverageWpm * 0.8) + (sessionWpm * 0.2));
          wpmUpdated = true;
        }
      }
    }
  }

  // 9. Update Firestore — advance the watermark to the most recent processed event
  await userRef.update({
    categoryWeights: newCategoryWeights,
    categoryLengthWeights: newCategoryLengthWeights,
    publisherWeights: newPublisherWeights,
    weightUpdatedAt: latestEventTimestamp, // P0 Fix: advance watermark so events are never replayed
    ...(uiArraysChanged && {
      selectedCategoryIds: Array.from(newSelectedCategoryIds),
      notInterestedCategoryIds: Array.from(newNotInterestedCategoryIds),
    }),
    ...(wpmUpdated && { averageWpm: newAverageWpm }),
    ...(readTimeUpdated && { totalReadTimeMs: newTotalReadTimeMs }),
    ...(articlesFinishedUpdated && { totalArticlesRead: newTotalArticlesFinished }),
    lastUpdated: now,
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
 */
async function updateReadStats(
  userId: string,
  profile: UserProfile
): Promise<void> {
  const now = Date.now();
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

  // Fetch only events from the past 7 days, filtered by Firestore — not in memory.
  // This prevents downloading the user's entire interaction history just to count one week.
  const weeklySnap = await db
    .collection('users')
    .doc(userId)
    .collection('behavior_events')
    .where('timestamp', '>=', oneWeekAgo)
    .get();

  // Count "reads" this week (all returned events are already within the 7-day window)
  let weeklyReadCount = 0;
  weeklySnap.forEach((doc) => {
    const event = doc.data() as BehaviorEvent;
    if (event.eventType === 'read_thorough' || event.eventType === 'read_skim') {
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

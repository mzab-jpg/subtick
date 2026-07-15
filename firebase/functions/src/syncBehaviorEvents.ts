// ============================================================
// SubTick — syncBehaviorEvents (HTTPS Callable)
// Saves batched behavior events and triggers weight updates.
// ============================================================

import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { BehaviorEvent } from './types.js';
import { updateWeights } from './weightUpdater.js';

const db = admin.firestore();

export const syncBehaviorEvents = onCall(async (request) => {
  const data = request.data as { events: BehaviorEvent[] };
  const events = data.events || [];

  if (!events.length) {
    return { synced: 0, errors: 0 };
  }

  console.log(`[syncBehaviorEvents] Processing ${events.length} events`);

  let synced = 0;
  let errors = 0;
  const userIds = new Set<string>();
  const batch = db.batch();
  const eventsRef = db.collection('behavior_events');

  for (const event of events) {
    try {
      batch.set(eventsRef.doc(), {
        articleId: event.articleId,
        userId: event.userId,
        eventType: event.eventType,
        timestamp: event.timestamp || Date.now(),
        articleCategory: event.articleCategory,
        sessionDuration: event.sessionDuration,
        scrollDepth: event.scrollDepth,
      });
      userIds.add(event.userId);
      synced++;
    } catch (error: any) {
      console.error('[syncBehaviorEvents] Error:', error.message);
      errors++;
    }
  }

  try {
    await batch.commit();
    console.log(`[syncBehaviorEvents] Synced ${synced} events`);
  } catch (error: any) {
    console.error('[syncBehaviorEvents] Batch commit failed:', error.message);
  }

  for (const userId of userIds) {
    try {
      await updateWeights(userId);
    } catch (error: any) {
      console.error(`[syncBehaviorEvents] Weight update failed for ${userId}:`, error.message);
    }
  }

  return { synced, errors };
});
// ============================================================
// SubTick — syncBehaviorEvents (HTTPS Callable)
// Saves behavior events, increments article trendingScore and
// publisher qualityScore dynamically in real-time.
// ============================================================

import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { BehaviorEvent } from './types.js';
import { updateWeights } from './weightUpdater.js';

const db = admin.firestore();

// --- Configuration ---
const DEFAULT_PUBLISHER_QUALITY = 0.8;

function getTrendingIncrement(eventType: string): number {
  switch (eventType) {
    case 'save': return 3.0;
    case 'like': return 2.0;
    case 'read_thorough': return 1.5;
    case 'read_skim': return 0.5;
    case 'read_shallow': return 0.2;
    default: return 0.0;
  }
}

function getPublisherQualityIncrement(eventType: string): number {
  switch (eventType) {
    case 'save': return 0.010;
    case 'like': return 0.005;
    case 'read_thorough': return 0.005;
    case 'read_skim': return 0.001;
    case 'swipe_not_interested': return -0.010;
    case 'quick_exit': return -0.005;
    default: return 0.0;
  }
}

export const syncBehaviorEvents = onCall(async (request) => {
  const data = request.data as { events: BehaviorEvent[] };
  const events = data.events || [];

  if (!events.length) {
    return { synced: 0, errors: 0 };
  }

  console.log(`[syncBehaviorEvents] Processing ${events.length} events into subcollections...`);

  const userIds = new Set<string>();
  const articleIds = new Set<string>(events.map(e => e.articleId).filter(Boolean));

  // 1. Fetch publication names for all affected articles in parallel (extremely fast)
  const articleToPublisher: Record<string, string> = {};
  try {
    if (articleIds.size > 0) {
      const articleRefs = Array.from(articleIds).map(id => db.collection('articles').doc(id));
      const articleDocs = await db.getAll(...articleRefs);
      articleDocs.forEach(doc => {
        if (doc.exists) {
          const artData = doc.data();
          if (artData && artData.publicationName) {
            articleToPublisher[doc.id] = artData.publicationName;
          }
        }
      });
    }
  } catch (err: any) {
    console.warn('[syncBehaviorEvents] Failed to fetch article publisher info:', err.message);
  }

  let synced = 0;
  let errors = 0;
  const batch = db.batch();

  // 2. Process events and queue real-time atomic updates
  for (const event of events) {
    try {
      if (!event.userId) {
        errors++;
        continue;
      }

      // Stage raw event log in subcollection: users/{userId}/behavior_events/{eventId}
      const eventDocRef = db
        .collection('users')
        .doc(event.userId)
        .collection('behavior_events')
        .doc();

      batch.set(eventDocRef, {
        articleId: event.articleId,
        userId: event.userId,
        eventType: event.eventType,
        timestamp: event.timestamp || Date.now(),
        articleCategory: event.articleCategory,
        lengthStyle: event.lengthStyle,
        sessionDuration: event.sessionDuration,
        scrollDepth: event.scrollDepth,
      });

      // Increment Article Trending Score atomically in real-time
      if (event.articleId) {
        const trendingDelta = getTrendingIncrement(event.eventType);
        if (trendingDelta > 0) {
          const articleRef = db.collection('articles').doc(event.articleId);
          batch.update(articleRef, {
            trendingScore: admin.firestore.FieldValue.increment(trendingDelta)
          });
        }

        // Increment Publisher Quality Score atomically in real-time
        const pubName = articleToPublisher[event.articleId];
        if (pubName) {
          const qualityDelta = getPublisherQualityIncrement(event.eventType);
          if (qualityDelta !== 0) {
            // Sanitize publication name to make it path-safe for Firestore Doc IDs (no slashes)
            const sanitizedDocId = pubName.replace(/\//g, '-');
            const publisherRef = db.collection('publishers').doc(sanitizedDocId);
            batch.set(publisherRef, {
              name: pubName,
              qualityScore: admin.firestore.FieldValue.increment(qualityDelta),
              lastUpdated: Date.now()
            }, { merge: true });
          }
        }
      }

      userIds.add(event.userId);
      synced++;
    } catch (error: any) {
      console.error('[syncBehaviorEvents] Error staging event:', error.message);
      errors++;
    }
  }

  try {
    await batch.commit();
    console.log(`[syncBehaviorEvents] Synced ${synced} events, updated trending and publisher quality scores in real-time`);
  } catch (error: any) {
    console.error('[syncBehaviorEvents] Batch commit failed:', error.message);
  }

  // 3. Trigger weight updates for affected users
  for (const userId of userIds) {
    try {
      await updateWeights(userId);
    } catch (error: any) {
      console.error(`[syncBehaviorEvents] Weight update failed for ${userId}:`, error.message);
    }
  }

  return { synced, errors };
});

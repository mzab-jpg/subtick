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
  // P0 Security: Verify the caller is authenticated. Never trust client-supplied userId.
  if (!request.auth) {
    throw new Error('unauthenticated');
  }
  const authenticatedUserId = request.auth.uid;

  const data = request.data as { events: BehaviorEvent[] };
  const events = (data.events || []).map(e => ({
    ...e,
    // Overwrite any client-supplied userId with the verified auth UID
    userId: authenticatedUserId,
  }));

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

  // 1b. Fetch existing publisher documents so we know which ones already have a qualityScore.
  // This lets us use increment() for existing publishers and set the default for new ones.
  // Publishers are few (35 feeds) so this read is cheap.
  const existingPublisherIds = new Set<string>();
  try {
    const publisherSnap = await db.collection('publishers').get();
    publisherSnap.forEach(doc => existingPublisherIds.add(doc.id));
  } catch (err: any) {
    console.warn('[syncBehaviorEvents] Could not pre-fetch publisher list:', err.message);
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
      // P0 Idempotency: Use the client-generated event.id as the document ID so that
      // retries after a network timeout do not create duplicate events.
      const eventDocRef = db
        .collection('users')
        .doc(event.userId)
        .collection('behavior_events')
        .doc(event.id || db.collection('users').doc().id);

      batch.set(eventDocRef, {
        articleId: event.articleId,
        userId: event.userId,
        eventType: event.eventType,
        timestamp: event.timestamp || Date.now(),
        articleCategory: event.articleCategory,
        lengthStyle: event.lengthStyle,
        sessionDuration: event.sessionDuration,
        scrollDepth: event.scrollDepth,
        ...(event.publicationName && { publicationName: event.publicationName }),
        ...(event.actualWordCount && event.actualWordCount > 0 && { actualWordCount: event.actualWordCount }),
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

        // Update Publisher Quality Score.
        // Fix: FieldValue.increment on a missing field initializes it to 0, not DEFAULT_PUBLISHER_QUALITY.
        // For NEW publishers (not yet in Firestore), we write the explicit default + delta as a
        // concrete number. For EXISTING publishers, we use increment() which is atomic and correct.
        const pubName = articleToPublisher[event.articleId];
        if (pubName) {
          const qualityDelta = getPublisherQualityIncrement(event.eventType);
          if (qualityDelta !== 0) {
            const sanitizedDocId = pubName.replace(/\//g, '-');
            const publisherRef = db.collection('publishers').doc(sanitizedDocId);

            if (existingPublisherIds.has(sanitizedDocId)) {
              // Existing publisher — safe to use atomic increment
              batch.set(publisherRef, {
                name: pubName,
                qualityScore: admin.firestore.FieldValue.increment(qualityDelta),
                lastUpdated: Date.now(),
              }, { merge: true });
            } else {
              // New publisher — seed at DEFAULT_PUBLISHER_QUALITY + delta to avoid starting at 0
              const initialScore = Math.max(0.2, Math.min(1.0, DEFAULT_PUBLISHER_QUALITY + qualityDelta));
              batch.set(publisherRef, {
                name: pubName,
                qualityScore: initialScore,
                lastUpdated: Date.now(),
              });
              // Mark as existing so subsequent events in this batch use increment
              existingPublisherIds.add(sanitizedDocId);
            }
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
    throw error; // Rethrow to inform client sync failed so events remain in queue
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
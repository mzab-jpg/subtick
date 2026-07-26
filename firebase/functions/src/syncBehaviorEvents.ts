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
    case 'unsave': return -3.0;
    case 'like': return 2.0;
    case 'unlike': return -2.0;
    case 'read_thorough': return 1.5;
    case 'read_skim': return 0.5;
    case 'read_shallow': return 0.2;
    default: return 0.0;
  }
}

function getPublisherQualityIncrement(eventType: string): number {
  switch (eventType) {
    case 'save': return 0.010;
    case 'unsave': return -0.010;
    case 'like': return 0.005;
    case 'unlike': return -0.005;
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

  // 1. Fetch publication names, current trendingScore, and peakTrendingScore for all affected articles
  const articleToPublisher: Record<string, string> = {};
  const articleInitialScores: Record<string, { trendingScore: number; peakTrendingScore: number }> = {};
  try {
    if (articleIds.size > 0) {
      const articleRefs = Array.from(articleIds).map(id => db.collection('articles').doc(id));
      const articleDocs = await db.getAll(...articleRefs);
      articleDocs.forEach(doc => {
        if (doc.exists) {
          const artData = doc.data();
          if (artData) {
            if (artData.publicationName) {
              articleToPublisher[doc.id] = artData.publicationName;
            }
            articleInitialScores[doc.id] = {
              trendingScore: artData.trendingScore || 0,
              peakTrendingScore: artData.peakTrendingScore || 0,
            };
          }
        }
      });
    }
  } catch (err: any) {
    console.warn('[syncBehaviorEvents] Failed to fetch article publisher info and scores:', err.message);
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

  // 2. Per-user per-article dedup for like/save toggle events.
  // Prevents spam: a user can only like/save an article once and unlike/unsave once.
  // Tracks for the current batch which user+article pairs have already had their
  // first like/save or unlike/unsave counted, so in-batch duplicates are also skipped.
  const likeDedup = new Set<string>();   // "userId::articleId" set when first like/unlike is counted
  const saveDedup = new Set<string>();   // "userId::articleId" set when first save/unsave is counted

  // Track net trending deltas per article (after dedup)
  const articleTrendingDeltas: Record<string, number> = {};

  // Track aggregated publisher quality deltas per publisher
  const publisherQualityDeltas: Record<string, number> = {};
  const publisherNames: Record<string, string> = {};

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

      const trendingDelta = event.articleId ? getTrendingIncrement(event.eventType) : 0;
      const qualityDelta = event.articleId ? getPublisherQualityIncrement(event.eventType) : 0;

      // P0 Optimization 1: Skip saving zero-impact events to Firestore to reduce write costs.
      // Zero-impact events (like swipe_next) have no trending increment, no publisher quality delta,
      // and do not affect personalization weights (delta is 0 in FEEDBACK_DELTAS).
      const isZeroImpact = trendingDelta === 0 && qualityDelta === 0 && event.eventType === 'swipe_next';

      if (!isZeroImpact) {
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
      }

      // Aggregate Article Trending Score deltas
      if (event.articleId) {
        // Per-user per-article dedup: only count the first like/unlike and first save/unsave.
        let shouldApplyTrending = true;
        if (event.eventType === 'like' || event.eventType === 'unlike') {
          const dedupKey = `${event.userId}::${event.articleId}`;
          if (likeDedup.has(dedupKey)) {
            shouldApplyTrending = false;
          } else {
            likeDedup.add(dedupKey);
          }
        } else if (event.eventType === 'save' || event.eventType === 'unsave') {
          const dedupKey = `${event.userId}::${event.articleId}`;
          if (saveDedup.has(dedupKey)) {
            shouldApplyTrending = false;
          } else {
            saveDedup.add(dedupKey);
          }
        }

        if (trendingDelta !== 0 && shouldApplyTrending) {
          articleTrendingDeltas[event.articleId] = (articleTrendingDeltas[event.articleId] || 0) + trendingDelta;
        }

        // Aggregate Publisher Quality Score deltas
        const pubName = articleToPublisher[event.articleId];
        if (pubName && qualityDelta !== 0) {
          const sanitizedDocId = pubName.replace(/\//g, '-');
          publisherQualityDeltas[sanitizedDocId] = (publisherQualityDeltas[sanitizedDocId] || 0) + qualityDelta;
          publisherNames[sanitizedDocId] = pubName;
        }
      }

      userIds.add(event.userId);
      synced++;
    } catch (error: any) {
      console.error('[syncBehaviorEvents] Error staging event:', error.message);
      errors++;
    }
  }

  // P0 Optimization 2 & 3: Commit aggregated updates in the main batch
  
  // Apply aggregated article updates (trendingScore and peakTrendingScore merged into ONE write)
  for (const [artId, netDelta] of Object.entries(articleTrendingDeltas)) {
    if (netDelta !== 0) {
      const articleRef = db.collection('articles').doc(artId);
      const initial = articleInitialScores[artId];
      
      const updateData: any = {
        trendingScore: admin.firestore.FieldValue.increment(netDelta)
      };

      // Merge peakTrendingScore update into the main batch
      if (initial) {
        const estimatedNewTrending = initial.trendingScore + netDelta;
        if (estimatedNewTrending > initial.peakTrendingScore) {
          updateData.peakTrendingScore = estimatedNewTrending;
        }
      }

      batch.update(articleRef, updateData);
    }
  }

  // Apply aggregated publisher updates (ONE write per unique publisher instead of per event)
  for (const [sanitizedDocId, netDelta] of Object.entries(publisherQualityDeltas)) {
    if (netDelta !== 0) {
      const pubName = publisherNames[sanitizedDocId];
      const publisherRef = db.collection('publishers').doc(sanitizedDocId);

      if (existingPublisherIds.has(sanitizedDocId)) {
        // Existing publisher — safe to use atomic increment
        batch.set(publisherRef, {
          name: pubName,
          qualityScore: admin.firestore.FieldValue.increment(netDelta),
          lastUpdated: Date.now(),
        }, { merge: true });
      } else {
        // New publisher — seed at DEFAULT_PUBLISHER_QUALITY + delta to avoid starting at 0
        const initialScore = Math.max(0.2, Math.min(1.0, DEFAULT_PUBLISHER_QUALITY + netDelta));
        batch.set(publisherRef, {
          name: pubName,
          qualityScore: initialScore,
          lastUpdated: Date.now(),
        });
        existingPublisherIds.add(sanitizedDocId);
      }
    }
  }

  try {
    await batch.commit();
    console.log(`[syncBehaviorEvents] Synced ${synced} events, updated trending and publisher quality scores in real-time`);
  } catch (error: any) {
    console.error('[syncBehaviorEvents] Batch commit failed:', error.message);
    throw error; // Rethrow to inform client sync failed so events remain in queue
  }

  // 4. Trigger weight updates for affected users
  for (const userId of userIds) {
    try {
      await updateWeights(userId);
    } catch (error: any) {
      console.error(`[syncBehaviorEvents] Weight update failed for ${userId}:`, error.message);
    }
  }

  return { synced, errors };
});
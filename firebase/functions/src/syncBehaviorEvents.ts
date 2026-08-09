// ============================================================
// SubTick — syncBehaviorEvents (HTTPS Callable)
// Saves behavior events, increments article trendingScore and
// publisher qualityScore dynamically in real-time.
// ============================================================

import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { BehaviorEvent } from './types.js';
import { updateWeights } from './weightUpdater.js';
import { gaApiSecret, sendGAEvents } from './analytics.js';
import { loadScoringConfig, prepareConfig, classifyRead, ScoringConfig } from './scoringConfig.js';

const db = admin.firestore();

// --- Configuration ---
const DEFAULT_PUBLISHER_QUALITY = 0.8;

// C5 Fix: Module-level publisher cache with 10-minute TTL.
// The publishers collection (35 docs) was being read in full on every single
// behavior sync call — the hottest code path in the app. Since Cloud Function
// containers stay warm across many invocations, this cache eliminates nearly
// all redundant publisher reads after the first call in each container.
const PUBLISHER_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let publisherIdCache: Set<string> = new Set();
let publisherCacheTimestamp = 0;

async function getExistingPublisherIds(): Promise<Set<string>> {
  const now = Date.now();
  if (publisherIdCache.size > 0 && (now - publisherCacheTimestamp) < PUBLISHER_CACHE_TTL_MS) {
    return publisherIdCache;
  }
  try {
    const snap = await db.collection('publishers').get();
    publisherIdCache = new Set(snap.docs.map(d => d.id));
    publisherCacheTimestamp = now;
  } catch (err: any) {
    console.warn('[syncBehaviorEvents] Could not refresh publisher cache:', err.message);
    // Return stale cache rather than failing the entire batch
  }
  return publisherIdCache;
}

function getTrendingIncrement(cfg: ScoringConfig, eventType: string): number {
  const d = (cfg.trending as any)[eventType];
  return typeof d === 'number' ? d : 0;
}

function getPublisherQualityIncrement(cfg: ScoringConfig, eventType: string): number {
  const d = (cfg.quality as any)[eventType];
  return typeof d === 'number' ? d : 0;
}

export const syncBehaviorEvents = onCall({ secrets: [gaApiSecret] }, async (request) => {
  // P0 Security: Verify the caller is authenticated. Never trust client-supplied userId.
  if (!request.auth) {
    throw new Error('unauthenticated');
  }
  const authenticatedUserId = request.auth.uid;

  const data = request.data as { events: BehaviorEvent[]; client_id?: string; configOverride?: ScoringConfig };
  // GA4 web-stream client_id (32-hex UUID generated client-side). Forwarded to
  // updateWeights so its analytics calls use the same id. Never fall back to the
  // Auth UID — analytics.ts will mint a random id if this is missing.
  const clientId = data.client_id || '';
  let events = (data.events || []).map(e => ({
    ...e,
    // Overwrite any client-supplied userId with the verified auth UID
    userId: authenticatedUserId,
  }));

  // Input size cap: prevent batch overflow (Firestore limits batches to 500 ops)
  // and rate-limit abuse. Client normally sends ≤20 events per flush.
  if (events.length > 50) {
    console.warn(`[syncBehaviorEvents] Truncating ${events.length} events to 50 (possible abuse or oversized flush)`);
    events = events.slice(0, 50);
  }

  if (!events.length) {
    return { synced: 0, errors: 0 };
  }

  // Single source of truth for all tunable values (cached ~60s per instance).
  // Use a preview config override for this request if supplied; else load live.
  const cfg = prepareConfig(data.configOverride) ?? await loadScoringConfig();

  // Optional server-authoritative read classification: re-decide read-family
  // labels from raw scroll/duration/word-count using the config thresholds,
  // instead of trusting the label the client guessed. OFF until enabled.
  if (cfg.classification.enable) {
    events = events.map((e) => {
      if (typeof e.scrollDepth !== 'number' || typeof e.sessionDuration !== 'number') return e;
      const family =
        e.eventType === 'read_thorough' || e.eventType === 'read_skim' ||
        e.eventType === 'read_shallow' || e.eventType === 'quick_exit' || e.eventType === 'swipe_next';
      if (!family) return e;
      const re = classifyRead(cfg, e.scrollDepth, e.sessionDuration, e.actualWordCount || 0, 200);
      return re && re !== e.eventType ? { ...e, eventType: re } : e;
    });
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

  // 1b. Load existing publisher IDs from module-level TTL cache (C5 fix).
  // Avoids a full publishers collection scan on every behavior sync call.
  const existingPublisherIds = await getExistingPublisherIds();

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

      const trendingDelta = event.articleId ? getTrendingIncrement(cfg, event.eventType) : 0;
      const qualityDelta = event.articleId ? getPublisherQualityIncrement(cfg, event.eventType) : 0;

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

  // --- Analytics: user action events ---
  const userActionEvents: Array<{ name: string; params: Record<string, any> }> = [];
  for (const event of events) {
    const pubName = event.articleId ? articleToPublisher[event.articleId] : undefined;
    userActionEvents.push({
      name: event.eventType,
      params: {
        user_id: event.userId,
        article_id: event.articleId,
        publisher_id: pubName || '',
        category_id: event.articleCategory || '',
        read_duration_seconds: event.sessionDuration ? Math.round(event.sessionDuration / 1000) : 0,
        scroll_depth: event.scrollDepth || 0,
      },
    });
  }

  // Fire-and-forget — analytics events don't block the response
  if (userActionEvents.length > 0) {
    sendGAEvents(clientId, userActionEvents).catch(() => {});
  }

  // 4. Trigger weight updates for affected users.
  // Forward the GA4 client_id so the weight events share the same id.
  for (const userId of userIds) {
    try {
      await updateWeights(userId, clientId, cfg);
    } catch (error: any) {
      console.error(`[syncBehaviorEvents] Weight update failed for ${userId}:`, error.message);
    }
  }

  return { synced, errors };
});
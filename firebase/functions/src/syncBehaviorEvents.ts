// ============================================================
// SubTick — syncBehaviorEvents (HTTPS Callable)
// Saves behavior events, increments article trendingScore and
// publisher qualityScore dynamically in real-time.
// ============================================================

import { HttpsError, onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { BehaviorEvent, BehaviorEventType, UserProfile } from './types.js';
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

const EXPLICIT_EVENT_TYPES = new Set<BehaviorEventType>([
  'swipe_not_interested', 'like', 'unlike', 'save', 'unsave',
]);

const READ_EVENT_TYPES = new Set<BehaviorEventType>([
  'read_session', 'read_thorough', 'read_skim', 'read_shallow', 'quick_exit', 'swipe_next',
]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateEvent(raw: unknown, userId: string): BehaviorEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const event = raw as Partial<BehaviorEvent>;
  const validTypes = new Set<BehaviorEventType>([...EXPLICIT_EVENT_TYPES, ...READ_EVENT_TYPES]);
  if (
    typeof event.id !== 'string' || !event.id || event.id.length > 200 ||
    typeof event.articleId !== 'string' || !event.articleId || event.articleId.length > 500 ||
    !validTypes.has(event.eventType as BehaviorEventType) ||
    typeof event.articleCategory !== 'string' || event.articleCategory.length > 100 ||
    typeof event.lengthStyle !== 'string' || event.lengthStyle.length > 50 ||
    (event.feedId !== undefined && (typeof event.feedId !== 'string' || event.feedId.length > 100)) ||
    (event.impressionId !== undefined && (typeof event.impressionId !== 'string' || event.impressionId.length > 150)) ||
    !isFiniteNumber(event.timestamp) || !isFiniteNumber(event.sessionDuration) ||
    !isFiniteNumber(event.scrollDepth) ||
    event.sessionDuration < 0 || event.sessionDuration > 24 * 60 * 60 * 1000 ||
    event.scrollDepth < 0 || event.scrollDepth > 1 ||
    (event.actualWordCount !== undefined && (!isFiniteNumber(event.actualWordCount) || event.actualWordCount < 0 || event.actualWordCount > 1_000_000)) ||
    (event.publicationName !== undefined && (typeof event.publicationName !== 'string' || event.publicationName.length > 200))
  ) {
    return null;
  }
  return { ...event, userId } as BehaviorEvent;
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
  const submittedEvents = Array.isArray(data.events) ? data.events : [];
  let invalidEvents = 0;
  let events = submittedEvents.map(event => validateEvent(event, authenticatedUserId)).filter((event): event is BehaviorEvent => {
    if (!event) invalidEvents++;
    return event !== null;
  });

  // Input size cap: prevent batch overflow (Firestore limits batches to 500 ops)
  // and rate-limit abuse. The high-fidelity matrix can send up to feedSize (≤100)
  // events per feed; the real app normally sends ≤20 per flush.
  if (events.length > 100) {
    console.warn(`[syncBehaviorEvents] Truncating ${events.length} events to 100 (possible abuse or oversized flush)`);
    events = events.slice(0, 100);
  }

  if (!events.length) {
    return { synced: 0, errors: 0 };
  }

  // Single source of truth for all tunable values (cached ~60s per instance).
  // Use a preview config override for this request if supplied; else load live.
  const cfg = prepareConfig(data.configOverride) ?? await loadScoringConfig();

  // The authenticated profile is the sole source of truth for reading pace.
  // Fetch it once per batch, never trust a client-provided WPM value.
  const profileDoc = await db.collection('users').doc(authenticatedUserId).get();
  const profile = profileDoc.exists ? profileDoc.data() as UserProfile & { isActive?: boolean } : undefined;
  if (profile?.isActive === false) {
    throw new HttpsError('permission-denied', 'This account has been disabled.');
  }
  const userWpm = typeof profile?.averageWpm === 'number' && profile.averageWpm > 0
    ? profile.averageWpm
    : 200;

  // Raw sessions are always classified on the backend. Existing clients may
  // still send legacy read-family labels during rollout; reclassify them too.
  events = events.map((event) => {
    if (!READ_EVENT_TYPES.has(event.eventType) || EXPLICIT_EVENT_TYPES.has(event.eventType)) {
      return event;
    }
    return {
      ...event,
      eventType: classifyRead(
        cfg,
        event.scrollDepth,
        event.sessionDuration,
        event.actualWordCount || 0,
        userWpm
      ),
    };
  });

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
  let errors = invalidEvents;
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
  
  // Pre-fetch current publisher quality scores for any affected EXISTING publishers,
  // so we can write absolute values instead of admin.firestore.FieldValue.increment
  // (which the Firebase Emulator's stubbed firebase-admin does not implement).
  const existingPublisherQuality: Record<string, number> = {};
  const affectedExistingPubs = Object.keys(publisherQualityDeltas).filter((id) => existingPublisherIds.has(id));
  if (affectedExistingPubs.length > 0) {
    try {
      const pubRefs = affectedExistingPubs.map((id) => db.collection('publishers').doc(id));
      const pubDocs = await db.getAll(...pubRefs);
      pubDocs.forEach((doc) => {
        if (doc.exists) {
          existingPublisherQuality[doc.id] = (doc.data()?.qualityScore ?? DEFAULT_PUBLISHER_QUALITY);
        }
      });
    } catch (err: any) {
      console.warn('[syncBehaviorEvents] Failed to pre-fetch publisher quality:', err.message);
    }
  }

  // Apply aggregated article updates (trendingScore and peakTrendingScore merged into ONE write)
  for (const [artId, netDelta] of Object.entries(articleTrendingDeltas)) {
    // Only touch articles that actually exist in Firestore. If an article was
    // cleaned up after being shown, skip it rather than failing the whole batch
    // (which would also drop this batch's weight updates).
    const initial = articleInitialScores[artId];
    if (!initial) {
      console.warn(`[syncBehaviorEvents] Skipping trending update for missing article ${artId}`);
      continue;
    }
    if (netDelta !== 0) {
      const articleRef = db.collection('articles').doc(artId);
      const updateData: any = { trendingScore: (initial.trendingScore ?? 0) + netDelta };
      const estimatedNewTrending = initial.trendingScore + netDelta;
      if (estimatedNewTrending > initial.peakTrendingScore) {
        updateData.peakTrendingScore = estimatedNewTrending;
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
          qualityScore: (existingPublisherQuality[sanitizedDocId] ?? DEFAULT_PUBLISHER_QUALITY) + netDelta,
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
        feed_id: event.feedId || '',
        impression_id: event.impressionId || '',
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
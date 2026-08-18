// ============================================================
// SubTick — Behavior Event Sync Service
// Queues behavior events in AsyncStorage, batches upload via
// syncBehaviorEvents Cloud Function (which saves + updates weights).
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { httpsCallable } from 'firebase/functions';
import { functions, getClientId } from './firebase';
import { PendingBehaviorEvent, BehaviorEventType, RecommendationContext } from '../types';
import { BEHAVIOR_QUEUE_KEY, SYNC_BATCH_SIZE, MAX_QUEUE_SIZE } from '../utils/constants';
import { auth } from './firebase';
import { createStorageMutex } from './asyncStorageMutex';

const storageMutex = createStorageMutex();

/**
 * Generate a simple UUID for event IDs.
 */
function generateId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Add a behavior event to the local queue (AsyncStorage).
 */
export async function queueBehaviorEvent(
  articleId: string,
  eventType: BehaviorEventType,
  articleCategory: string,
  lengthStyle: string,
  publicationName: string | undefined,
  sessionDuration: number,
  scrollDepth: number,
  actualWordCount?: number,
  recommendationContext?: RecommendationContext
): Promise<void> {
  return storageMutex.enqueue(async () => {
    try {
      const userId = auth.currentUser?.uid;
      if (!userId) return;

      const event: PendingBehaviorEvent = {
        id: generateId(),
        articleId,
        userId,
        eventType,
        timestamp: Date.now(),
        articleCategory,
        lengthStyle,
        publicationName,
        sessionDuration,
        scrollDepth,
        actualWordCount,
        feedId: recommendationContext?.feedId,
        impressionId: recommendationContext?.impressionId,
        synced: false,
      };

      // Read current queue
      const raw = await AsyncStorage.getItem(BEHAVIOR_QUEUE_KEY);
      const queue: PendingBehaviorEvent[] = raw ? JSON.parse(raw) : [];

      // Prevent unbounded growth
      if (queue.length >= MAX_QUEUE_SIZE) {
        // Drop oldest unsynced events
        queue.splice(0, queue.length - MAX_QUEUE_SIZE + 1);
      }

      queue.push(event);
      await AsyncStorage.setItem(BEHAVIOR_QUEUE_KEY, JSON.stringify(queue));

      // Reaching a batch boundary does not start a Cloud Function upload during
      // Reader interaction. Events remain safely queued and sync on Reader exit,
      // reconnect, or the next application lifecycle flush.
    } catch (error) {
      console.error('[BehaviorSync] queueBehaviorEvent error:', error);
    }
  });
}

/**
 * Flush queued events to the syncBehaviorEvents Cloud Function.
 * The Cloud Function saves events to Firestore AND triggers weight updates.
 * Returns number of successfully synced events.
 *
 * B6 Fix: Wrap the read-modify-write in the same enqueueStorageOperation mutex
 * as queueBehaviorEvent. Previously a concurrent swipe could interleave between
 * the read and the final write here, silently clobbering the newly-added event.
 * The network call (syncFn) is deliberately kept outside the mutex so it doesn't
 * block new events from being queued while the upload is in-flight.
 */
export async function flushBehaviorQueue(): Promise<number> {
  try {
    // Step 1: Read and extract the batch to send — serialized via mutex.
    const { batch, queueSnapshot } = await storageMutex.enqueue(async () => {
      const raw = await AsyncStorage.getItem(BEHAVIOR_QUEUE_KEY);
      if (!raw) return { batch: [], queueSnapshot: [] };
      const queue: PendingBehaviorEvent[] = JSON.parse(raw);
      const unsynced = queue.filter((e) => !e.synced);
      if (unsynced.length === 0) return { batch: [], queueSnapshot: queue };
      return { batch: unsynced.slice(0, SYNC_BATCH_SIZE), queueSnapshot: queue };
    });

    if (batch.length === 0) return 0;

    // Step 2: Network call — outside mutex so new events can queue in parallel.
    const clientId = await getClientId();
    const syncFn = httpsCallable<{ events: PendingBehaviorEvent[]; client_id: string }, { synced: number; errors: number }>(
      functions,
      'syncBehaviorEvents'
    );
    const result = await syncFn({ events: batch, client_id: clientId });
    const syncedCount = result.data.synced ?? batch.length;
    console.log(`[BehaviorSync] Cloud Function synced ${syncedCount}/${batch.length} events`);

    // Step 3: Write back the updated queue — serialized via mutex.
    await storageMutex.enqueue(async () => {
      const raw = await AsyncStorage.getItem(BEHAVIOR_QUEUE_KEY);
      const currentQueue: PendingBehaviorEvent[] = raw ? JSON.parse(raw) : queueSnapshot;

      const syncedIds = new Set(batch.slice(0, syncedCount).map((e) => e.id));
      const updatedQueue = currentQueue.map((e) =>
        syncedIds.has(e.id) ? { ...e, synced: true } : e
      );

      // Remove fully synced events older than 5 minutes to keep queue small
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      const cleaned = updatedQueue.filter(
        (e) => !e.synced || e.timestamp > fiveMinAgo
      );

      await AsyncStorage.setItem(BEHAVIOR_QUEUE_KEY, JSON.stringify(cleaned));
    });

    return syncedCount;
  } catch (error) {
    console.error('[BehaviorSync] flushBehaviorQueue error:', error);
    return 0;
  }
}

/**
 * Get the current count of unsynced events waiting in the queue.
 */
export async function getPendingEventCount(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(BEHAVIOR_QUEUE_KEY);
    if (!raw) return 0;
    const queue: PendingBehaviorEvent[] = JSON.parse(raw);
    return queue.filter((e) => !e.synced).length;
  } catch {
    return 0;
  }
}
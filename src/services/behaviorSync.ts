// ============================================================
// SubTick — Behavior Event Sync Service
// Queues behavior events in AsyncStorage, batches upload via
// syncBehaviorEvents Cloud Function (which saves + updates weights).
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { PendingBehaviorEvent, BehaviorEventType } from '../types';
import { BEHAVIOR_QUEUE_KEY, SYNC_BATCH_SIZE, MAX_QUEUE_SIZE } from '../utils/constants';
import { auth } from './firebase';

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
  actualWordCount?: number
): Promise<void> {
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

    // If we have a batch ready, trigger an immediate flush
    const unsynced = queue.filter((e) => !e.synced).length;
    if (unsynced >= SYNC_BATCH_SIZE) {
      flushBehaviorQueue().catch(() => {
        // Silently fail — will retry on next network check
      });
    }
  } catch (error) {
    console.error('[BehaviorSync] queueBehaviorEvent error:', error);
  }
}

/**
 * Flush queued events to the syncBehaviorEvents Cloud Function.
 * The Cloud Function saves events to Firestore AND triggers weight updates.
 * Returns number of successfully synced events.
 */
export async function flushBehaviorQueue(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(BEHAVIOR_QUEUE_KEY);
    if (!raw) return 0;

    const queue: PendingBehaviorEvent[] = JSON.parse(raw);
    if (queue.length === 0) return 0;

    const unsynced = queue.filter((e) => !e.synced);
    if (unsynced.length === 0) return 0;

    // Send batch to syncBehaviorEvents Cloud Function (handles save + weight update)
    const batch = unsynced.slice(0, SYNC_BATCH_SIZE);
    const syncFn = httpsCallable<{ events: PendingBehaviorEvent[] }, { synced: number; errors: number }>(
      functions,
      'syncBehaviorEvents'
    );

    const result = await syncFn({ events: batch });
    const syncedCount = result.data.synced || batch.length;

    console.log(`[BehaviorSync] Cloud Function synced ${syncedCount}/${batch.length} events`);

    // Mark synced events
    const syncedIds = new Set(batch.slice(0, syncedCount).map((e) => e.id));
    const updatedQueue = queue.map((e) =>
      syncedIds.has(e.id) ? { ...e, synced: true } : e
    );

    // Remove fully synced events older than 5 minutes to keep queue small
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const cleaned = updatedQueue.filter(
      (e) => !e.synced || e.timestamp > fiveMinAgo
    );

    await AsyncStorage.setItem(BEHAVIOR_QUEUE_KEY, JSON.stringify(cleaned));
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

/**
 * Clear all behavior queue data (e.g., on logout).
 */
export async function clearBehaviorQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(BEHAVIOR_QUEUE_KEY);
  } catch (error) {
    console.error('[BehaviorSync] clearBehaviorQueue error:', error);
  }
}
// ============================================================
// SubTick — Offline Manager
// Listens for network connectivity changes, auto-flushes
// queued behavior events when internet is restored.
// ============================================================

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { flushBehaviorQueue, getPendingEventCount } from './behaviorSync';

let unsubscribe: (() => void) | null = null;
let isSyncing = false;

/**
 * Start listening for network connectivity changes.
 * Automatically flushes queued behavior events when online.
 */
export function startOfflineManager(): void {
  if (unsubscribe) return; // Already running

  unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
    if (state.isConnected && state.isInternetReachable !== false) {
      attemptFlush();
    }
  });

  // Also attempt flush immediately if already online
  NetInfo.fetch().then((state) => {
    if (state.isConnected && state.isInternetReachable !== false) {
      attemptFlush();
    }
  });
}

/**
 * Stop the offline manager.
 */
export function stopOfflineManager(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

/**
 * Attempt to flush the behavior queue (with debounce to prevent concurrent syncs).
 */
async function attemptFlush(): Promise<void> {
  if (isSyncing) return;

  try {
    const pending = await getPendingEventCount();
    if (pending === 0) return;

    isSyncing = true;
    console.log(`[OfflineManager] Flushing ${pending} pending events...`);
    const synced = await flushBehaviorQueue();
    console.log(`[OfflineManager] Synced ${synced} events`);
  } catch (error) {
    console.error('[OfflineManager] Flush error:', error);
  } finally {
    isSyncing = false;
  }
}

/**
 * Manually trigger a flush (useful for pull-to-refresh or explicit sync buttons).
 */
export async function manualFlush(): Promise<number> {
  return flushBehaviorQueue();
}
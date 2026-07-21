// ============================================================
// SubTick — Offline Manager
// Listens for network connectivity changes, auto-flushes
// queued behavior events when internet is restored.
// ============================================================

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { flushBehaviorQueue, getPendingEventCount } from './behaviorSync';

let unsubscribe: (() => void) | null = null;
let isSyncing = false;
let lastFailureTime = 0;
const RETRY_COOLDOWN_MS = 30_000; // 30 seconds cooldown after a failed sync

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
 * Attempt to flush the behavior queue.
 * Prevents concurrent syncs and enforces a cooldown after failures
 * to avoid hammering the server on a spotty connection.
 */
async function attemptFlush(): Promise<void> {
  if (isSyncing) return;

  // Enforce cooldown after failures — don't retry too quickly on spotty networks
  const timeSinceLastFailure = Date.now() - lastFailureTime;
  if (lastFailureTime > 0 && timeSinceLastFailure < RETRY_COOLDOWN_MS) {
    console.log(`[OfflineManager] Skipping flush — retry cooldown active (${Math.round((RETRY_COOLDOWN_MS - timeSinceLastFailure) / 1000)}s remaining)`);
    return;
  }

  try {
    const pending = await getPendingEventCount();
    if (pending === 0) return;

    isSyncing = true;
    console.log(`[OfflineManager] Flushing ${pending} pending events...`);
    const synced = await flushBehaviorQueue();
    console.log(`[OfflineManager] Synced ${synced} events`);
    lastFailureTime = 0; // Reset on success
  } catch (error) {
    console.error('[OfflineManager] Flush error:', error);
    lastFailureTime = Date.now(); // Start cooldown after failure
  } finally {
    isSyncing = false;
  }
}

/**
 * Manually trigger a flush (useful for pull-to-refresh or explicit sync buttons).
 * Bypasses the cooldown since this is user-initiated.
 */
export async function manualFlush(): Promise<number> {
  lastFailureTime = 0; // User-initiated — bypass cooldown
  return flushBehaviorQueue();
}

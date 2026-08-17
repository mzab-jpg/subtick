// ============================================================
// Tangent — Active Session Timer
// Keeps wall-clock background/inactive time out of reading sessions.
// ============================================================

/**
 * @typedef {{ startTime: number, pausedAt: number | null }} ActiveSessionClock
 */

/** @param {number} now */
export function createActiveSessionClock(now) {
  return { startTime: now, pausedAt: null };
}

/** @param {ActiveSessionClock} clock @param {number} now */
export function pauseActiveSession(clock, now) {
  if (clock.pausedAt === null) clock.pausedAt = now;
}

/** @param {ActiveSessionClock} clock @param {number} now */
export function resumeActiveSession(clock, now) {
  if (clock.pausedAt === null) return;
  clock.startTime += Math.max(0, now - clock.pausedAt);
  clock.pausedAt = null;
}

/** @param {ActiveSessionClock} clock @param {number} now */
export function getActiveSessionDuration(clock, now) {
  const ongoingPause = clock.pausedAt === null ? 0 : Math.max(0, now - clock.pausedAt);
  return Math.max(0, now - clock.startTime - ongoingPause);
}

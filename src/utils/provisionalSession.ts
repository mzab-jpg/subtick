// ============================================================
// SubTick — Provisional Session Math
// Pure, unit-testable computation behind the optimistic stats
// preview (applyProvisionalSession). Mirrors the server's stats
// rules so the instant preview can never diverge from the
// authoritative record. No React / side effects here.
// ============================================================

import { ReaderSessionSummary, UserProfile } from '../types';
import {
  calculateWpm,
  classifyLocalRead,
  estimateNextStreak,
  isFinishedRead,
  isQualifyingRead,
} from './dashboardMetrics';
import { MAX_PLAUSIBLE_WPM, MIN_PLAUSIBLE_WPM, MIN_WPM_CALIBRATION_WORDS } from './constants';

export interface ProvisionalSessionResult {
  /** True if this visit counts toward the rolling weekly-reads metric. */
  countsAsWeekly: boolean;
  /** Locally computed profile overrides to merge until the server confirms. */
  profilePatch: Partial<UserProfile>;
}

/**
 * Compute the optimistic profile updates for a just-concluded reading session.
 *
 * Rules (mirrors the backend):
 *   - Finished stat credit: >= 70% depth only.
 *   - Weekly-reads & streak credit: >= 40% depth.
 *   - Hours-read: every visit's active time counts.
 *   - WPM: consumed words only (words x furthest scroll); skims/abandoned opens
 *     (which could compute ~10,000 WPM) are excluded via the plausibility band.
 */
export function computeProvisionalSession(
  profile: UserProfile,
  summary: ReaderSessionSummary
): ProvisionalSessionResult {
  const outcome = classifyLocalRead(summary);
  const countsAsWeekly = isQualifyingRead(outcome);
  const countsAsFinished = isFinishedRead(outcome);
  const now = summary.timestamp;

  const consumedWords = Math.round(
    (summary.actualWordCount || 0) * Math.min(1, Math.max(0, summary.scrollDepth || 0))
  );

  let sessionWpm: number | null = null;
  if (summary.sessionDuration > 0 && consumedWords >= MIN_WPM_CALIBRATION_WORDS) {
    const rawSessionWpm = calculateWpm(consumedWords, summary.sessionDuration);
    if (rawSessionWpm !== null && rawSessionWpm >= MIN_PLAUSIBLE_WPM && rawSessionWpm <= MAX_PLAUSIBLE_WPM) {
      sessionWpm = rawSessionWpm;
    }
  }

  return {
    countsAsWeekly,
    profilePatch: {
      totalArticlesRead: profile.totalArticlesRead + (countsAsFinished ? 1 : 0),
      totalReadTimeMs: (profile.totalReadTimeMs || 0) + summary.sessionDuration,
      currentStreakDays: countsAsWeekly
        ? estimateNextStreak(profile.lastReadDate, profile.currentStreakDays, now)
        : profile.currentStreakDays,
      averageWpm:
        sessionWpm === null
          ? profile.averageWpm
          : Math.round((profile.averageWpm || 200) * 0.8 + sessionWpm * 0.2),
    },
  };
}
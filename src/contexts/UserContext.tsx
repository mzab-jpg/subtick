// ============================================================
// SubTick — User Context
// Provides the current UserProfile to all screens via React
// Context, replacing the per-screen `fetchUserProfile()` pattern.
// It owns the authenticated profile subscription so all screens use
// the same current profile data.
// ============================================================

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { BehaviorEvent, ReaderSessionSummary, UserProfile } from '../types';
import { calculateWpm, classifyLocalRead, countWeeklyQualifyingReads, estimateNextStreak, isFinishedRead, isQualifyingRead } from '../utils/dashboardMetrics';
import { MAX_PLAUSIBLE_WPM, MIN_PLAUSIBLE_WPM, MIN_WPM_CALIBRATION_WORDS } from '../utils/constants';
import { auth, db } from '../services/firebase';
import { saveStartupSnapshot } from '../services/startupCache';

interface UserContextValue {
  profile: UserProfile | null;
  /** Actual qualifying reads in the rolling seven-day window. */
  weeklyReadCount: number;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  /** Immediately display a locally calculated session result until server profile data confirms it. */
  applyProvisionalSession: (summary: ReaderSessionSummary | null) => void;
}

const UserContext = createContext<UserContextValue>({
  profile: null,
  weeklyReadCount: 0,
  loading: true,
  refreshProfile: async () => {},
  applyProvisionalSession: () => {},
});

export function useUser(): UserContextValue {
  return useContext(UserContext);
}

interface UserProviderProps {
  children: ReactNode;
}

export function UserProvider({ children }: UserProviderProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [weeklyReadCount, setWeeklyReadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [provisionalProfile, setProvisionalProfile] = useState<UserProfile | null>(null);
  const [provisionalWeeklyReads, setProvisionalWeeklyReads] = useState<number | null>(null);
  const provisionalBaseUpdatedAtRef = React.useRef<number | null>(null);
  // Audit fix: fetched events kept in memory so the rolling weekly count can
  // age entries out locally instead of re-subscribing to Firestore hourly.
  const weeklyEventsRef = React.useRef<BehaviorEvent[]>([]);

  const applyProvisionalSession = useCallback((summary: ReaderSessionSummary | null) => {
    if (!summary || !profile) return;
    // Stats spec: Finished = 70%+ depth; weekly reads & streak day = 40%+;
    // hours read and WPM calibration accept every visit (guards below filter
    // junk mechanically rather than by label).
    const outcome = classifyLocalRead(summary);
    const countsAsWeekly = isQualifyingRead(outcome);
    const countsAsFinished = isFinishedRead(outcome);
    const now = summary.timestamp;
    // WPM Fix (yardstick protection) — mirrors the server rules so the instant
    // preview can never diverge from the authoritative record:
    //   1. Only genuine reads (countsAsTime) may recalibrate speed.
    //   2. Consumed words only (article words × furthest scroll), never the
    //      full count for partially-read pieces.
    //   3. Human-plausibility band [MIN, MAX] — skims and abandoned opens
    //      (which could compute ~10,000 WPM on long articles) are excluded.
    const consumedWords = Math.round(
      (summary.actualWordCount || 0) * Math.min(1, Math.max(0, summary.scrollDepth || 0))
    );
    let sessionWpm: number | null = null;
    if (
      summary.sessionDuration > 0 &&
      consumedWords >= MIN_WPM_CALIBRATION_WORDS
    ) {
      const rawSessionWpm = calculateWpm(consumedWords, summary.sessionDuration);
      if (rawSessionWpm !== null && rawSessionWpm >= MIN_PLAUSIBLE_WPM && rawSessionWpm <= MAX_PLAUSIBLE_WPM) {
        sessionWpm = rawSessionWpm;
      }
    }

    provisionalBaseUpdatedAtRef.current = profile.lastUpdated || 0;
    setProvisionalProfile({
      ...profile,
      totalArticlesRead: profile.totalArticlesRead + (countsAsFinished ? 1 : 0),
      // Hours-read spec: every visit's active time counts.
      totalReadTimeMs: (profile.totalReadTimeMs || 0) + summary.sessionDuration,
      currentStreakDays: countsAsWeekly ? estimateNextStreak(profile.lastReadDate, profile.currentStreakDays, now) : profile.currentStreakDays,
      averageWpm: sessionWpm === null ? profile.averageWpm : Math.round((profile.averageWpm || 200) * 0.8 + sessionWpm * 0.2),
    });
    if (countsAsWeekly) setProvisionalWeeklyReads(weeklyReadCount + 1);
  }, [profile, weeklyReadCount]);

  const refreshProfile = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) {
      setProfile(null);
      return;
    }

    try {
      const snapshot = await getDoc(doc(db, 'users', user.uid));
      setProfile(snapshot.exists() ? snapshot.data() as UserProfile : null);
    } catch (error) {
      console.error('[UserContext] refreshProfile error:', error);
    }
  }, []);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | undefined;
    let unsubscribeWeeklyReads: (() => void) | undefined;
    let weeklyReadRefreshTimer: ReturnType<typeof setInterval> | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeProfile?.();
      unsubscribeWeeklyReads?.();
      if (weeklyReadRefreshTimer) clearInterval(weeklyReadRefreshTimer);
      unsubscribeProfile = undefined;
      unsubscribeWeeklyReads = undefined;
      weeklyReadRefreshTimer = undefined;

      // Clear the old account immediately on every auth change. This prevents
      // its stats/profile from being rendered during a sign-out/delete swap.
      setProfile(null);
      setWeeklyReadCount(0);
      weeklyEventsRef.current = [];
      setProvisionalProfile(null);
      setProvisionalWeeklyReads(null);
      provisionalBaseUpdatedAtRef.current = null;

      if (!user) {
        setLoading(false);
        return;
      }

      setLoading(true);
      unsubscribeProfile = onSnapshot(
        doc(db, 'users', user.uid),
        (snapshot) => {
          const nextProfile = snapshot.exists() ? snapshot.data() as UserProfile : null;
          setProfile(nextProfile);
          if (nextProfile) void saveStartupSnapshot(nextProfile);
          if (__DEV__) console.log(`[Startup Timing] shared profile listener ready (${nextProfile?.isOnboarded ? 'onboarded' : 'onboarding'})`);
          if (nextProfile && provisionalBaseUpdatedAtRef.current !== null && nextProfile.lastUpdated > provisionalBaseUpdatedAtRef.current) {
            setProvisionalProfile(null);
            setProvisionalWeeklyReads(null);
            provisionalBaseUpdatedAtRef.current = null;
          }
          setLoading(false);
        },
        (error) => {
          console.error('[UserContext] profile listener error:', error);
          setProfile(null);
          setLoading(false);
        }
      );

      weeklyEventsRef.current = [];
      const recomputeWeeklyReads = () => {
        const windowStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const recentEvents = weeklyEventsRef.current.filter(function (e) {
          return e.timestamp >= windowStart;
        });
        setWeeklyReadCount(countWeeklyQualifyingReads(recentEvents));
      };
      const windowStartFixed = Date.now() - 7 * 24 * 60 * 60 * 1000;
      unsubscribeWeeklyReads = onSnapshot(
        query(
          collection(db, 'users', user.uid, 'behavior_events'),
          where('timestamp', '>=', windowStartFixed)
        ),
        (snapshot) => {
          weeklyEventsRef.current = snapshot.docs.map((event) => event.data() as BehaviorEvent);
          recomputeWeeklyReads();
        },
        (error) => {
          console.error('[UserContext] weekly-read listener error:', error);
          setWeeklyReadCount(0);
        }
      );
      // Age expired reads out hourly using events already held in memory -
      // no tear-down, no re-download, no flicker.
      weeklyReadRefreshTimer = setInterval(recomputeWeeklyReads, 60 * 60 * 1000);
    });

    return () => {
      unsubscribeProfile?.();
      unsubscribeWeeklyReads?.();
      if (weeklyReadRefreshTimer) clearInterval(weeklyReadRefreshTimer);
      unsubscribeAuth();
    };
  }, []);

  return (
    <UserContext.Provider value={{
      profile: provisionalProfile || profile,
      weeklyReadCount: provisionalWeeklyReads ?? weeklyReadCount,
      loading,
      refreshProfile,
      applyProvisionalSession,
    }}>
      {children}
    </UserContext.Provider>
  );
}
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
import { calculateWpm, classifyLocalRead, countWeeklyQualifyingReads, estimateNextStreak, isQualifyingRead } from '../utils/dashboardMetrics';
import { auth, db } from '../services/firebase';

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

  const applyProvisionalSession = useCallback((summary: ReaderSessionSummary | null) => {
    if (!summary || !profile) return;
    const outcome = classifyLocalRead(summary, profile.averageWpm || 200);
    const qualifies = isQualifyingRead(outcome);
    const countsAsTime = outcome === 'read_thorough' || outcome === 'read_skim' || outcome === 'read_shallow';
    const now = summary.timestamp;
    const sessionWpm = calculateWpm(summary.actualWordCount, summary.sessionDuration);

    provisionalBaseUpdatedAtRef.current = profile.lastUpdated || 0;
    setProvisionalProfile({
      ...profile,
      totalArticlesRead: profile.totalArticlesRead + (qualifies ? 1 : 0),
      totalReadTimeMs: (profile.totalReadTimeMs || 0) + (countsAsTime ? summary.sessionDuration : 0),
      currentStreakDays: qualifies ? estimateNextStreak(profile.lastReadDate, profile.currentStreakDays, now) : profile.currentStreakDays,
      averageWpm: sessionWpm === null ? profile.averageWpm : Math.round((profile.averageWpm || 200) * 0.8 + sessionWpm * 0.2),
    });
    if (qualifies) setProvisionalWeeklyReads(weeklyReadCount + 1);
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

      // The stored profile counter only increases. This small, owner-scoped
      // listener makes the home-screen value genuinely rolling: reads age out
      // after seven days even when the user has not created a new event.
      const subscribeToWeeklyReads = () => {
        unsubscribeWeeklyReads?.();
        const windowStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
        unsubscribeWeeklyReads = onSnapshot(
          query(
            collection(db, 'users', user.uid, 'behavior_events'),
            where('timestamp', '>=', windowStart)
          ),
          (snapshot) => {
            const events = snapshot.docs.map((event) => event.data() as BehaviorEvent);
            setWeeklyReadCount(countWeeklyQualifyingReads(events));
          },
          (error) => {
            console.error('[UserContext] weekly-read listener error:', error);
            setWeeklyReadCount(0);
          }
        );
      };
      subscribeToWeeklyReads();
      // Recreate the time-window query once an hour so reads also age out
      // correctly during an unusually long uninterrupted app session.
      weeklyReadRefreshTimer = setInterval(subscribeToWeeklyReads, 60 * 60 * 1000);
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
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
import { BehaviorEvent, UserProfile } from '../types';
import { countWeeklyQualifyingReads } from '../utils/dashboardMetrics';
import { auth, db } from '../services/firebase';

interface UserContextValue {
  profile: UserProfile | null;
  /** Actual qualifying reads in the rolling seven-day window. */
  weeklyReadCount: number;
  loading: boolean;
  refreshProfile: () => Promise<void>;
}

const UserContext = createContext<UserContextValue>({
  profile: null,
  weeklyReadCount: 0,
  loading: true,
  refreshProfile: async () => {},
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

      if (!user) {
        setProfile(null);
        setWeeklyReadCount(0);
        setLoading(false);
        return;
      }

      setLoading(true);
      unsubscribeProfile = onSnapshot(
        doc(db, 'users', user.uid),
        (snapshot) => {
          setProfile(snapshot.exists() ? snapshot.data() as UserProfile : null);
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
    <UserContext.Provider value={{ profile, weeklyReadCount, loading, refreshProfile }}>
      {children}
    </UserContext.Provider>
  );
}
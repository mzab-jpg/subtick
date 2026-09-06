// ============================================================
// SubTick - User Context
// Owns the ONLY persistent auth listener and the ONLY user-profile
// subscription, and exposes both to every screen via React Context.
// No other startup path reads the profile document or creates the
// default profile - this listener is the single profile authority.
// ============================================================

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { BehaviorEvent, ReaderSessionSummary, UserProfile } from '../types';
import { countWeeklyQualifyingReads } from '../utils/dashboardMetrics';
import { computeProvisionalSession } from '../utils/provisionalSession';
import { auth, db } from '../services/firebase';
import { saveStartupSnapshot } from '../services/startupCache';
import { ensureUserProfile } from '../services/auth';

interface UserContextValue {
  /** The authenticated Firebase user, reported by the single auth listener. */
  user: User | null;
  profile: UserProfile | null;
  /** Set when the profile could not be loaded or created (e.g. offline). */
  profileError: string | null;
  /** Actual qualifying reads in the rolling seven-day window. */
  weeklyReadCount: number;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  /** Immediately display a locally calculated session result until server profile data confirms it. */
  applyProvisionalSession: (summary: ReaderSessionSummary | null) => void;
}

const PROFILE_LOAD_ERROR = 'Could not load your profile. Check your internet and try again.';

const UserContext = createContext<UserContextValue>({
  user: null,
  profile: null,
  profileError: null,
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
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [weeklyReadCount, setWeeklyReadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [provisionalProfile, setProvisionalProfile] = useState<UserProfile | null>(null);
  const [provisionalWeeklyReads, setProvisionalWeeklyReads] = useState<number | null>(null);
  const provisionalBaseUpdatedAtRef = React.useRef<number | null>(null);
  // Audit fix: fetched events kept in memory so the rolling weekly count can
  // age entries out locally instead of re-subscribing to Firestore hourly.
  const weeklyEventsRef = React.useRef<BehaviorEvent[]>([]);
  // The startup snapshot only stores {userId, isOnboarded}; persist it only
  // when that payload actually changes, not on every profile mutation.
  const savedSnapshotSignatureRef = React.useRef<string | null>(null);

  const applyProvisionalSession = useCallback((summary: ReaderSessionSummary | null) => {
    if (!summary || !profile) return;
    provisionalBaseUpdatedAtRef.current = profile.lastUpdated || 0;
    const result = computeProvisionalSession(profile, summary);
    setProvisionalProfile({ ...profile, ...result.profilePatch });
    if (result.countsAsWeekly) setProvisionalWeeklyReads(weeklyReadCount + 1);
  }, [profile, weeklyReadCount]);

  const refreshProfile = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setProfile(null);
      return;
    }

    try {
      const snapshot = await getDoc(doc(db, 'users', currentUser.uid));
      if (snapshot.exists()) {
        setProfile(snapshot.data() as UserProfile);
      } else {
        // Missing profile (first launch, or recovery after an offline launch
        // failed to create it) - create it so callers always end with a
        // usable profile.
        setProfile(await ensureUserProfile(currentUser));
      }
      setProfileError(null);
    } catch (error) {
      console.error('[UserContext] refreshProfile error:', error);
      setProfileError(PROFILE_LOAD_ERROR);
    }
  }, []);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | undefined;
    let unsubscribeWeeklyReads: (() => void) | undefined;
    let weeklyReadRefreshTimer: ReturnType<typeof setInterval> | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, (nextUser) => {
      unsubscribeProfile?.();
      unsubscribeWeeklyReads?.();
      if (weeklyReadRefreshTimer) clearInterval(weeklyReadRefreshTimer);
      unsubscribeProfile = undefined;
      unsubscribeWeeklyReads = undefined;
      weeklyReadRefreshTimer = undefined;

      // Clear the old account immediately on every auth change. This prevents
      // its stats/profile from being rendered during a sign-out/delete swap.
      setUser(nextUser);
      setProfile(null);
      setProfileError(null);
      setWeeklyReadCount(0);
      weeklyEventsRef.current = [];
      setProvisionalProfile(null);
      setProvisionalWeeklyReads(null);
      provisionalBaseUpdatedAtRef.current = null;
      savedSnapshotSignatureRef.current = null;

      if (!nextUser) {
        setLoading(false);
        return;
      }

      setLoading(true);
      unsubscribeProfile = onSnapshot(
        doc(db, 'users', nextUser.uid),
        (snapshot) => {
          if (!snapshot.exists()) {
            // Single-owner profile bootstrap: this shared listener is the
            // only startup path that creates the default profile. The next
            // emission delivers the created document.
            setProfile(null);
            void ensureUserProfile(nextUser).catch((error) => {
              console.error('[UserContext] profile creation error:', error);
              setProfileError(PROFILE_LOAD_ERROR);
              setLoading(false);
            });
            return;
          }
          const nextProfile = snapshot.data() as UserProfile;
          setProfile(nextProfile);
          setProfileError(null);
          const snapshotSignature = `${nextProfile.userId}:${nextProfile.isOnboarded === true}`;
          if (savedSnapshotSignatureRef.current !== snapshotSignature) {
            savedSnapshotSignatureRef.current = snapshotSignature;
            void saveStartupSnapshot(nextProfile);
          }
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
          setProfileError(PROFILE_LOAD_ERROR);
          setLoading(false);
        }
      );

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
          collection(db, 'users', nextUser.uid, 'behavior_events'),
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
      user,
      profile: provisionalProfile || profile,
      profileError,
      weeklyReadCount: provisionalWeeklyReads ?? weeklyReadCount,
      loading,
      refreshProfile,
      applyProvisionalSession,
    }}>
      {children}
    </UserContext.Provider>
  );
}

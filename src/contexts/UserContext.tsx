// ============================================================
// SubTick — User Context
// Provides the current UserProfile to all screens via React
// Context, replacing the per-screen `fetchUserProfile()` pattern.
// Screens that need real-time subscriptions (Dashboard) should
// supplement with onSnapshot alongside this context.
// ============================================================

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { UserProfile } from '../types';
import { auth } from '../services/firebase';
import { fetchUserProfile } from '../services/auth';

interface UserContextValue {
  profile: UserProfile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
}

const UserContext = createContext<UserContextValue>({
  profile: null,
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
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const p = await fetchUserProfile(user.uid);
      setProfile(p);
    } catch (error) {
      console.error('[UserContext] refreshProfile error:', error);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      const user = auth.currentUser;
      if (user) {
        try {
          const p = await fetchUserProfile(user.uid);
          if (isMounted) setProfile(p);
        } catch (error) {
          console.error('[UserContext] initial load error:', error);
        }
      }
      if (isMounted) setLoading(false);
    };

    load();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <UserContext.Provider value={{ profile, loading, refreshProfile }}>
      {children}
    </UserContext.Provider>
  );
}
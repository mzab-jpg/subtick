// ============================================================
// SubTick - Application Root
// Initializes auth, user profile, theme, and navigation.
// ============================================================

// expo-dev-client must be imported first - enables the dev client launcher
// when running via `npx expo start --dev-client`
import 'expo-dev-client';

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import { UserProvider, useUser } from './src/contexts/UserContext';
import RootNavigator from './src/navigation/RootNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { StartupScreen } from './src/components/StartupScreen';
import { signInAnonymouslyIfNeeded } from './src/services/auth';
import { startOfflineManager } from './src/services/offlineManager';
import { getStartupSnapshot } from './src/services/startupCache';
import { subscribeToAccountTransition } from './src/services/accountTransition';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { GOOGLE_WEB_CLIENT_ID } from './src/config/googleConfig';

function AppContent() {
  const { colors } = useTheme();
  // UserContext owns the ONLY persistent auth listener and the ONLY profile
  // subscription. App derives the entry route and remount decisions from it
  // instead of running its own Firestore reads or Cloud Function calls.
  const { user: authUser, profile, profileError, refreshProfile } = useUser();
  const [initializing, setInitializing] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  // The initial route to navigate to after auth init completes.
  // Determined by whether the user has completed onboarding.
  const [initialRoute, setInitialRoute] = useState<'Dashboard' | 'Onboarding'>('Dashboard');
  // Used as React key on RootNavigator; changing this destroys
  // and recreates the entire navigation tree with fresh subscriptions.
  const [navigationKey, setNavigationKey] = useState(0);
  const [accountTransitioning, setAccountTransitioning] = useState(false);
  const [startupTypingComplete, setStartupTypingComplete] = useState(false);
  const [startupPreparationComplete, setStartupPreparationComplete] = useState(false);
  const [startupSequence, setStartupSequence] = useState(0);
  const startupStartedAtRef = useRef<number | null>(null);
  // Route restored from the local startup snapshot. Undefined means no
  // snapshot existed, so the cloud profile must verify the route before the
  // startup screen may dismiss.
  const cachedRouteRef = useRef<'Dashboard' | 'Onboarding' | undefined>(undefined);
  // Set once the shared profile listener has verified the route for the
  // current initialization sequence.
  const [routeVerified, setRouteVerified] = useState(false);
  // Last seen UID for mid-session account-change detection, plus the remount
  // counter for the navigation key (component-scoped - no module globals).
  const lastUserIdRef = useRef('');
  const navKeyRef = useRef(0);

  const bumpNavigationKey = () => {
    navKeyRef.current += 1;
    setNavigationKey(navKeyRef.current);
  };

  const initializeApp = async () => {
    try {
      setInitializing(true);
      setStartupTypingComplete(false);
      setStartupPreparationComplete(false);
      setRouteVerified(false);
      setStartupSequence((previous) => previous + 1);
      setAuthError(null);
      const startedAt = Date.now();
      startupStartedAtRef.current = startedAt;
      if (__DEV__) console.log('[Startup Timing] initialization started');

      // 1. Sign in anonymously (or re-use the encrypted persisted session).
      const user = await signInAnonymouslyIfNeeded();
      if (__DEV__) console.log(`[Startup Timing] authentication ready in ${Date.now() - startedAt}ms`);

      // 2. A locally saved snapshot is only a display shortcut. It is accepted
      // only after Firebase has restored this exact UID; the shared profile
      // listener in UserContext remains authoritative and verifies the route
      // in the background (immediately for first-ever launches).
      const snapshot = await getStartupSnapshot(user.uid);
      const cachedRoute = snapshot
        ? (snapshot.isOnboarded ? 'Dashboard' : 'Onboarding')
        : undefined;
      cachedRouteRef.current = cachedRoute;
      if (cachedRoute) {
        setInitialRoute(cachedRoute);
        if (__DEV__) console.log(`[Startup Timing] local route restored: ${cachedRoute} in ${Date.now() - startedAt}ms`);
      } else {
        // First-ever accounts (or evicted snapshots) still need a cloud
        // profile before a safe route exists. This reuses the shared profile
        // owner - including re-creating a profile that a previous offline
        // launch failed to create.
        await refreshProfile();
      }

      // Dashboard card restoration and any ranked-feed request are owned
      // entirely by DashboardScreen (cache-first startup, H4). App startup
      // restores only the route; it never blocks on Cloud Functions.

      if (__DEV__) console.log('[SubTick] Auth initialized, userId:', user.uid, 'initialRoute:', cachedRoute || '(verified by profile listener)');

      // Non-essential setup must not compete with first-route rendering.
      setTimeout(() => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { GoogleSignin } = require('@react-native-google-signin/google-signin');
          GoogleSignin.configure({
            webClientId: GOOGLE_WEB_CLIENT_ID,
          });
        } catch {
          if (__DEV__) console.log('[SubTick] Google Sign-In native module not available (Expo Go - use dev client to test Google Sign-In)');
        }
        startOfflineManager();
      }, 0);
    } catch (error: any) {
      console.error('[SubTick] Init error:', error);
      // If Firebase Emulators aren't running, this will fail gracefully
      // Audit fix: emulator guidance is developer-only; production users get a
      // plain connectivity message.
      setAuthError(
        __DEV__ && error.message?.includes('network')
          ? 'Could not connect to server. Is the Firebase Emulator running?'
          : 'Could not connect. Check your internet and tap to retry.'
      );
    } finally {
      setStartupPreparationComplete(true);
    }
  };

  useEffect(() => {
    const unsubscribeTransition = subscribeToAccountTransition((active) => {
      setAccountTransitioning(active);
      if (active) {
        // Reset Account keeps the same UID, so it would not trigger the normal
        // auth-change remount. Rebuild navigation for every account transition.
        setInitialRoute('Onboarding');
        bumpNavigationKey();
      }
    });

    initializeApp();

    return () => {
      unsubscribeTransition();
    };
  }, []);

  // UID changes mid-session (e.g. Google account recovery) bump the navigation
  // key to force React to destroy/recreate the entire navigation tree with
  // fresh Firestore listeners attached to the correct UID.
  useEffect(() => {
    if (!authUser) return;
    if (lastUserIdRef.current && lastUserIdRef.current !== authUser.uid) {
      if (__DEV__) console.log('[SubTick] UID changed mid-session, remounting navigation');
      bumpNavigationKey();
    }
    lastUserIdRef.current = authUser.uid;
  }, [authUser]);

  // The shared profile listener verifies the entry route. Launches with a
  // cached route dismiss immediately and reconcile in the background; first
  // launches reconcile here before the startup screen may dismiss.
  useEffect(() => {
    if (routeVerified || !startupPreparationComplete || !profile) return;
    if (__DEV__) {
      const startedAt = startupStartedAtRef.current ?? Date.now();
      console.log(`[Startup Timing] initial profile ready in ${Date.now() - startedAt}ms`);
    }
    const verifiedRoute: 'Dashboard' | 'Onboarding' = profile.isOnboarded ? 'Dashboard' : 'Onboarding';
    const cachedRoute = cachedRouteRef.current;
    if (cachedRoute === undefined) {
      // No snapshot existed: the cloud profile decides the entry screen.
      setInitialRoute(verifiedRoute);
    } else if (cachedRoute !== verifiedRoute) {
      // The cached route was stale - correct it and remount so the stack
      // starts at the right screen without a flash.
      setInitialRoute(verifiedRoute);
      bumpNavigationKey();
    }
    setRouteVerified(true);
  }, [profile, routeVerified, startupPreparationComplete]);

  // Without a cached route, a failed profile load must surface the retry
  // error instead of waiting forever on the startup screen. With a cached
  // route the failure stays non-fatal (cards render from the local cache).
  useEffect(() => {
    if (routeVerified || accountTransitioning || !startupPreparationComplete) return;
    if (cachedRouteRef.current !== undefined) return;
    if (profileError && !profile) {
      setAuthError(profileError);
      setRouteVerified(true);
    }
  }, [accountTransitioning, profile, profileError, routeVerified, startupPreparationComplete]);

  useEffect(() => {
    if (!initializing || accountTransitioning || !startupPreparationComplete || !startupTypingComplete) return;
    // A hard init failure dismisses as soon as the animation allows; without
    // a cached route, first launches also wait for the verified route.
    if (!authError && cachedRouteRef.current === undefined && !routeVerified) return;
    if (__DEV__ && startupStartedAtRef.current !== null) {
      console.log(`[Startup Timing] React startup screen dismissed in ${Date.now() - startupStartedAtRef.current}ms`);
    }
    setInitializing(false);
  }, [accountTransitioning, authError, initializing, routeVerified, startupPreparationComplete, startupTypingComplete]);

  if (initializing || accountTransitioning) {
    return (
      <StartupScreen
        key={startupSequence}
        accountTransitioning={accountTransitioning}
        onTypingComplete={() => setStartupTypingComplete(true)}
      />
    );
  }

  if (authError) {
    return (
      <View style={[styles.splash, { backgroundColor: colors.background }]}>
        <Text style={styles.splashEmoji}>{'\u26A0\uFE0F'}</Text>
        <Text style={[styles.splashTitle, { color: colors.error }]}>Connection Error</Text>
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>
          {authError}
        </Text>
        <Text
          style={[styles.retryLink, { color: colors.primary }]}
          onPress={initializeApp}
        >
          Tap to Retry
        </Text>
      </View>
    );
  }

  // Ready - render navigation with a key that changes on UID switch,
  // forcing clean remount of all screens with fresh Firestore listeners.
  // Pass initialRoute so the stack starts at the correct screen (no flash).
  return (
    <ErrorBoundary>
      <RootNavigator key={navigationKey} initialRoute={initialRoute} />
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <UserProvider>
          <AppContent />
        </UserProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  splashEmoji: { fontSize: 64, marginBottom: 16 },
  splashTitle: { fontSize: 36, fontWeight: '800', marginBottom: 8 },
  errorText: { fontSize: 15, textAlign: 'center', lineHeight: 22, marginTop: 12, marginBottom: 24 },
  retryLink: { fontSize: 17, fontWeight: '700' },
});

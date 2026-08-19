// ============================================================
// SubTick — Application Root
// Initializes auth, user profile, theme, and navigation.
// ============================================================

// expo-dev-client must be imported first — enables the dev client launcher
// when running via `npx expo start --dev-client`
import 'expo-dev-client';

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import { UserProvider } from './src/contexts/UserContext';
import RootNavigator from './src/navigation/RootNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { StartupScreen } from './src/components/StartupScreen';
import { signInAnonymouslyIfNeeded, ensureUserProfile } from './src/services/auth';
import { startOfflineManager } from './src/services/offlineManager';
import { getStartupSnapshot, saveStartupSnapshot } from './src/services/startupCache';
import { getSeenArticleIdsLocally, getRankedFeed } from './src/services/feedService';
import { restoreCachedDashboardFeed, setCachedDashboardFeed } from './src/services/dashboardFeedCache';
import { subscribeToAccountTransition } from './src/services/accountTransition';
import { User, onAuthStateChanged } from 'firebase/auth';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { auth } from './src/services/firebase';

// Unique key to remount the entire navigation tree when the auth
// user changes mid-session (e.g. Google account recovery swaps
// the anonymous UID for a Google-linked UID). This ensures all
// Firestore listeners re-attach with the correct UID.
let navKey = 0;
let lastUserId = '';

function AppContent() {
  const { colors } = useTheme();
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

  useEffect(() => {
    const unsubscribeTransition = subscribeToAccountTransition((active) => {
      setAccountTransitioning(active);
      if (active) {
        // Reset Account keeps the same UID, so it would not trigger the normal
        // auth-change remount. Rebuild navigation for every account transition.
        setInitialRoute('Onboarding');
        navKey += 1;
        setNavigationKey(navKey);
      }
    });

    initializeApp();

    // Listen for auth state changes. If the UID changes mid-session
    // (e.g. Google account recovery), bump the navigation key to force
    // React to destroy/recreate the entire navigation tree with fresh
    // Firestore listeners attached to the correct UID.
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user && lastUserId && user.uid !== lastUserId) {
        console.log('[SubTick] UID changed mid-session, remounting navigation');
        navKey += 1;
        setNavigationKey(navKey);
        lastUserId = user.uid;
      }
    });
    return () => {
      unsubscribeTransition();
      unsubscribe();
    };
  }, []);

  const initializeApp = async () => {
    try {
      setInitializing(true);
      setStartupTypingComplete(false);
      setStartupPreparationComplete(false);
      setStartupSequence((previous) => previous + 1);
      setAuthError(null);
      const startedAt = Date.now();
      startupStartedAtRef.current = startedAt;
      if (__DEV__) console.log('[Startup Timing] initialization started');

      // 1. Sign in anonymously (or re-use the encrypted persisted session).
      const user: User = await signInAnonymouslyIfNeeded();
      if (__DEV__) console.log(`[Startup Timing] authentication ready in ${Date.now() - startedAt}ms`);

      // 2. A locally saved snapshot is only a display shortcut. It is accepted
      // only after Firebase has restored this exact UID; Firestore verifies it below.
      const snapshot = await getStartupSnapshot(user.uid);
      const cachedRoute = snapshot
        ? (snapshot.isOnboarded ? 'Dashboard' : 'Onboarding')
        : undefined;
      if (cachedRoute) {
        setInitialRoute(cachedRoute);
        if (__DEV__) console.log(`[Startup Timing] local route restored: ${cachedRoute} in ${Date.now() - startedAt}ms`);
      }

      // Restore the exact account's unread cards while the startup phrase types.
      // A returning Dashboard user never transitions from startup into Loading|.
      if (cachedRoute === 'Dashboard') {
        const seenIds = await getSeenArticleIdsLocally();
        const restoredFeed = await restoreCachedDashboardFeed(user.uid, seenIds);
        if (restoredFeed) {
          if (__DEV__) console.log(`[Startup Timing] cached Dashboard cards ready in ${Date.now() - startedAt}ms (${restoredFeed.articles.length} articles)`);
        } else {
          const result = await getRankedFeed(seenIds);
          if (result.articles.length > 0) {
            setCachedDashboardFeed(user.uid, result.articles, []);
          }
          if (__DEV__) console.log(`[Startup Timing] startup ranked feed ready in ${Date.now() - startedAt}ms (${result.articles.length} articles)`);
        }
      }

      // First-ever accounts still need a cloud profile before a safe route exists.
      // Returning accounts verify in the background so cached Home cards are not blocked.
      const verifyProfile = async () => {
        const profile = await ensureUserProfile(user);
        if (__DEV__) console.log(`[Startup Timing] initial profile ready in ${Date.now() - startedAt}ms`);
        await saveStartupSnapshot(profile);
        const verifiedRoute = profile.isOnboarded ? 'Dashboard' : 'Onboarding';
        if (!cachedRoute || cachedRoute !== verifiedRoute) {
          setInitialRoute(verifiedRoute);
          if (cachedRoute && cachedRoute !== verifiedRoute) {
            navKey += 1;
            setNavigationKey(navKey);
          }
        }
        if (__DEV__) console.log(`[Startup Timing] route verified: ${verifiedRoute} in ${Date.now() - startedAt}ms`);
        return profile;
      };

      if (cachedRoute) {
        void verifyProfile().catch((error) => console.warn('[SubTick] Background profile verification failed:', error));
      } else {
        await verifyProfile();
      }

      console.log('[SubTick] Auth initialized, userId:', user.uid, 'initialRoute:', cachedRoute || initialRoute);

      // If the UID changed mid-session (e.g. Google account recovery),
      // bump the navigation key to force a clean remount of all screens.
      if (lastUserId && lastUserId !== user.uid) {
        console.log('[SubTick] UID changed, remounting navigation');
        navKey += 1;
        setNavigationKey(navKey);
      }
      lastUserId = user.uid;

      // Non-essential setup must not compete with first-route rendering.
      setTimeout(() => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { GoogleSignin } = require('@react-native-google-signin/google-signin');
          GoogleSignin.configure({
            webClientId: process.env.EXPO_PUBLIC_FIREBASE_WEB_CLIENT_ID || '859600771798-bco64ngenl3l5b349mcgr29pp868chjn.apps.googleusercontent.com',
          });
        } catch {
          console.log('[SubTick] Google Sign-In native module not available (Expo Go — use dev client to test Google Sign-In)');
        }
        startOfflineManager();
      }, 0);
    } catch (error: any) {
      console.error('[SubTick] Init error:', error);
      // If Firebase Emulators aren't running, this will fail gracefully
      setAuthError(
        error.message?.includes('network')
          ? 'Could not connect to server. Is the Firebase Emulator running?'
          : error.message || 'An unexpected error occurred.'
      );
    } finally {
      setStartupPreparationComplete(true);
    }
  };

  useEffect(() => {
    if (!initializing || accountTransitioning || !startupPreparationComplete || !startupTypingComplete) return;
    if (__DEV__ && startupStartedAtRef.current !== null) {
      console.log(`[Startup Timing] React startup screen dismissed in ${Date.now() - startupStartedAtRef.current}ms`);
    }
    setInitializing(false);
  }, [accountTransitioning, initializing, startupPreparationComplete, startupTypingComplete]);

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
        <Text style={styles.splashEmoji}>⚠️</Text>
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

  // Ready — render navigation with a key that changes on UID switch,
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
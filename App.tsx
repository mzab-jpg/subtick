// ============================================================
// SubTick — Application Root
// Initializes auth, user profile, theme, and navigation.
// ============================================================

// expo-dev-client must be imported first — enables the dev client launcher
// when running via `npx expo start --dev-client`
import 'expo-dev-client';

import React, { useState, useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import { UserProvider } from './src/contexts/UserContext';
import RootNavigator from './src/navigation/RootNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { signInAnonymouslyIfNeeded, ensureUserProfile } from './src/services/auth';
import { startOfflineManager } from './src/services/offlineManager';
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
      setAuthError(null);

      // 0. Configure Google Sign-In (needed for Settings → Link Google Account)
      // Using require() instead of a static import so the app doesn't crash in
      // Expo Go (which lacks the native RNGoogleSignin module). The dev client
      // build includes the native module and will configure it normally.
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { GoogleSignin } = require('@react-native-google-signin/google-signin');
        GoogleSignin.configure({
          webClientId: process.env.EXPO_PUBLIC_FIREBASE_WEB_CLIENT_ID || '859600771798-bco64ngenl3l5b349mcgr29pp868chjn.apps.googleusercontent.com',
        });
      } catch {
        console.log('[SubTick] Google Sign-In native module not available (Expo Go — use dev client to test Google Sign-In)');
      }

      // 1. Sign in anonymously (or re-use existing session)
      const user: User = await signInAnonymouslyIfNeeded();

      // 2. Ensure Firestore user profile exists (creates if new)
      const profile = await ensureUserProfile(user);

      // 3. Determine initial route based on onboarding status
      //    New users (isOnboarded: false) → Onboarding
      //    Returning users (isOnboarded: true) → Dashboard
      setInitialRoute(profile.isOnboarded ? 'Dashboard' : 'Onboarding');

      console.log('[SubTick] Auth initialized, userId:', user.uid, 'initialRoute:', profile.isOnboarded ? 'Dashboard' : 'Onboarding');

      // If the UID changed mid-session (e.g. Google account recovery),
      // bump the navigation key to force a clean remount of all screens.
      if (lastUserId && lastUserId !== user.uid) {
        console.log('[SubTick] UID changed, remounting navigation');
        navKey += 1;
        setNavigationKey(navKey);
      }
      lastUserId = user.uid;

      // Start background sync for behavior events
      startOfflineManager();
    } catch (error: any) {
      console.error('[SubTick] Init error:', error);
      // If Firebase Emulators aren't running, this will fail gracefully
      setAuthError(
        error.message?.includes('network')
          ? 'Could not connect to server. Is the Firebase Emulator running?'
          : error.message || 'An unexpected error occurred.'
      );
    } finally {
      setInitializing(false);
    }
  };

  if (initializing || accountTransitioning) {
    return (
      <View style={[styles.splash, { backgroundColor: colors.background }]}>
        <Text style={styles.splashEmoji}>📖</Text>
        <Text style={[styles.splashTitle, { color: colors.text }]}>Tangent</Text>
        <ActivityIndicator
          size="large"
          color={colors.primary}
          style={{ marginTop: 32 }}
        />
        <Text style={[styles.splashHint, { color: colors.textMuted }]}>
          {accountTransitioning ? 'Preparing your new account...' : 'Connecting to your personalized feed...'}
        </Text>
      </View>
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
  splashHint: { marginTop: 12, fontSize: 13 },
  errorText: { fontSize: 15, textAlign: 'center', lineHeight: 22, marginTop: 12, marginBottom: 24 },
  retryLink: { fontSize: 17, fontWeight: '700' },
});
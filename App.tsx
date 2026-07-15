// ============================================================
// SubTick — Application Root
// Initializes auth, user profile, theme, and navigation.
// ============================================================

import React, { useState, useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, LogBox } from 'react-native';

// Suppress deprecation warnings from third-party libraries
LogBox.ignoreLogs(['InteractionManager has been deprecated']);
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import RootNavigator from './src/navigation/RootNavigator';
import { signInAnonymouslyIfNeeded, ensureUserProfile } from './src/services/auth';
import { startOfflineManager, stopOfflineManager } from './src/services/offlineManager';
import { User } from 'firebase/auth';

function AppContent() {
  const { colors } = useTheme();
  const [initializing, setInitializing] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      setInitializing(true);
      setAuthError(null);

      // 1. Sign in anonymously (or re-use existing session)
      const user: User = await signInAnonymouslyIfNeeded();

      // 2. Ensure Firestore user profile exists (creates if new)
      await ensureUserProfile(user);

      console.log('[SubTick] Auth initialized, userId:', user.uid);

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

  if (initializing) {
    return (
      <View style={[styles.splash, { backgroundColor: colors.background }]}>
        <Text style={styles.splashEmoji}>📖</Text>
        <Text style={[styles.splashTitle, { color: colors.text }]}>SubTick</Text>
        <Text style={[styles.splashSubtitle, { color: colors.textSecondary }]}>
          TikTok for reading
        </Text>
        <ActivityIndicator
          size="large"
          color={colors.primary}
          style={{ marginTop: 32 }}
        />
        <Text style={[styles.splashHint, { color: colors.textMuted }]}>
          Connecting to your personalized feed...
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

  // Ready — render navigation (RootNavigator handles Onboarding → Dashboard routing internally)
  return <RootNavigator />;
}

export default function App() {
  return (
    <View style={{ flex: 1 }}>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </View>
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
  splashSubtitle: { fontSize: 16, fontWeight: '500' },
  splashHint: { marginTop: 12, fontSize: 13 },
  errorText: { fontSize: 15, textAlign: 'center', lineHeight: 22, marginTop: 12, marginBottom: 24 },
  retryLink: { fontSize: 17, fontWeight: '700' },
});
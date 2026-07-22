// ============================================================
// SubTick — Settings Screen (Redesigned)
// Clean grouped-card layout. Complex sub-sections are
// promoted to their own sub-screens.
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useNavigation } from '@react-navigation/native';
import { UserProfile, ThemeMode } from '../types';
import { auth, db } from '../services/firebase';
import { doc, setDoc } from 'firebase/firestore';
import {
  fetchUserProfile,
  linkGoogleAccount,
  unlinkGoogleAccount,
} from '../services/auth';
import {
  CATEGORIES,
  DASHBOARD_METRIC_DEFS,
  TEXT_XS,
  TEXT_SM,
  TEXT_BASE,
  TEXT_LG,
} from '../utils/constants';
import {
  ChevronLeft,
  ChevronRight,
  Link,
  Smartphone,
  Sun,
  Moon,
  Tag,
  BarChart3,
  MessageSquare,
  Rss,
  TerminalSquare,
} from 'lucide-react-native';

// ── Helper: count selected categories ───────────────────────
const getSelectedCategoryCount = (profile: UserProfile | null): number => {
  if (!profile) return 0;
  return profile.selectedCategoryIds.length;
};

// ── Helper: count active dashboard metrics ───────────────────
const getActiveMetricCount = (profile: UserProfile | null): number => {
  if (!profile) return 0;
  return (profile.dashboardMetricIds || []).length;
};

export default function SettingsScreen() {
  const { colors, mode, setThemeMode } = useTheme();
  const navigation = useNavigation<any>();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProfile();
  }, []);

  // Re-load profile when returning from a sub-screen so counts update
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      if (!loading) loadProfile();
    });
    return unsubscribe;
  }, [navigation, loading]);

  const loadProfile = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      const p = await fetchUserProfile(user.uid);
      setProfile(p);
    } catch (error) {
      console.error('[Settings] loadProfile error:', error);
    } finally {
      setLoading(false);
    }
  };

  // --- Theme Selection ---
  const handleThemeChange = (newMode: ThemeMode) => {
    setThemeMode(newMode);
    if (auth.currentUser) {
      const userRef = doc(db, 'users', auth.currentUser.uid);
      setDoc(userRef, { themePreference: newMode, lastUpdated: Date.now() }, { merge: true });
    }
  };

  // --- Google Account Linking ---
  const handleGoogleLink = async () => {
    try {
      if (profile?.linkedGoogleAccount) {
        await unlinkGoogleAccount();
        Alert.alert('Unlinked', 'Google account has been unlinked.');
        await loadProfile();
      } else {
        await linkGoogleAccount();
        Alert.alert('Linked', 'Google account linked successfully!');
        await loadProfile();
      }
    } catch (error: any) {
      const isUnsupportedEnv =
        error.code === 'auth/operation-not-supported-in-this-environment' ||
        error.message?.includes('not-supported');

      if (isUnsupportedEnv) {
        Alert.alert(
          'Not Available on Mobile',
          'Google account linking requires a web browser sign-in flow that is not yet supported in the mobile app. This feature is coming soon.'
        );
      } else {
        Alert.alert('Error', error.message || 'Something went wrong. Please try again.');
      }
    }
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const selectedCategoryCount = getSelectedCategoryCount(profile);
  const activeMetricCount = getActiveMetricCount(profile);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Page Header ─────────────────────────────────── */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ChevronLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Settings</Text>
        <View style={styles.backButton} />
      </View>

      {/* ══════════════════════════════════════════════════
          SECTION: ACCOUNT
      ══════════════════════════════════════════════════ */}
      <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>ACCOUNT</Text>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <TouchableOpacity
          style={styles.row}
          onPress={handleGoogleLink}
          activeOpacity={0.7}
        >
          <View style={styles.rowLeft}>
            <View style={[styles.iconWrap, { backgroundColor: colors.surfaceSecondary }]}>
              <Link size={16} color={colors.text} />
            </View>
            <Text style={[styles.rowLabel, { color: colors.text }]}>Link Google Account</Text>
          </View>
          <Text style={[styles.rowValue, { color: colors.textMuted }]}>
            {profile?.linkedGoogleAccount ? 'Connected' : 'Not Connected'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ══════════════════════════════════════════════════
          SECTION: PREFERENCES
      ══════════════════════════════════════════════════ */}
      <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>PREFERENCES</Text>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>

        {/* Theme — 3-segment control inside the card */}
        <View style={[styles.row, styles.rowNoBorder]}>
          <View style={styles.rowLeft}>
            <View style={[styles.iconWrap, { backgroundColor: colors.surfaceSecondary }]}>
              {mode === 'dark'
                ? <Moon size={16} color={colors.text} />
                : mode === 'light'
                  ? <Sun size={16} color={colors.text} />
                  : <Smartphone size={16} color={colors.text} />
              }
            </View>
            <Text style={[styles.rowLabel, { color: colors.text }]}>Theme</Text>
          </View>
          <View style={[styles.segmentControl, { backgroundColor: colors.surfaceSecondary }]}>
            {(['system', 'light', 'dark'] as ThemeMode[]).map((themeOption) => (
              <TouchableOpacity
                key={themeOption}
                style={[
                  styles.segment,
                  mode === themeOption && { backgroundColor: colors.background },
                ]}
                onPress={() => handleThemeChange(themeOption)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.segmentText,
                    { color: mode === themeOption ? colors.text : colors.textMuted },
                  ]}
                >
                  {themeOption === 'system' ? 'Auto' : themeOption === 'light' ? 'Light' : 'Dark'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        {/* Category Preferences → sub-screen */}
        <TouchableOpacity
          style={[styles.row, styles.rowNoBorder]}
          onPress={() => navigation.navigate('CategoryPreferences')}
          activeOpacity={0.7}
        >
          <View style={styles.rowLeft}>
            <View style={[styles.iconWrap, { backgroundColor: colors.surfaceSecondary }]}>
              <Tag size={16} color={colors.text} />
            </View>
            <Text style={[styles.rowLabel, { color: colors.text }]}>Category Preferences</Text>
          </View>
          <View style={styles.rowRight}>
            <Text style={[styles.rowValue, { color: colors.textMuted }]}>
              {selectedCategoryCount} Selected
            </Text>
            <ChevronRight size={16} color={colors.textMuted} />
          </View>
        </TouchableOpacity>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        {/* Dashboard Stats → sub-screen */}
        <TouchableOpacity
          style={[styles.row, styles.rowNoBorder]}
          onPress={() => navigation.navigate('DashboardStats')}
          activeOpacity={0.7}
        >
          <View style={styles.rowLeft}>
            <View style={[styles.iconWrap, { backgroundColor: colors.surfaceSecondary }]}>
              <BarChart3 size={16} color={colors.text} />
            </View>
            <Text style={[styles.rowLabel, { color: colors.text }]}>Dashboard Stats</Text>
          </View>
          <View style={styles.rowRight}>
            <Text style={[styles.rowValue, { color: colors.textMuted }]}>
              {activeMetricCount} Selected
            </Text>
            <ChevronRight size={16} color={colors.textMuted} />
          </View>
        </TouchableOpacity>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        {/* Include Archived Articles — toggle */}
        <View style={[styles.row, styles.rowNoBorder]}>
          <View style={styles.rowLeft}>
            <View style={[styles.iconWrap, { backgroundColor: colors.surfaceSecondary }]}>
              <Rss size={16} color={colors.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Archived Articles</Text>
              <Text style={[styles.rowHint, { color: colors.textMuted }]}>
                Load older articles from Substack directly
              </Text>
            </View>
          </View>
          <Switch
            value={profile?.includeArchivedArticles || false}
            onValueChange={async (value) => {
              if (!profile || !auth.currentUser) return;
              setProfile({ ...profile, includeArchivedArticles: value });
              const userRef = doc(db, 'users', auth.currentUser.uid);
              await setDoc(userRef, { includeArchivedArticles: value, lastUpdated: Date.now() }, { merge: true });
            }}
            trackColor={{ false: colors.surfaceSecondary, true: colors.primaryLight }}
            thumbColor={profile?.includeArchivedArticles ? colors.primary : colors.textMuted}
          />
        </View>
      </View>

      {/* ══════════════════════════════════════════════════
          SECTION: SUPPORT & FEEDBACK
      ══════════════════════════════════════════════════ */}
      <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>SUPPORT & FEEDBACK</Text>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>

        {/* Send Feedback */}
        <TouchableOpacity
          style={[styles.row, styles.rowNoBorder]}
          onPress={() => navigation.navigate('Feedback')}
          activeOpacity={0.7}
        >
          <View style={styles.rowLeft}>
            <View style={[styles.iconWrap, { backgroundColor: colors.surfaceSecondary }]}>
              <MessageSquare size={16} color={colors.text} />
            </View>
            <Text style={[styles.rowLabel, { color: colors.text }]}>Send Feedback</Text>
          </View>
          <ChevronRight size={16} color={colors.textMuted} />
        </TouchableOpacity>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        {/* Request a Feed */}
        <TouchableOpacity
          style={[styles.row, styles.rowNoBorder]}
          onPress={() => navigation.navigate('FeedRequest')}
          activeOpacity={0.7}
        >
          <View style={styles.rowLeft}>
            <View style={[styles.iconWrap, { backgroundColor: colors.surfaceSecondary }]}>
              <Rss size={16} color={colors.text} />
            </View>
            <Text style={[styles.rowLabel, { color: colors.text }]}>Request a Feed</Text>
          </View>
          <ChevronRight size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* ══════════════════════════════════════════════════
          SECTION: DEVELOPER
      ══════════════════════════════════════════════════ */}
      <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>DEVELOPER</Text>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.row, styles.rowNoBorder]}
          onPress={() => navigation.navigate('DeveloperOptions')}
          activeOpacity={0.7}
        >
          <View style={styles.rowLeft}>
            <View style={[styles.iconWrap, { backgroundColor: colors.surfaceSecondary }]}>
              <TerminalSquare size={16} color={colors.text} />
            </View>
            <Text style={[styles.rowLabel, { color: colors.text }]}>Developer Options</Text>
          </View>
          <ChevronRight size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* App Version */}
      <Text style={[styles.appInfo, { color: colors.textMuted }]}>
        Tangent v1.0.0 · Built with Expo & Firebase
      </Text>

      <View style={{ height: 48 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 28, paddingBottom: 64 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 64,
    paddingBottom: 24,
    borderBottomWidth: 1,
    marginBottom: 32,
    paddingHorizontal: 0,
  },
  backButton: { width: 40, alignItems: 'flex-start' },
  headerTitle: { fontSize: TEXT_LG, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },

  // Section label above each card group
  sectionLabel: {
    fontSize: TEXT_XS,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 10,
    marginLeft: 4,
  },

  // Card container
  card: {
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 28,
    overflow: 'hidden',
  },

  // Individual row inside a card
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowNoBorder: {
    // border handled by explicit divider below
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconWrap: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { fontSize: TEXT_BASE, fontWeight: '500' },
  rowValue: { fontSize: TEXT_SM },
  rowHint: { fontSize: TEXT_XS, marginTop: 2, lineHeight: 16 },

  divider: { height: 1, marginLeft: 60 },

  // 3-segment theme control
  segmentControl: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
    gap: 2,
  },
  segment: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  segmentText: { fontSize: TEXT_XS, fontWeight: '600' },

  appInfo: { textAlign: 'center', marginTop: 8, fontSize: TEXT_XS },
});

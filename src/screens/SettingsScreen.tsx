// ============================================================
// SubTick — Settings Screen
// Category weights, metric toggles, theme, feed requests.
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useNavigation } from '@react-navigation/native';
import { UserProfile, ThemeMode, FeedRequest } from '../types';
import { auth, db } from '../services/firebase';
import { doc, setDoc, getDoc, collection, addDoc } from 'firebase/firestore';
import {
  fetchUserProfile,
  updateCategoryWeights,
  linkGoogleAccount,
  unlinkGoogleAccount,
} from '../services/auth';
import {
  CATEGORIES,
  DASHBOARD_METRIC_DEFS,
  DEFAULT_SELECTED_WEIGHT,
  DEFAULT_NOT_INTERESTED_WEIGHT,
  DEFAULT_NEUTRAL_WEIGHT,
  MIN_CATEGORY_WEIGHT,
  MAX_CATEGORY_WEIGHT,
} from '../utils/constants';
import { validateFeedRequest } from '../utils/validation';

export default function SettingsScreen() {
  const { colors, mode, setThemeMode } = useTheme();
  const navigation = useNavigation<any>();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedUrl, setFeedUrl] = useState('');
  const [feedDescription, setFeedDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  const [showCategoryPrefs, setShowCategoryPrefs] = useState(false);
  const [showStats, setShowStats] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

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

  // --- Category Weight Adjustment ---
  const handleCategoryCycle = async (categoryId: string) => {
    if (!profile) return;
    const newWeights = { ...profile.categoryWeights };
    const newSelected = [...profile.selectedCategoryIds];
    const newNotInterested = [...profile.notInterestedCategoryIds];

    const isSelected = newSelected.includes(categoryId);
    const isNotInterested = newNotInterested.includes(categoryId);

    if (isSelected) {
      // Selected → Not Interested
      newSelected.splice(newSelected.indexOf(categoryId), 1);
      newNotInterested.push(categoryId);
      newWeights[categoryId] = DEFAULT_NOT_INTERESTED_WEIGHT;
    } else if (isNotInterested) {
      // Not Interested → Neutral
      newNotInterested.splice(newNotInterested.indexOf(categoryId), 1);
      newWeights[categoryId] = DEFAULT_NEUTRAL_WEIGHT;
    } else {
      // Neutral → Selected
      newSelected.push(categoryId);
      newWeights[categoryId] = DEFAULT_SELECTED_WEIGHT;
    }

    const updatedProfile = {
      ...profile,
      categoryWeights: newWeights,
      selectedCategoryIds: newSelected,
      notInterestedCategoryIds: newNotInterested,
    };
    setProfile(updatedProfile);

    if (auth.currentUser) {
      await updateCategoryWeights(
        auth.currentUser.uid,
        newWeights,
        newSelected,
        newNotInterested
      );
    }
  };

  const getCategoryState = (catId: string): 'selected' | 'not_interested' | 'neutral' => {
    if (!profile) return 'neutral';
    if (profile.selectedCategoryIds.includes(catId)) return 'selected';
    if (profile.notInterestedCategoryIds.includes(catId)) return 'not_interested';
    return 'neutral';
  };

  // --- Dashboard Metric Toggles ---
  const toggleMetric = async (metricId: string) => {
    if (!profile) return;
    const current = profile.dashboardMetricIds || [];
    let updated: string[];
    if (current.includes(metricId)) {
      updated = current.filter((id) => id !== metricId);
    } else {
      if (current.length >= 3) {
        Alert.alert('Limit Reached', 'You can display up to 3 metrics. Remove one first.');
        return;
      }
      updated = [...current, metricId];
    }
    const updatedProfile = { ...profile, dashboardMetricIds: updated };
    setProfile(updatedProfile);

    const userRef = doc(db, 'users', auth.currentUser!.uid);
    await setDoc(userRef, { dashboardMetricIds: updated, lastUpdated: Date.now() }, { merge: true });
  };

  // --- Theme Selection ---
  const handleThemeChange = (newMode: ThemeMode) => {
    setThemeMode(newMode);
    // Also persist to Firestore
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
      } else {
        await linkGoogleAccount();
        Alert.alert('Linked', 'Google account linked successfully!');
      }
      await loadProfile();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Something went wrong.');
    }
  };

  // --- Feed Request Submission ---
  const handleSubmitFeedRequest = async () => {
    const validation = validateFeedRequest(feedUrl, feedDescription);
    if (!validation.isValid) {
      Alert.alert('Invalid', validation.errorMessage);
      return;
    }

    setSubmitting(true);
    try {
      const request: Omit<FeedRequest, 'id'> = {
        userId: auth.currentUser!.uid,
        url: feedUrl.trim(),
        description: feedDescription.trim() || undefined,
        timestamp: Date.now(),
        status: 'pending',
      };
      await addDoc(collection(db, 'feed_requests'), request);
      Alert.alert('Submitted', 'Your feed request has been submitted for review!');
      setFeedUrl('');
      setFeedDescription('');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to submit request.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={[styles.closeText, { color: colors.primary }]}>← Close</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Settings</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Category Preferences */}
      <TouchableOpacity 
        style={styles.collapsibleHeader} 
        onPress={() => setShowCategoryPrefs(!showCategoryPrefs)}
        activeOpacity={0.7}
      >
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Category Preferences</Text>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>{showCategoryPrefs ? '▼' : '▶'}</Text>
      </TouchableOpacity>
      
      {showCategoryPrefs && (
        <View style={styles.collapsibleContent}>
          <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>
            Tap to cycle: Interested → Not Interested → Neutral
          </Text>
          <View style={styles.categoryGrid}>
            {CATEGORIES.map((cat) => {
              const state = getCategoryState(cat.id);
              const bgColor =
                state === 'selected'
                  ? colors.chipSelectedBg
                  : state === 'not_interested'
                    ? colors.chipNotInterestedBg
                    : colors.chipNeutralBg;
              const textColor =
                state === 'selected'
                  ? colors.chipSelectedText
                  : state === 'not_interested'
                    ? colors.chipNotInterestedText
                    : colors.chipNeutralText;

              return (
                <TouchableOpacity
                  key={cat.id}
                  style={[styles.categoryRow, { backgroundColor: bgColor, borderColor: colors.border }]}
                  onPress={() => handleCategoryCycle(cat.id)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.categoryEmoji}>{cat.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.categoryName, { color: textColor }]}>{cat.name}</Text>
                    <Text style={[styles.categoryWeight, { color: textColor }]}>
                      {state === 'selected' ? 'Interested' : state === 'not_interested' ? 'Not Interested' : 'Neutral'}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {/* Dashboard Metrics */}
      <TouchableOpacity 
        style={[styles.collapsibleHeader, { marginTop: 28 }]} 
        onPress={() => setShowStats(!showStats)}
        activeOpacity={0.7}
      >
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Stats</Text>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>{showStats ? '▼' : '▶'}</Text>
      </TouchableOpacity>
      
      {showStats && (
        <View style={styles.collapsibleContent}>
          <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>
            Choose up to 3 stats to display on your dashboard
          </Text>
          <View style={styles.metricsList}>
            {DASHBOARD_METRIC_DEFS.map((metric) => {
              const isSelected = (profile?.dashboardMetricIds || []).includes(metric.id);
              
              // Helper to map metric id to profile value
              let value: string | number = 0;
              if (profile) {
                switch(metric.id) {
                  case 'streak': value = profile.currentStreakDays; break;
                  case 'weeklyReads': value = profile.weeklyReadCount; break;
                  case 'topCategory':
                    let topCat = '—';
                    let topWeight = 0;
                    Object.entries(profile.categoryWeights).forEach(([cat, w]) => {
                      if (w > topWeight) { topWeight = w; topCat = cat; }
                    });
                    value = topCat.charAt(0).toUpperCase() + topCat.slice(1);
                    break;
                  case 'totalRead': value = profile.totalArticlesRead; break;
                  case 'avgWpm': value = profile.averageWpm; break;
                  case 'weeklyStreak': value = `${profile.weeklyReadCount} this week`; break;
                  case 'exploreScore': value = 'Active'; break;
                }
              }

              return (
                <View
                  key={metric.id}
                  style={[styles.metricRow, { borderBottomColor: colors.border }]}
                >
                  <Text style={[styles.metricLabel, { color: colors.text }]}>
                    {metric.emoji}  {metric.label}: <Text style={{fontWeight: '800'}}>{value}</Text> {isSelected ? '(Dashboard)' : ''}
                  </Text>
                  <Switch
                    value={isSelected}
                    onValueChange={() => toggleMetric(metric.id)}
                    trackColor={{ false: colors.surfaceSecondary, true: colors.primaryLight }}
                    thumbColor={isSelected ? colors.primary : colors.textMuted}
                  />
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* Lists */}
      <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 28, marginBottom: 12 }]}>Your Lists</Text>
      <TouchableOpacity
        style={[styles.linkButton, { backgroundColor: colors.surface, borderColor: colors.border, marginBottom: 12 }]}
        onPress={() => navigation.navigate('History')}
      >
        <Text style={[styles.linkButtonText, { color: colors.text }]}>📚 Reading History</Text>
        <Text style={[styles.linkStatus, { color: colors.textMuted }]}>View past reads</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.linkButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => navigation.navigate('SavedReads')}
      >
        <Text style={[styles.linkButtonText, { color: colors.text }]}>🔖 Saved Reads</Text>
        <Text style={[styles.linkStatus, { color: colors.textMuted }]}>View saved articles</Text>
      </TouchableOpacity>

      {/* Theme Selection */}
      <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 28 }]}>Theme</Text>
      <View style={styles.themeRow}>
        {(['system', 'light', 'dark'] as ThemeMode[]).map((themeOption) => (
          <TouchableOpacity
            key={themeOption}
            style={[
              styles.themeButton,
              {
                backgroundColor: mode === themeOption ? colors.primary : colors.surfaceSecondary,
                borderColor: mode === themeOption ? colors.primary : colors.border,
              },
            ]}
            onPress={() => handleThemeChange(themeOption)}
          >
            <Text
              style={[
                styles.themeButtonText,
                { color: mode === themeOption ? '#FFFFFF' : colors.text },
              ]}
            >
              {themeOption === 'system' ? '📱 System' : themeOption === 'light' ? '☀️ Light' : '🌙 Dark'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Account Linking */}
      <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 28 }]}>Account</Text>
      <TouchableOpacity
        style={[styles.linkButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={handleGoogleLink}
      >
        <Text style={[styles.linkButtonText, { color: colors.text }]}>
          {profile?.linkedGoogleAccount ? '🔗 Unlink Google Account' : '🔗 Link Google Account'}
        </Text>
        <Text style={[styles.linkStatus, { color: colors.textMuted }]}>
          {profile?.linkedGoogleAccount ? 'Connected' : 'Not connected'}
        </Text>
      </TouchableOpacity>

      {/* Developer Reset */}
      <TouchableOpacity
        style={[styles.linkButton, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, marginTop: 12 }]}
        onPress={async () => {
          Alert.alert(
            'Reset Local Data',
            'This will permanently wipe your reading history, saved articles, and behavior queue from this device. Are you sure?',
            [
              { text: 'Cancel', style: 'cancel' },
              { 
                text: 'Wipe Data', 
                style: 'destructive',
                onPress: async () => {
                  try {
                    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
                    await AsyncStorage.clear();
                    Alert.alert('Cleared', 'Local storage has been completely wiped.');
                  } catch (e) {
                    Alert.alert('Error', 'Failed to clear local storage.');
                  }
                }
              }
            ]
          );
        }}
      >
        <Text style={[styles.linkButtonText, { color: colors.error }]}>🗑️ Clear Local Data</Text>
        <Text style={[styles.linkStatus, { color: colors.textMuted }]}>Wipes History & Saves</Text>
      </TouchableOpacity>

      {/* Feed Request */}
      <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 28 }]}>Request a Feed</Text>
      <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>
        Submit a Substack URL you'd like us to add
      </Text>
      <TextInput
        style={[
          styles.input,
          { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
        ]}
        placeholder="https://example.substack.com/feed"
        placeholderTextColor={colors.textMuted}
        value={feedUrl}
        onChangeText={setFeedUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <TextInput
        style={[
          styles.input,
          { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
        ]}
        placeholder="Why do you recommend this? (optional)"
        placeholderTextColor={colors.textMuted}
        value={feedDescription}
        onChangeText={setFeedDescription}
        multiline
        numberOfLines={3}
      />
      <TouchableOpacity
        style={[styles.submitButton, { backgroundColor: colors.primary, opacity: submitting ? 0.6 : 1 }]}
        onPress={handleSubmitFeedRequest}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.submitButtonText}>Submit Request →</Text>
        )}
      </TouchableOpacity>

      {/* App Info */}
      <Text style={[styles.appInfo, { color: colors.textMuted }]}>
        SubTick v1.0.0 · Built with Expo & Firebase
      </Text>
      <View style={{ height: 48 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 48,
    marginBottom: 24,
  },
  closeText: { fontSize: 16, fontWeight: '600' },
  headerTitle: { fontSize: 20, fontWeight: '800' },
  collapsibleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  collapsibleContent: { marginTop: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  sectionSubtitle: { fontSize: 13, marginBottom: 14, lineHeight: 18 },
  categoryGrid: { gap: 8 },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  categoryEmoji: { fontSize: 24, marginRight: 12 },
  categoryName: { fontSize: 15, fontWeight: '700' },
  categoryWeight: { fontSize: 12, marginTop: 2 },
  metricsList: { marginTop: 4 },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  metricLabel: { fontSize: 15, fontWeight: '500' },
  themeRow: { flexDirection: 'row', gap: 10 },
  themeButton: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
  },
  themeButtonText: { fontSize: 14, fontWeight: '600' },
  linkButton: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  linkButtonText: { fontSize: 15, fontWeight: '600' },
  linkStatus: { fontSize: 13 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    marginBottom: 12,
  },
  submitButton: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  submitButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  appInfo: { textAlign: 'center', marginTop: 32, fontSize: 12 },
});
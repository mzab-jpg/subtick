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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useNavigation } from '@react-navigation/native';
import { UserProfile, ThemeMode, FeedRequest, Article } from '../types';
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
import { fetchAndExtractArticle } from '../services/feedService';
import { XMLParser } from 'fast-xml-parser';
import { 
  ChevronLeft, 
  ChevronDown, 
  ChevronRight, 
  Check, 
  X, 
  Minus, 
  BookOpen, 
  Bookmark,
  Link,
  Trash2,
  Smartphone,
  Sun,
  Moon,
  Zap,
  Clock,
  BarChart3,
  TerminalSquare
} from 'lucide-react-native';

export default function SettingsScreen() {
  const { colors, mode, setThemeMode } = useTheme();
  const navigation = useNavigation<any>();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedUrl, setFeedUrl] = useState('');
  const [feedDescription, setFeedDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  const [devSandboxUrl, setDevSandboxUrl] = useState('');
  const [testingDevSandbox, setTestingDevSandbox] = useState(false);

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
    if (!profile || !auth.currentUser) return;

    const previousProfile = profile; // snapshot for revert on failure
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
    // Optimistically update UI
    setProfile(updatedProfile);

    try {
      await updateCategoryWeights(
        auth.currentUser.uid,
        newWeights,
        newSelected,
        newNotInterested
      );
    } catch (error) {
      console.error('[Settings] handleCategoryCycle save failed:', error);
      // Revert UI to previous state so user knows their change didn't save
      setProfile(previousProfile);
      Alert.alert('Save Failed', 'Could not save your preference. Please check your connection and try again.');
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
    // Note: linkWithPopup is a web-only API. On iOS/Android it will throw
    // "auth/operation-not-supported-in-this-environment". Until native Google
    // sign-in is implemented (requires expo-auth-session or @react-native-google-signin),
    // we show a clear, actionable message instead of a raw technical error.
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

  // --- Developer Sandbox ---
  const handleDevSandboxTest = async () => {
    const url = devSandboxUrl.trim();
    if (!url) return;
    
    setTestingDevSandbox(true);
    try {
      // Improved RSS detection: checks for common feed URL patterns including
      // Substack feeds (/feed), RSS files (.xml, .rss), Atom feeds, and
      // query-string based feeds (feed=rss, format=feed, etc.)
      const urlLower = url.toLowerCase();
      const isRss =
        urlLower.includes('/feed') ||
        urlLower.includes('.xml') ||
        urlLower.includes('.rss') ||
        urlLower.includes('/rss') ||
        urlLower.includes('/atom') ||
        urlLower.includes('feed=rss') ||
        urlLower.includes('format=feed') ||
        urlLower.includes('type=rss');

      const mockArticle: Article = {
        id: 'test_sandbox_123',
        title: 'Developer Sandbox Test',
        author: 'Tester',
        publicationName: 'Sandbox Publication',
        publicationUrl: url,
        feedUrl: isRss ? url : '',
        category: 'Technology & Innovation',
        lengthStyle: 'medium',
        publishDate: Date.now(),
        cacheTimestamp: Date.now(),
        isPaywalled: false,
        estimatedReadMinutes: 5,
        trendingScore: 0,
        qualityScore: 1,
        isSeed: false,
        rssStatus: isRss ? 'current' : 'archived',
      };

      if (isRss) {
        // Test parsing the RSS and sanitize HTML
        const response = await fetch(url);
        const xmlText = await response.text();
        const parser = new XMLParser({ ignoreAttributes: false });
        const parsed = parser.parse(xmlText);
        const channel = parsed?.rss?.channel || parsed?.feed;
        let items = channel?.item || channel?.entry || [];
        if (!Array.isArray(items)) items = [items];
        
        if (items.length === 0) throw new Error('No items found in RSS feed');
        
        const firstItem = items[0];
        const guid = firstItem.guid?.['#text'] || firstItem.guid || firstItem.link || '';
        
        // Pass to standard fetcher which extracts and sanitizes
        const sanitizedHtml = await fetchAndExtractArticle(url, guid);
        
        mockArticle.title = firstItem.title || 'Untitled Sandbox RSS';
        mockArticle.publicationUrl = firstItem.link || url;

        navigation.navigate('Reader', { articleId: 'test_sandbox_123', mockArticle, mockHtml: sanitizedHtml });
      } else {
        // Direct URL test (Archived mode raw webview)
        navigation.navigate('Reader', { articleId: 'test_sandbox_123', mockArticle });
      }
    } catch (error: any) {
      Alert.alert('Sandbox Error', error.message || 'Failed to load test URL');
    } finally {
      setTestingDevSandbox(false);
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

  const getMetricIcon = (id: string, color: string) => {
    switch (id) {
      case 'streak': return <Zap size={16} color={color} />;
      case 'weeklyReads': return <BookOpen size={16} color={color} />;
      case 'totalReadTime': return <Clock size={16} color={color} />;
      default: return <BarChart3 size={16} color={color} />;
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={{ flex: 1 }}
    >
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ChevronLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Settings</Text>
        <View style={styles.backButton} />
      </View>

      {/* Category Preferences */}
      <TouchableOpacity 
        style={styles.collapsibleHeader} 
        onPress={() => setShowCategoryPrefs(!showCategoryPrefs)}
        activeOpacity={0.7}
      >
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Category Preferences</Text>
        {showCategoryPrefs ? <ChevronDown size={20} color={colors.textMuted} /> : <ChevronRight size={20} color={colors.textMuted} />}
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

              const IconComp = state === 'selected' ? Check : state === 'not_interested' ? X : Minus;

              return (
                <TouchableOpacity
                  key={cat.id}
                  style={[styles.categoryRow, { backgroundColor: bgColor, borderColor: colors.border }]}
                  onPress={() => handleCategoryCycle(cat.id)}
                  activeOpacity={0.7}
                >
                  <IconComp size={20} color={textColor} style={{ marginRight: 16 }} />
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
        style={[styles.collapsibleHeader, { marginTop: 32 }]} 
        onPress={() => setShowStats(!showStats)}
        activeOpacity={0.7}
      >
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Dashboard Stats</Text>
        {showStats ? <ChevronDown size={20} color={colors.textMuted} /> : <ChevronRight size={20} color={colors.textMuted} />}
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
                    // Skip composite keys like "Technology::long" and "pub::Stratechery"
                    Object.entries(profile.categoryWeights).forEach(([cat, w]) => {
                      if (!cat.includes('::') && !cat.startsWith('pub::') && w > topWeight) {
                        topWeight = w;
                        topCat = cat;
                      }
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
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    {getMetricIcon(metric.id, colors.textMuted)}
                    <View style={{ marginLeft: 16 }}>
                      <Text style={[styles.metricLabel, { color: colors.text }]}>
                        {metric.label}
                      </Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 4 }}>
                        {value} {isSelected ? '• Showing on Dashboard' : ''}
                      </Text>
                    </View>
                  </View>
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
      <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 32, marginBottom: 16 }]}>Your Lists</Text>
      <TouchableOpacity
        style={[styles.linkButton, { backgroundColor: colors.surface, borderColor: colors.border, marginBottom: 16 }]}
        onPress={() => navigation.navigate('History')}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <BookOpen size={20} color={colors.text} style={{ marginRight: 16 }} />
          <Text style={[styles.linkButtonText, { color: colors.text }]}>Reading History</Text>
        </View>
        <ChevronRight size={20} color={colors.textMuted} />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.linkButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => navigation.navigate('SavedReads')}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Bookmark size={20} color={colors.text} style={{ marginRight: 16 }} />
          <Text style={[styles.linkButtonText, { color: colors.text }]}>Saved Reads</Text>
        </View>
        <ChevronRight size={20} color={colors.textMuted} />
      </TouchableOpacity>

      {/* Article Sources */}
      <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 40 }]}>Article Sources</Text>
      <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>
        Archived articles are older stories that are no longer available in standard RSS feeds. They will load the full Substack webpage directly inside the app.
      </Text>
      <View style={[styles.metricRow, { borderBottomColor: colors.border, borderBottomWidth: 0 }]}>
        <Text style={[styles.metricLabel, { color: colors.text, flex: 1, paddingRight: 16 }]}>
          Include Archived Articles
        </Text>
        <Switch
          value={profile?.includeArchivedArticles || false}
          onValueChange={async (value) => {
            if (!profile || !auth.currentUser) return;
            const updatedProfile = { ...profile, includeArchivedArticles: value };
            setProfile(updatedProfile);
            const userRef = doc(db, 'users', auth.currentUser.uid);
            await setDoc(userRef, { includeArchivedArticles: value, lastUpdated: Date.now() }, { merge: true });
          }}
          trackColor={{ false: colors.surfaceSecondary, true: colors.primaryLight }}
          thumbColor={profile?.includeArchivedArticles ? colors.primary : colors.textMuted}
        />
      </View>

      {/* Theme Selection */}
      <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 40 }]}>Theme</Text>
      <View style={styles.themeRow}>
        {(['system', 'light', 'dark'] as ThemeMode[]).map((themeOption) => {
          const ThemeIcon = themeOption === 'system' ? Smartphone : themeOption === 'light' ? Sun : Moon;
          return (
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
              <ThemeIcon size={18} color={mode === themeOption ? colors.background : colors.text} style={{ marginBottom: 8 }} />
              <Text
                style={[
                  styles.themeButtonText,
                  { color: mode === themeOption ? colors.background : colors.text },
                ]}
              >
                {themeOption === 'system' ? 'System' : themeOption === 'light' ? 'Light' : 'Dark'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Account Linking */}
      <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 40 }]}>Account</Text>
      <TouchableOpacity
        style={[styles.linkButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={handleGoogleLink}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Link size={20} color={colors.text} style={{ marginRight: 16 }} />
          <Text style={[styles.linkButtonText, { color: colors.text }]}>
            {profile?.linkedGoogleAccount ? 'Unlink Google Account' : 'Link Google Account'}
          </Text>
        </View>
        <Text style={[styles.linkStatus, { color: colors.textMuted }]}>
          {profile?.linkedGoogleAccount ? 'Connected' : 'Not connected'}
        </Text>
      </TouchableOpacity>

      {/* Developer Settings Header */}
      <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 48, marginBottom: 8 }]}>Developer Settings</Text>
      <View style={{ height: 1, backgroundColor: colors.border, marginBottom: 24 }} />

      {/* Developer Reset */}
      <TouchableOpacity
        style={[styles.linkButton, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
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
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Trash2 size={20} color={colors.error} style={{ marginRight: 16 }} />
          <Text style={[styles.linkButtonText, { color: colors.error }]}>Clear Local Data</Text>
        </View>
      </TouchableOpacity>

      {/* Developer Sandbox */}
      <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 32 }]}>Sandbox Reader</Text>
      <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>
        Instantly test how any Substack URL or RSS Feed renders in the Reader.
      </Text>
      <TextInput
        style={[
          styles.input,
          { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
        ]}
        placeholder="https://kyla.substack.com/p/..."
        placeholderTextColor={colors.textMuted}
        value={devSandboxUrl}
        onChangeText={setDevSandboxUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <TouchableOpacity
        style={[styles.submitButton, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, flexDirection: 'row' }]}
        onPress={handleDevSandboxTest}
        disabled={testingDevSandbox}
      >
        {testingDevSandbox ? (
          <ActivityIndicator color={colors.text} style={{ marginRight: 8 }} />
        ) : (
          <TerminalSquare size={18} color={colors.text} style={{ marginRight: 8 }} />
        )}
        <Text style={[styles.submitButtonText, { color: colors.text }]}>Test URL in Reader</Text>
      </TouchableOpacity>

      {/* Feed Request */}
      <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 40 }]}>Request a Feed</Text>
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
          <ActivityIndicator color={colors.background} />
        ) : (
          <Text style={[styles.submitButtonText, { color: colors.background }]}>Submit Request</Text>
        )}
      </TouchableOpacity>

      {/* App Info */}
      <Text style={[styles.appInfo, { color: colors.textMuted }]}>
        SubTick v1.0.0 · Built with Expo & Firebase
      </Text>
      <View style={{ height: 48 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 24, paddingBottom: 64 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 64,
    paddingBottom: 24,
    borderBottomWidth: 1,
    marginBottom: 32,
  },
  backButton: { width: 40, alignItems: 'flex-start' },
  headerTitle: { fontSize: 18, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  collapsibleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  collapsibleContent: { marginTop: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  sectionSubtitle: { fontSize: 14, marginBottom: 16, lineHeight: 20 },
  categoryGrid: { gap: 8 },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  categoryName: { fontSize: 16, fontWeight: '600' },
  categoryWeight: { fontSize: 14, marginTop: 4 },
  metricsList: { marginTop: 8 },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  metricLabel: { fontSize: 16, fontWeight: '600' },
  themeRow: { flexDirection: 'row', gap: 16 },
  themeButton: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  themeButtonText: { fontSize: 14, fontWeight: '600' },
  linkButton: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  linkButtonText: { fontSize: 16, fontWeight: '600' },
  linkStatus: { fontSize: 14 },
  input: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    fontSize: 16,
    marginBottom: 16,
  },
  submitButton: {
    padding: 16,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  submitButtonText: { fontSize: 16, fontWeight: '700' },
  appInfo: { textAlign: 'center', marginTop: 48, fontSize: 12 },
});

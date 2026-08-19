// ============================================================
// SubTick — Onboarding Screen
// Grouped list, lucide icons, colour-coded state rows.
// Users may select interests, mark dislikes, or skip for a broad first feed.
// ============================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { auth } from '../services/firebase';
import { completeOnboarding } from '../services/auth';
import { getRankedFeed, getSeenArticleIdsLocally } from '../services/feedService';
import { stageDashboardFeedForNextLaunch } from '../services/dashboardFeedCache';
import { requestInitialDashboardFeed } from '../services/initialDashboardFeed';
import { CategoryChipGrid, type ChipState } from '../components/CategoryChipGrid';
import {
  TEXT_XS,
  TEXT_SM,
  TEXT_BASE,
  TEXT_LG,
  TEXT_2XL,
} from '../utils/constants';

type OnboardingNavProp = StackNavigationProp<RootStackParamList, 'Onboarding'>;

export default function OnboardingScreen() {
  const navigation = useNavigation<OnboardingNavProp>();
  const { colors } = useTheme();
  const [chipStates, setChipStates] = useState<Record<string, ChipState>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const toggleChip = (categoryId: string) => {
    setChipStates((prev) => {
      const current = prev[categoryId] || 'neutral';
      const next: ChipState =
        current === 'neutral'
          ? 'selected'
          : current === 'selected'
            ? 'not_interested'
            : 'neutral';
      return { ...prev, [categoryId]: next };
    });
  };

  const selectedIds = Object.entries(chipStates)
    .filter(([_, state]) => state === 'selected')
    .map(([id]) => id);

  const notInterestedIds = Object.entries(chipStates)
    .filter(([_, state]) => state === 'not_interested')
    .map(([id]) => id);

  const hasMadeSelection = selectedIds.length > 0 || notInterestedIds.length > 0;

  const handleContinue = async () => {
    const userId = auth.currentUser?.uid;
    if (!userId || saving) return;

    try {
      const startedAt = Date.now();
      if (__DEV__) console.log('[Onboarding Timing] category save started');
      setSaving(true);
      setSaveError(null);
      await completeOnboarding(userId, selectedIds, notInterestedIds);
      if (__DEV__) console.log(`[Onboarding Timing] category save confirmed in ${Date.now() - startedAt}ms`);
      // The save is committed, so ranking can begin immediately while Dashboard
      // mounts; it does not wait for the profile listener to echo these choices.
      void (async () => {
        try {
          if (__DEV__) console.log('[Startup Timing] first ranked feed requested after onboarding save');
          const result = await requestInitialDashboardFeed(userId, async () => {
            const seenIds = await getSeenArticleIdsLocally();
            return getRankedFeed(seenIds);
          });
          if (result.articles.length > 0) stageDashboardFeedForNextLaunch(userId, result.articles, []);
          if (__DEV__) console.log(`[Startup Timing] onboarding ranked feed returned in ${Date.now() - startedAt}ms (${result.articles.length} articles)`);
        } catch {
          // Dashboard uses its normal request path if this early request fails.
        }
      })();
      if (__DEV__) console.log(`[Onboarding Timing] navigating to Dashboard at ${Date.now() - startedAt}ms`);
      navigation.replace('Dashboard');
    } catch (error) {
      console.error('[Onboarding] Failed to save selections:', error);
      setSaveError('Could not save your choices. Please check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Welcome to Tangent</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>Begin personalisation</Text>
        </View>

        {/* Shared category chip grid */}
        <CategoryChipGrid colors={colors} chipStates={chipStates} onToggle={toggleChip} />

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Sticky Continue Button */}
      <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
        {saveError && <Text style={[styles.saveError, { color: colors.error }]}>{saveError}</Text>}
        <TouchableOpacity
          style={[
            styles.continueButton,
            { backgroundColor: hasMadeSelection ? colors.primary : colors.surfaceSecondary },
            saving && styles.continueButtonDisabled,
          ]}
          onPress={handleContinue}
          disabled={saving}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.continueText,
              { color: hasMadeSelection ? colors.background : colors.textMuted },
            ]}
          >
            {saving ? 'Saving…' : hasMadeSelection ? 'Start Reading →' : 'Skip selection'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 28, paddingBottom: 48 },
  header: { marginTop: 64, marginBottom: 24 },
  title: { fontSize: TEXT_2XL, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: TEXT_SM, marginTop: 4 },

  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 28,
    paddingBottom: 40,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  continueButton: {
    padding: 16,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueText: { fontSize: TEXT_BASE, fontWeight: '700' },
  continueButtonDisabled: { opacity: 0.7 },
  saveError: { fontSize: TEXT_SM, textAlign: 'center', lineHeight: 18, marginBottom: 10 },
});
// ============================================================
// SubTick — Onboarding Screen
// Category chip grid with 3-state toggle (Selected / Not Interested / Neutral).
// Requires ≥3 Selected categories to proceed.
// ============================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { CATEGORIES, DEFAULT_SELECTED_WEIGHT, DEFAULT_NOT_INTERESTED_WEIGHT, DEFAULT_NEUTRAL_WEIGHT } from '../utils/constants';
import { validateOnboardingSelection } from '../utils/validation';
import { CategoryDefinition } from '../types';

type ChipState = 'selected' | 'not_interested' | 'neutral';

export default function OnboardingScreen({ navigation }: any) {
  const { colors } = useTheme();
  const [chipStates, setChipStates] = useState<Record<string, ChipState>>({});

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

  const getChipStyle = (catId: string) => {
    const state = chipStates[catId] || 'neutral';
    switch (state) {
      case 'selected':
        return { backgroundColor: colors.chipSelectedBg, borderColor: colors.primary };
      case 'not_interested':
        return { backgroundColor: colors.chipNotInterestedBg, borderColor: colors.error };
      default:
        return { backgroundColor: colors.chipNeutralBg, borderColor: colors.border };
    }
  };

  const getChipTextStyle = (catId: string) => {
    const state = chipStates[catId] || 'neutral';
    switch (state) {
      case 'selected':
        return { color: colors.chipSelectedText };
      case 'not_interested':
        return { color: colors.chipNotInterestedText };
      default:
        return { color: colors.chipNeutralText };
    }
  };

  const getChipLabel = (catId: string) => {
    const state = chipStates[catId] || 'neutral';
    switch (state) {
      case 'selected':
        return '✓ Interested';
      case 'not_interested':
        return '✗ Not Interested';
      default:
        return 'Neutral';
    }
  };

  const selectedIds = Object.entries(chipStates)
    .filter(([_, state]) => state === 'selected')
    .map(([id]) => id);

  const notInterestedIds = Object.entries(chipStates)
    .filter(([_, state]) => state === 'not_interested')
    .map(([id]) => id);

  const handleContinue = () => {
    const validation = validateOnboardingSelection(selectedIds);
    if (!validation.isValid) {
      Alert.alert('Almost there!', validation.errorMessage);
      return;
    }
    // Navigate to Dashboard, passing onboarding selections
    navigation.replace('Dashboard', {
      onboardingSelections: {
        selectedCategoryIds: selectedIds,
        notInterestedCategoryIds: notInterestedIds,
      },
    });
  };

  const progress = selectedIds.length / 3; // 3 minimum → 100%

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Welcome to SubTick</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          TikTok for reading. Pick at least 3 topics you're interested in, and we'll build your
          personalized feed.
        </Text>
      </View>

      {/* Progress indicator */}
      <View style={styles.progressRow}>
        <Text style={[styles.progressLabel, { color: colors.textMuted }]}>
          {selectedIds.length}/3 minimum selected
        </Text>
        <View style={[styles.progressBarBg, { backgroundColor: colors.progressBarBackground }]}>
          <View
            style={[
              styles.progressBarFill,
              {
                backgroundColor: selectedIds.length >= 3 ? colors.success : colors.primary,
                width: `${Math.min(progress * 100, 100)}%`,
              },
            ]}
          />
        </View>
      </View>

      {/* Category Chips */}
      <View style={styles.chipGrid}>
        {CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat.id}
            style={[styles.chip, getChipStyle(cat.id)]}
            onPress={() => toggleChip(cat.id)}
            activeOpacity={0.7}
          >
            <Text style={styles.chipEmoji}>{cat.emoji}</Text>
            <View style={styles.chipTextContainer}>
              <Text style={[styles.chipName, getChipTextStyle(cat.id)]}>{cat.name}</Text>
              <Text style={[styles.chipDesc, { color: colors.textMuted }]} numberOfLines={2}>
                {cat.description}
              </Text>
              <Text style={[styles.chipStateLabel, getChipTextStyle(cat.id)]}>
                {getChipLabel(cat.id)}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {/* Continue Button */}
      <TouchableOpacity
        style={[
          styles.continueButton,
          {
            backgroundColor: selectedIds.length >= 3 ? colors.primary : colors.surfaceSecondary,
          },
        ]}
        onPress={handleContinue}
        activeOpacity={0.8}
      >
        <Text
          style={[
            styles.continueText,
            { color: selectedIds.length >= 3 ? '#FFFFFF' : colors.textMuted },
          ]}
        >
          {selectedIds.length >= 3
            ? 'Start Reading →'
            : `Select ${3 - selectedIds.length} more categor${3 - selectedIds.length === 1 ? 'y' : 'ies'}`}
        </Text>
      </TouchableOpacity>

      <Text style={[styles.footerText, { color: colors.textMuted }]}>
        Tap a chip to cycle: Neutral → Interested → Not Interested. Weights can be adjusted later
        in Settings.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 24, paddingBottom: 48 },
  header: { marginBottom: 24, marginTop: 60 },
  title: { fontSize: 32, fontWeight: '800', marginBottom: 12 },
  subtitle: { fontSize: 16, lineHeight: 24 },
  progressRow: { marginBottom: 24 },
  progressLabel: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  progressBarBg: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressBarFill: { height: '100%', borderRadius: 3 },
  chipGrid: { gap: 12 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 2,
    marginBottom: 8,
  },
  chipEmoji: { fontSize: 28, marginRight: 14 },
  chipTextContainer: { flex: 1 },
  chipName: { fontSize: 17, fontWeight: '700', marginBottom: 2 },
  chipDesc: { fontSize: 13, lineHeight: 18, marginBottom: 4 },
  chipStateLabel: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  continueButton: {
    padding: 18,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 32,
    marginBottom: 16,
  },
  continueText: { fontSize: 18, fontWeight: '700' },
  footerText: { textAlign: 'center', fontSize: 13, lineHeight: 20 },
});
// ============================================================
// SubTick — Onboarding Screen
// Grouped list, lucide icons, colour-coded state rows.
// Requires ≥1 Selected category to proceed.
// ============================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import {
  CATEGORIES,
  TEXT_XS,
  TEXT_SM,
  TEXT_BASE,
  TEXT_LG,
  TEXT_2XL,
} from '../utils/constants';
import {
  Landmark,          // Politics
  Briefcase,         // Business
  TrendingUp,        // Finance
  Cpu,               // Technology
  FlaskConical,      // Science
  BookOpen,          // History
  Palette,           // Culture
  Leaf,              // Lifestyle
  Clapperboard,      // Entertainment
} from 'lucide-react-native';
import { LucideIcon } from 'lucide-react-native';

type ChipState = 'selected' | 'not_interested' | 'neutral';

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Politics: Landmark,
  Business: Briefcase,
  Finance: TrendingUp,
  Technology: Cpu,
  Science: FlaskConical,
  History: BookOpen,
  Culture: Palette,
  Lifestyle: Leaf,
  Entertainment: Clapperboard,
};

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

  const selectedIds = Object.entries(chipStates)
    .filter(([_, state]) => state === 'selected')
    .map(([id]) => id);

  const notInterestedIds = Object.entries(chipStates)
    .filter(([_, state]) => state === 'not_interested')
    .map(([id]) => id);

  const hasMadeSelection = selectedIds.length > 0 || notInterestedIds.length > 0;

  const handleContinue = () => {
    navigation.replace('Dashboard', {
      onboardingSelections: {
        selectedCategoryIds: selectedIds,
        notInterestedCategoryIds: notInterestedIds,
      },
    });
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

        {/* Category list — single grouped container matching CategoryPreferencesScreen */}
        <View style={[styles.group, { borderColor: colors.border }]}>
          {CATEGORIES.map((cat, index) => {
            const state = chipStates[cat.id] || 'neutral';
            const isLast = index === CATEGORIES.length - 1;

            const bgColor =
              state === 'selected'
                ? colors.chipSelectedBg
                : state === 'not_interested'
                  ? colors.chipNotInterestedBg
                  : colors.background;

            const textColor =
              state === 'selected'
                ? colors.chipSelectedText
                : state === 'not_interested'
                  ? colors.chipNotInterestedText
                  : colors.text;

            const mutedColor =
              state === 'selected'
                ? colors.chipSelectedText
                : state === 'not_interested'
                  ? colors.chipNotInterestedText
                  : colors.textMuted;

            const stateLabel =
              state === 'selected' ? 'Interested'
              : state === 'not_interested' ? 'Not Interested'
              : 'Neutral';

            const CategoryIcon = CATEGORY_ICONS[cat.id];

            return (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.row,
                  { backgroundColor: bgColor },
                  !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border },
                ]}
                onPress={() => toggleChip(cat.id)}
                activeOpacity={0.7}
              >
                {CategoryIcon && (
                  <CategoryIcon size={20} color={mutedColor} style={styles.rowIcon} />
                )}
                <View style={styles.rowContent}>
                  <Text style={[styles.catName, { color: textColor }]}>{cat.name}</Text>
                  <Text style={[styles.catState, { color: mutedColor }]}>{stateLabel}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Sticky Continue Button */}
      <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[
            styles.continueButton,
            { backgroundColor: hasMadeSelection ? colors.primary : colors.surfaceSecondary },
          ]}
          onPress={handleContinue}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.continueText,
              { color: hasMadeSelection ? colors.background : colors.textMuted },
            ]}
          >
            {hasMadeSelection ? 'Start Reading →' : 'Skip selection'}
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

  group: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  rowIcon: { marginRight: 14 },
  rowContent: { flex: 1 },
  catName: { fontSize: TEXT_BASE, fontWeight: '600' },
  catState: { fontSize: TEXT_SM, marginTop: 3 },

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
});

// ============================================================
// SubTick — Category Chip Grid
// Shared 3-state category selector used by Onboarding and
// CategoryPreferences screens. Renders a grouped list of
// category rows with icons, names, and state labels.
// ============================================================

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { ThemeColors } from '../types';
import { CATEGORIES, TEXT_SM, TEXT_BASE } from '../utils/constants';
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

export type ChipState = 'selected' | 'not_interested' | 'neutral';

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
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

interface CategoryChipGridProps {
  colors: ThemeColors;
  chipStates: Record<string, ChipState>;
  onToggle: (categoryId: string) => void;
}

export function CategoryChipGrid({ colors, chipStates, onToggle }: CategoryChipGridProps) {
  return (
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
            onPress={() => onToggle(cat.id)}
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
  );
}

const styles = StyleSheet.create({
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
});
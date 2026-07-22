// ============================================================
// SubTick — Category Preferences Screen
// Single grouped list container, dividers, bare icons, auto-save.
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useNavigation } from '@react-navigation/native';
import { UserProfile } from '../types';
import { auth } from '../services/firebase';
import {
  fetchUserProfile,
  updateCategoryWeights,
} from '../services/auth';
import {
  CATEGORIES,
  DEFAULT_SELECTED_WEIGHT,
  DEFAULT_NOT_INTERESTED_WEIGHT,
  DEFAULT_NEUTRAL_WEIGHT,
  TEXT_SM,
  TEXT_BASE,
  TEXT_LG,
} from '../utils/constants';
import {
  ChevronLeft,
  Cpu,
  TrendingUp,
  Globe,
  Palette,
  FlaskConical,
  Brain,
} from 'lucide-react-native';
import { LucideIcon } from 'lucide-react-native';

type CategoryState = 'selected' | 'not_interested' | 'neutral';

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  'Technology & Innovation': Cpu,
  'Business & Finance': TrendingUp,
  'Politics & Global Affairs': Globe,
  'Arts & Culture': Palette,
  'Science & Health': FlaskConical,
  'Philosophy & Human Behavior': Brain,
};

export default function CategoryPreferencesScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [notInterestedIds, setNotInterestedIds] = useState<string[]>([]);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      const p = await fetchUserProfile(user.uid);
      setProfile(p);
      if (p) {
        setSelectedIds([...p.selectedCategoryIds]);
        setNotInterestedIds([...p.notInterestedCategoryIds]);
      }
    } catch (error) {
      console.error('[CategoryPreferences] loadProfile error:', error);
    } finally {
      setLoading(false);
    }
  };

  const getCategoryState = (catId: string): CategoryState => {
    if (selectedIds.includes(catId)) return 'selected';
    if (notInterestedIds.includes(catId)) return 'not_interested';
    return 'neutral';
  };

  const handleTap = async (categoryId: string) => {
    if (!profile || !auth.currentUser) return;

    const state = getCategoryState(categoryId);

    const newSelected = selectedIds.filter((id) => id !== categoryId);
    const newNotInterested = notInterestedIds.filter((id) => id !== categoryId);

    if (state === 'neutral') {
      newSelected.push(categoryId);
    } else if (state === 'selected') {
      newNotInterested.push(categoryId);
    }

    const prevSelected = selectedIds;
    const prevNotInterested = notInterestedIds;
    const prevProfile = profile;

    setSelectedIds(newSelected);
    setNotInterestedIds(newNotInterested);

    const nextState: CategoryState =
      state === 'neutral' ? 'selected'
      : state === 'selected' ? 'not_interested'
      : 'neutral';

    const newWeights = { ...profile.categoryWeights };
    newWeights[categoryId] =
      nextState === 'selected' ? DEFAULT_SELECTED_WEIGHT
      : nextState === 'not_interested' ? DEFAULT_NOT_INTERESTED_WEIGHT
      : DEFAULT_NEUTRAL_WEIGHT;

    setProfile({
      ...profile,
      categoryWeights: newWeights,
      selectedCategoryIds: newSelected,
      notInterestedCategoryIds: newNotInterested,
    });

    try {
      await updateCategoryWeights(
        auth.currentUser.uid,
        newWeights,
        newSelected,
        newNotInterested
      );
    } catch (error) {
      console.error('[CategoryPreferences] auto-save error:', error);
      setSelectedIds(prevSelected);
      setNotInterestedIds(prevNotInterested);
      setProfile(prevProfile);
      Alert.alert('Save Failed', 'Could not save your preference. Please check your connection and try again.');
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
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ChevronLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Category Preferences</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Single grouped container — rows separated by dividers */}
        <View style={[styles.group, { borderColor: colors.border }]}>
          {CATEGORIES.map((cat, index) => {
            const state = getCategoryState(cat.id);
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
                onPress={() => handleTap(cat.id)}
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

        <View style={{ height: 48 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 64,
    paddingBottom: 20,
    paddingHorizontal: 28,
    borderBottomWidth: 1,
  },
  backButton: { width: 40, alignItems: 'flex-start' },
  headerTitle: { fontSize: TEXT_LG, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  scrollContent: { paddingHorizontal: 28, paddingTop: 28 },

  // Single container wrapping all rows
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

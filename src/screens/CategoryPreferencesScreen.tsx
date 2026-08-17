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
import { topInset } from '../utils/safeArea';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types';
import { auth } from '../services/firebase';
import {
  updateCategoryWeights,
} from '../services/auth';
import { useUser } from '../contexts/UserContext';
import {
  CATEGORIES,
  DEFAULT_SELECTED_WEIGHT,
  DEFAULT_NOT_INTERESTED_WEIGHT,
  DEFAULT_NEUTRAL_WEIGHT,
  TEXT_SM,
  TEXT_BASE,
  TEXT_LG,
} from '../utils/constants';
import { ChevronLeft } from 'lucide-react-native';
import { CategoryChipGrid, type ChipState } from '../components/CategoryChipGrid';

type CatPrefNavProp = StackNavigationProp<RootStackParamList, 'CategoryPreferences'>;

export default function CategoryPreferencesScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<CatPrefNavProp>();
  const { profile, loading, refreshProfile } = useUser();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [notInterestedIds, setNotInterestedIds] = useState<string[]>([]);

  useEffect(() => {
    if (profile) {
      setSelectedIds([...profile.selectedCategoryIds]);
      setNotInterestedIds([...profile.notInterestedCategoryIds]);
    }
  }, [profile]);

  const chipStates: Record<string, ChipState> = {};
  for (const cat of CATEGORIES) {
    chipStates[cat.id] = selectedIds.includes(cat.id)
      ? 'selected'
      : notInterestedIds.includes(cat.id)
        ? 'not_interested'
        : 'neutral';
  }

  const handleToggle = async (categoryId: string) => {
    if (!profile || !auth.currentUser) return;

    const state = chipStates[categoryId];
    const newSelected = selectedIds.filter((id) => id !== categoryId);
    const newNotInterested = notInterestedIds.filter((id) => id !== categoryId);

    if (state === 'neutral') {
      newSelected.push(categoryId);
    } else if (state === 'selected') {
      newNotInterested.push(categoryId);
    }

    const prevSelected = selectedIds;
    const prevNotInterested = notInterestedIds;

    setSelectedIds(newSelected);
    setNotInterestedIds(newNotInterested);

    const nextState: ChipState =
      state === 'neutral' ? 'selected'
      : state === 'selected' ? 'not_interested'
      : 'neutral';

    const newWeights = { ...(profile.categoryWeights || {}) };
    newWeights[categoryId] =
      nextState === 'selected' ? DEFAULT_SELECTED_WEIGHT
      : nextState === 'not_interested' ? DEFAULT_NOT_INTERESTED_WEIGHT
      : DEFAULT_NEUTRAL_WEIGHT;

    try {
      await updateCategoryWeights(
        auth.currentUser.uid,
        newWeights,
        newSelected,
        newNotInterested
      );
      refreshProfile();
    } catch (error) {
      console.error('[CategoryPreferences] auto-save error:', error);
      setSelectedIds(prevSelected);
      setNotInterestedIds(prevNotInterested);
      Alert.alert('Save Failed', 'Could not save your preference. Please check your connection and try again.');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border, paddingTop: topInset + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ChevronLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Category Preferences</Text>
        <View style={styles.backButton} />
      </View>

      {loading ? (
        <View style={styles.inlineLoading}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Shared category chip grid */}
          <CategoryChipGrid colors={colors} chipStates={chipStates} onToggle={handleToggle} />

          <View style={{ height: 48 }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inlineLoading: { flex: 1, alignItems: 'center', paddingTop: 40 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 20,
    paddingHorizontal: 28,
    borderBottomWidth: 1,
  },
  backButton: { width: 40, alignItems: 'flex-start' },
  headerTitle: { fontSize: TEXT_LG, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  scrollContent: { paddingHorizontal: 28, paddingTop: 28 },
});
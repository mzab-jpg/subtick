// ============================================================
// SubTick — Screen Header (shared)
// Consistent header layout for all sub-screens with a back
// button, centred title, and bottom border.
// Replaces the copy-pasted header markup across ~8 screens.
// ============================================================

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { topInset } from '../utils/safeArea';
import { ChevronLeft } from 'lucide-react-native';
import { TEXT_LG } from '../utils/constants';

interface ScreenHeaderProps {
  title: string;
  onBack: () => void;
}

export function ScreenHeader({ title, onBack }: ScreenHeaderProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { borderBottomColor: colors.border }]}>
      <TouchableOpacity onPress={onBack} style={styles.backButton}>
        <ChevronLeft size={24} color={colors.text} />
      </TouchableOpacity>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      <View style={styles.spacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: topInset + 12,
    paddingBottom: 24,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    marginBottom: 20,
  },
  backButton: { width: 40, alignItems: 'flex-start' },
  title: {
    fontSize: TEXT_LG,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  spacer: { width: 40 },
});
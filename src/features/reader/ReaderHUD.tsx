// ============================================================
// SubTick — Reader HUD Component
// Frosted-glass overlay with back button, title, like/save.
// ============================================================

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { BlurView } from 'expo-blur';
import { X, Bookmark, Heart } from 'lucide-react-native';
import { ThemeColors } from '../../types';
import { topInset } from '../../utils/safeArea';
import { TEXT_SM } from '../../utils/constants';
import { Article } from '../../types';

interface ReaderHUDProps {
  article: Article | null;
  colors: ThemeColors;
  isDark: boolean;
  isLiked: boolean;
  isSaved: boolean;
  isRestrictedMode: boolean;
  resolvedHtml: string;
  onClose: () => void;
  onLikeToggle: () => void;
  onSaveToggle: () => void;
}

export function ReaderHUD({
  article,
  colors,
  isDark,
  isLiked,
  isSaved,
  isRestrictedMode,
  resolvedHtml,
  onClose,
  onLikeToggle,
  onSaveToggle,
}: ReaderHUDProps) {
  return (
    <View style={styles.hudContainer}>
      <BlurView
        intensity={isDark ? 40 : 80}
        tint={isDark ? 'dark' : 'light'}
        style={[styles.hudBlur, { paddingTop: topInset + 8 }]}
      >
        <View style={styles.hudTopRow}>
          {/* Back/Close Button */}
          <TouchableOpacity onPress={onClose} style={styles.hudBackButton}>
            <X size={24} color={colors.text} />
          </TouchableOpacity>

          <Text
            style={[styles.hudTitle, { color: colors.text }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {article?.title || 'Reading'}
          </Text>

          <View style={styles.hudActions}>
            <TouchableOpacity onPress={onLikeToggle} style={styles.hudIconButton}>
              <Heart
                size={24}
                color={isLiked ? colors.accent : colors.text}
                fill={isLiked ? colors.accent : 'transparent'}
              />
            </TouchableOpacity>
            <TouchableOpacity onPress={onSaveToggle} style={styles.hudIconButton}>
              <Bookmark
                size={24}
                color={isSaved ? colors.accent : colors.text}
                fill={isSaved ? colors.accent : 'transparent'}
              />
            </TouchableOpacity>
          </View>
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  hudContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
  },
  hudBlur: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(150, 150, 150, 0.2)',
  },
  hudTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hudBackButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  hudTitle: {
    flex: 1,
    fontSize: TEXT_SM,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginHorizontal: 16,
  },
  hudActions: { flexDirection: 'row', gap: 16 },
  hudIconButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
});
// ============================================================
// SubTick — Reader Progress Bar
// Bottom-anchored scroll progress indicator using plain React
// state (percentage string). Fabric-safe — no Animated involved.
// ============================================================

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemeColors } from '../../types';
import { bottomInset } from '../../utils/safeArea';

interface ReaderProgressBarProps {
  scrollProgress: number;
  colors: ThemeColors;
}

export function ReaderProgressBar({ scrollProgress, colors }: ReaderProgressBarProps) {
  return (
    <View style={[styles.container, { bottom: bottomInset, backgroundColor: colors.background }]}>
      <View
        style={[
          styles.fill,
          {
            backgroundColor: colors.accent,
            width: `${Math.round(scrollProgress * 100)}%`,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 3,
    width: '100%',
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 100,
    borderRadius: 3,
    backgroundColor: 'transparent',
  },
  fill: {
    height: '100%',
  },
});
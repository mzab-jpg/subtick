// ============================================================
// Tangent — Animated on/off toggle
// Use for genuine binary preferences only.
// ============================================================

import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { ThemeColors } from '../types';

interface TangentToggleProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  colors: ThemeColors;
  accessibilityLabel: string;
}

export function TangentToggle({
  value,
  onValueChange,
  disabled = false,
  colors,
  accessibilityLabel,
}: TangentToggleProps) {
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: value ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [progress, value]);

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [3, 23] });

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={({ pressed }) => [
        styles.track,
        { backgroundColor: value ? colors.primary : colors.surfaceSecondary, borderColor: value ? colors.primary : colors.border },
        (pressed || disabled) && styles.dimmed,
      ]}
    >
      <Animated.View style={[styles.thumb, { backgroundColor: value ? colors.background : colors.textMuted, transform: [{ translateX }] }]} />
      <View pointerEvents="none" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 46,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    justifyContent: 'center',
  },
  thumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  dimmed: { opacity: 0.55 },
});

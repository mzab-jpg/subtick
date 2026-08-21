// ============================================================
// Tangent — ScreenEntrance wrapper
// Applies a simple fade-in on mount to a plain React Native View.
// Safe on any non-WebView screen (Dashboard/Home, Settings-family
// pushes). Reader motion is handled separately via in-WebView CSS
// and must NOT go through here.
// ============================================================

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { startFadeIn } from '../utils/motion';

interface ScreenEntranceProps {
  children: React.ReactNode;
  style?: any;
}

export function ScreenEntrance({ children, style }: ScreenEntranceProps) {
  // Init at opacity 0 so the first painted frame never flashes at full
  // opacity before the fade starts.
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    startFadeIn(opacity);
  }, [opacity]);

  return (
    <Animated.View style={[styles.flex, style, { opacity }]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
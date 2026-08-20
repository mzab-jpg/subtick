import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { TEXT_BASE } from '../utils/constants';

/** Shared top-left text cursor used while Tangent is waiting for content. */
export function LoadingCursor() {
  const { colors } = useTheme();
  const cursorOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(cursorOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
        Animated.timing(cursorOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [cursorOpacity]);

  return (
    <View style={styles.container} accessibilityRole="progressbar" accessibilityLabel="Loading">
      <Text style={[styles.label, { color: colors.accent }]}>Loading</Text>
      <Animated.View
        style={[
          styles.cursor,
          {
            backgroundColor: colors.accent,
            opacity: cursorOpacity,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center' },
  label: { fontSize: TEXT_BASE, fontWeight: '700', letterSpacing: -0.2 },
  cursor: {
    width: 2,
    height: 16,
    borderRadius: 1,
    marginLeft: 1,
  },
});

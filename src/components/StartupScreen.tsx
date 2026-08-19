import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { topInset } from '../utils/safeArea';
import { TEXT_BASE, TEXT_XL } from '../utils/constants';

const MOTTO = 'sapere aude';
const TYPE_INTERVAL_MS = 120;

interface StartupScreenProps {
  accountTransitioning?: boolean;
  onTypingComplete?: () => void;
}

/**
 * Tangent's React-level startup screen. This appears after Android's native
 * splash while authentication/profile setup runs; it never delays readiness.
 */
export function StartupScreen({ accountTransitioning = false, onTypingComplete }: StartupScreenProps) {
  const { colors } = useTheme();
  const [typedLength, setTypedLength] = useState(0);
  const cursorOpacity = useRef(new Animated.Value(1)).current;
  const completionNotifiedRef = useRef(false);

  useEffect(() => {
    if (accountTransitioning) {
      setTypedLength(MOTTO.length);
      return;
    }

    completionNotifiedRef.current = false;
    setTypedLength(0);
    const interval = setInterval(() => {
      setTypedLength((previous) => {
        if (previous >= MOTTO.length) {
          clearInterval(interval);
          return previous;
        }
        return previous + 1;
      });
    }, TYPE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [accountTransitioning]);

  useEffect(() => {
    if (!accountTransitioning && typedLength === MOTTO.length && !completionNotifiedRef.current) {
      completionNotifiedRef.current = true;
      onTypingComplete?.();
    }
  }, [accountTransitioning, onTypingComplete, typedLength]);

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

  const supportingText = accountTransitioning
    ? 'Preparing your new account…'
    : MOTTO.slice(0, typedLength);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]} accessibilityRole="progressbar">
      <View style={styles.wordmarkGroup}>
        <Text style={[styles.wordmark, { color: colors.text }]}>TANGENT</Text>
        <View style={styles.mottoRow}>
          <Text style={[styles.motto, { color: accountTransitioning ? colors.textSecondary : colors.accent }]}>
            {supportingText}
          </Text>
          <Animated.Text style={[styles.cursor, { color: colors.accent, opacity: cursorOpacity }]}>|</Animated.Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingTop: topInset + 28,
    paddingHorizontal: 28,
  },
  wordmarkGroup: { alignItems: 'flex-start' },
  wordmark: {
    fontSize: TEXT_XL,
    fontWeight: '800',
    letterSpacing: -1,
  },
  mottoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 22,
    marginTop: 8,
  },
  motto: {
    fontSize: TEXT_BASE,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  cursor: {
    fontSize: TEXT_BASE,
    fontWeight: '700',
    marginLeft: 2,
  },
});

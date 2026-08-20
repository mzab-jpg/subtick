import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '../contexts/ThemeContext';
import { topInset } from '../utils/safeArea';
import { TEXT_BASE, TEXT_XL } from '../utils/constants';

const MOTTO = 'sapere aude';
const OPENING_CURSOR_MS = 850;
const LETTER_INTERVAL_MS = 200;
const BETWEEN_WORD_PAUSE_MS = 500;
const FINISHED_TYPING_HOLD_MS = 1250;
const CURSOR_BLINK_HALF_CYCLE_MS = 500;

type TypingPhase = 'opening' | 'typing' | 'betweenWords' | 'complete';

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
  const [typingPhase, setTypingPhase] = useState<TypingPhase>('opening');
  const cursorOpacity = useRef(new Animated.Value(1)).current;
  const completionNotifiedRef = useRef(false);
  const onTypingCompleteRef = useRef(onTypingComplete);

  // AppContent creates this callback inline. Keep the latest version without
  // treating a parent re-render as a reason to restart the typing sequence.
  useEffect(() => {
    onTypingCompleteRef.current = onTypingComplete;
  }, [onTypingComplete]);

  useEffect(() => {
    if (accountTransitioning) {
      setTypedLength(MOTTO.length);
      setTypingPhase('complete');
      return;
    }

    completionNotifiedRef.current = false;
    setTypedLength(0);
    setTypingPhase('opening');
    const timers: ReturnType<typeof setTimeout>[] = [];
    const schedule = (callback: () => void, delay: number) => {
      timers.push(setTimeout(callback, delay));
    };

    const typeSecondWord = (length: number) => {
      setTypingPhase('typing');
      setTypedLength(length);
      if (length < MOTTO.length) {
        schedule(() => typeSecondWord(length + 1), LETTER_INTERVAL_MS);
        return;
      }
      setTypingPhase('complete');
      schedule(() => {
        if (!completionNotifiedRef.current) {
          completionNotifiedRef.current = true;
          onTypingCompleteRef.current?.();
        }
      }, FINISHED_TYPING_HOLD_MS);
    };

    const typeFirstWord = (length: number) => {
      setTypingPhase('typing');
      setTypedLength(length);
      if (length < 6) {
        schedule(() => typeFirstWord(length + 1), LETTER_INTERVAL_MS);
        return;
      }
      setTypingPhase('betweenWords');
      schedule(() => typeSecondWord(7), BETWEEN_WORD_PAUSE_MS);
    };

    schedule(() => typeFirstWord(1), OPENING_CURSOR_MS);
    return () => timers.forEach(clearTimeout);
  }, [accountTransitioning]);

  useEffect(() => {
    const shouldBlink = !accountTransitioning && typingPhase !== 'typing';
    if (!shouldBlink) {
      cursorOpacity.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(cursorOpacity, { toValue: 0, duration: CURSOR_BLINK_HALF_CYCLE_MS, useNativeDriver: true }),
        Animated.timing(cursorOpacity, { toValue: 1, duration: CURSOR_BLINK_HALF_CYCLE_MS, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [accountTransitioning, cursorOpacity, typingPhase]);

  const supportingText = accountTransitioning
    ? 'Preparing your new account…'
    : MOTTO.slice(0, typedLength);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]} accessibilityRole="progressbar">
      <StatusBar hidden animated />
      <View style={styles.wordmarkGroup}>
        <Text style={[styles.wordmark, { color: colors.text }]}>TANGENT</Text>
        <View style={styles.mottoRow}>
          <Text style={[styles.motto, { color: accountTransitioning ? colors.textSecondary : colors.accent }]}>
            {supportingText}
          </Text>
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
    width: 2,
    height: 16,
    borderRadius: 1,
    marginLeft: 1,
  },
});

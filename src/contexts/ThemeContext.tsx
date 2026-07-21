// ============================================================
// SubTick — Unified Theme Context
// Prevents UI flashing by centralizing theme state.
// Screens consume this context; they do NOT call useColorScheme directly.
// ============================================================

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useColorScheme, StatusBar } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeMode, ThemeColors } from '../types';

// --- Light Theme Palette (Editorial Minimalism) ---
const lightColors: ThemeColors = {
  background: '#F8F7F4',
  surface: '#FFFFFF',
  surfaceSecondary: '#FFFFFF',
  text: '#111111',
  textSecondary: '#666666',
  textMuted: '#999999',
  primary: '#111111',
  primaryLight: '#E8E5E1',
  accent: '#B63A3A',
  border: '#E8E5E1',
  error: '#C0392B',
  success: '#3A7D44',
  warning: '#B8860B',
  cardShadow: 'transparent',
  hudBackground: 'rgba(255, 255, 255, 0.85)',
  progressBar: '#B63A3A',
  progressBarBackground: 'transparent',
  skeleton: '#E8E5E1',
  skeletonHighlight: '#FFFFFF',
  chipSelectedBg: '#111111',
  chipNotInterestedBg: '#F8F7F4',
  chipNeutralBg: '#FFFFFF',
  chipSelectedText: '#FFFFFF',
  chipNotInterestedText: '#999999',
  chipNeutralText: '#666666',
};

// --- Dark Theme Palette (Editorial Minimalism) ---
const darkColors: ThemeColors = {
  background: '#121212',
  surface: '#1B1B1B',
  surfaceSecondary: '#1B1B1B',
  text: '#F5F5F5',
  textSecondary: '#B5B5B5',
  textMuted: '#777777',
  primary: '#F5F5F5',
  primaryLight: '#2A2A2A',
  accent: '#C94B4B',
  border: '#2A2A2A',
  error: '#FF6B6B',
  success: '#6FCF97',
  warning: '#E2B93B',
  cardShadow: 'transparent',
  hudBackground: 'rgba(27, 27, 27, 0.85)',
  progressBar: '#C94B4B',
  progressBarBackground: 'transparent',
  skeleton: '#2A2A2A',
  skeletonHighlight: '#333333',
  chipSelectedBg: '#F5F5F5',
  chipNotInterestedBg: '#121212',
  chipNeutralBg: '#1B1B1B',
  chipSelectedText: '#121212',
  chipNotInterestedText: '#777777',
  chipNeutralText: '#B5B5B5',
};

const THEME_STORAGE_KEY = '@subtick_theme_preference';

interface ThemeContextValue {
  mode: ThemeMode;
  colors: ThemeColors;
  isDark: boolean;
  setThemeMode: (mode: ThemeMode) => void;
  webViewCSS: string; // Pre-compiled CSS for WebView injection
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [loaded, setLoaded] = useState(false);

  // Load saved preference from AsyncStorage on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setModeState(stored);
        }
      } catch {
        // Default stays 'system'
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // Persist preference changes
  const setThemeMode = useCallback(async (newMode: ThemeMode) => {
    setModeState(newMode);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, newMode);
    } catch {
      // Silently fail — preference not critical
    }
  }, []);

  // Compute resolved dark/light
  const isDark =
    mode === 'dark' || (mode === 'system' && systemColorScheme === 'dark');

  const colors = useMemo(() => (isDark ? darkColors : lightColors), [isDark]);

  // Pre-compile WebView CSS to prevent dark flashing
  const webViewCSS = useMemo(() => {
    const c = colors;
    return `
      <style>
        * {
          background-color: ${c.background} !important;
          color: ${c.text} !important;
          transition: background-color 0.2s ease, color 0.2s ease;
        }
        body {
          background-color: ${c.background} !important;
          color: ${c.text} !important;
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
          line-height: 1.6;
          font-size: 18px;
          font-weight: 400;
          padding: 24px 24px 80px 24px;
          margin: 0;
          letter-spacing: 0;
        }
        h1, h2, h3, h4 {
          font-family: "Georgia", "Times New Roman", serif;
          color: ${c.text} !important;
          font-weight: 400;
          letter-spacing: -0.01em;
        }
        h1 {
          font-size: 32px;
          line-height: 1.2;
          margin-top: 0.5em;
          margin-bottom: 0.5em !important;
        }
        h2 {
          font-size: 24px;
          margin-top: 1.8em;
          margin-bottom: 0.8em;
          border-bottom: 1px solid ${c.border};
          padding-bottom: 8px;
        }
        h3 {
          font-size: 20px;
          margin-top: 1.5em;
          margin-bottom: 0.6em;
        }
        p {
          margin: 1.4em 0;
          color: ${c.textSecondary} !important;
          font-size: 18px;
        }
        ul, ol {
          color: ${c.textSecondary} !important;
          padding-left: 20px;
          margin: 1.2em 0;
          font-size: 18px;
        }
        li { margin: 0.6em 0; line-height: 1.6; }
        a {
          color: ${c.primary} !important;
          text-decoration: none;
          border-bottom: 1px solid ${c.border};
        }
        img {
          max-width: 100%;
          height: auto;
          margin: 32px 0;
          border-radius: 8px;
        }
        figcaption {
          font-size: 14px;
          color: ${c.textMuted} !important;
          text-align: center;
          margin-top: 8px;
          font-style: italic;
        }
        blockquote {
          border-left: 2px solid ${c.border};
          margin: 2em 0;
          padding: 4px 0 4px 20px;
          background-color: transparent !important;
          color: ${c.text} !important;
          font-style: italic;
          font-size: 20px;
          line-height: 1.5;
        }
        code {
          background-color: ${c.surface} !important;
          padding: 3px 6px;
          border-radius: 4px;
          font-size: 15px;
          font-family: Menlo, Monaco, Consolas, "Courier New", monospace;
          border: 1px solid ${c.border};
        }
        pre {
          background-color: ${c.surface} !important;
          padding: 16px;
          border-radius: 8px;
          overflow-x: auto;
          font-family: Menlo, Monaco, Consolas, "Courier New", monospace;
          font-size: 14px;
          border: 1px solid ${c.border};
        }
        hr {
          border: none;
          border-top: 1px solid ${c.border};
          margin: 40px auto;
          width: 60px;
        }
      </style>
    `;
  }, [colors]);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, colors, isDark, setThemeMode, webViewCSS }),
    [mode, colors, isDark, setThemeMode, webViewCSS]
  );

  // Render immediately using the resolved system/default theme — no blank flash.
  // Once AsyncStorage loads the saved preference (usually <100ms), state updates
  // and the theme switches seamlessly without any visible flicker.

  return (
    <ThemeContext.Provider value={value}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}

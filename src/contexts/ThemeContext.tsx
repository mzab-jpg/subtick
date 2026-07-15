// ============================================================
// SubTick — Unified Theme Context
// Prevents UI flashing by centralizing theme state.
// Screens consume this context; they do NOT call useColorScheme directly.
// ============================================================

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useColorScheme, StatusBar } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeMode, ThemeColors } from '../types';

// --- Light Theme Palette ---
const lightColors: ThemeColors = {
  background: '#F9FAFB',
  surface: '#FFFFFF',
  surfaceSecondary: '#F3F4F6',
  text: '#111827',
  textSecondary: '#4B5563',
  textMuted: '#9CA3AF',
  primary: '#2563EB',
  primaryLight: '#DBEAFE',
  accent: '#8B5CF6',
  border: '#E5E7EB',
  error: '#EF4444',
  success: '#10B981',
  warning: '#F59E0B',
  cardShadow: 'rgba(0,0,0,0.08)',
  hudBackground: 'rgba(255,255,255,0.95)',
  progressBar: '#2563EB',
  progressBarBackground: '#E5E7EB',
  skeleton: '#E5E7EB',
  skeletonHighlight: '#F3F4F6',
  chipSelectedBg: '#DBEAFE',
  chipNotInterestedBg: '#FEE2E2',
  chipNeutralBg: '#F3F4F6',
  chipSelectedText: '#1E40AF',
  chipNotInterestedText: '#991B1B',
  chipNeutralText: '#6B7280',
};

// --- Dark Theme Palette ---
const darkColors: ThemeColors = {
  background: '#0F172A',
  surface: '#1E293B',
  surfaceSecondary: '#334155',
  text: '#F1F5F9',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  primary: '#3B82F6',
  primaryLight: '#1E3A5F',
  accent: '#A78BFA',
  border: '#334155',
  error: '#F87171',
  success: '#34D399',
  warning: '#FBBF24',
  cardShadow: 'rgba(0,0,0,0.3)',
  hudBackground: 'rgba(15,23,42,0.97)',
  progressBar: '#3B82F6',
  progressBarBackground: '#334155',
  skeleton: '#334155',
  skeletonHighlight: '#475569',
  chipSelectedBg: '#1E3A5F',
  chipNotInterestedBg: '#7F1D1D',
  chipNeutralBg: '#334155',
  chipSelectedText: '#93C5FD',
  chipNotInterestedText: '#FCA5A5',
  chipNeutralText: '#94A3B8',
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
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          line-height: 1.7;
          font-size: 18px;
          padding: 16px;
          margin: 0;
        }
        h2, h3, h4 {
          color: ${c.text} !important;
          margin-top: 1.5em;
          margin-bottom: 0.5em;
        }
        h2 { font-size: 24px; border-bottom: 1px solid ${c.border}; padding-bottom: 8px; }
        h3 { font-size: 20px; }
        p { margin: 1em 0; color: ${c.textSecondary} !important; }
        ul, ol { color: ${c.textSecondary} !important; padding-left: 24px; }
        li { margin: 0.5em 0; }
        a { color: ${c.primary} !important; }
        img { max-width: 100%; height: auto; border-radius: 8px; margin: 16px 0; }
        blockquote {
          border-left: 4px solid ${c.primary};
          margin: 1em 0;
          padding: 0.5em 1em;
          background-color: ${c.surfaceSecondary} !important;
          color: ${c.textSecondary} !important;
        }
        code {
          background-color: ${c.surfaceSecondary} !important;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 15px;
        }
        pre {
          background-color: ${c.surfaceSecondary} !important;
          padding: 16px;
          border-radius: 8px;
          overflow-x: auto;
        }
        hr { border: none; border-top: 1px solid ${c.border}; margin: 24px 0; }
      </style>
    `;
  }, [colors]);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, colors, isDark, setThemeMode, webViewCSS }),
    [mode, colors, isDark, setThemeMode, webViewCSS]
  );

  if (!loaded) {
    // Render nothing until theme is loaded to prevent flash
    return null;
  }

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
// ============================================================
// SubTick — Unified Theme Context
// Prevents UI flashing by centralizing theme state.
// Screens consume this context; they do NOT call useColorScheme directly.
// ============================================================

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useColorScheme, StatusBar } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeMode, ThemeColors } from '../types';

// --- Light Theme Palette (Frosted Milk Glass Theme) ---
const lightColors: ThemeColors = {
  background: '#EDF1F7', // Milk Glass light backdrop
  surface: 'rgba(255, 255, 255, 0.65)', // High-translucent glass card
  surfaceSecondary: 'rgba(255, 255, 255, 0.40)', // Secondary soft glass
  text: '#1F2937', // Deep slate
  textSecondary: '#4B5563',
  textMuted: '#9CA3AF',
  primary: '#6366F1', // Glowing Indigo accent
  primaryLight: 'rgba(99, 102, 241, 0.15)',
  accent: '#EC4899', // Sunset Rose accent
  border: 'rgba(255, 255, 255, 0.70)', // High-refraction solid white border highlight
  error: '#EF4444',
  success: '#10B981',
  warning: '#F59E0B',
  cardShadow: 'rgba(31, 41, 55, 0.04)',
  hudBackground: 'rgba(255, 255, 255, 0.80)',
  progressBar: '#6366F1',
  progressBarBackground: 'rgba(0, 0, 0, 0.05)',
  skeleton: '#E5E7EB',
  skeletonHighlight: '#F3F4F6',
  chipSelectedBg: 'rgba(99, 102, 241, 0.15)',
  chipNotInterestedBg: '#FEE2E2',
  chipNeutralBg: 'rgba(0, 0, 0, 0.05)',
  chipSelectedText: '#4F46E5',
  chipNotInterestedText: '#991B1B',
  chipNeutralText: '#6B7280',
};

// --- Dark Theme Palette (Deep Obsidian Glass Theme) ---
const darkColors: ThemeColors = {
  background: '#0B0F19', // Deep Obsidian backdrop
  surface: 'rgba(22, 29, 48, 0.70)', // Frosted dark glass
  surfaceSecondary: 'rgba(30, 41, 59, 0.50)', // Translucent secondary glass
  text: '#F1F5F9', // Ice white
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  primary: '#6366F1', // Glowing Neon Indigo
  primaryLight: 'rgba(99, 102, 241, 0.20)',
  accent: '#EC4899', // Neon Rose
  border: 'rgba(255, 255, 255, 0.08)', // Sharp rim light edge
  error: '#F87171',
  success: '#34D399',
  warning: '#FBBF24',
  cardShadow: 'rgba(0, 0, 0, 0.25)',
  hudBackground: 'rgba(11, 15, 25, 0.85)',
  progressBar: '#6366F1',
  progressBarBackground: 'rgba(255, 255, 255, 0.05)',
  skeleton: '#1E293B',
  skeletonHighlight: '#334155',
  chipSelectedBg: 'rgba(99, 102, 241, 0.20)',
  chipNotInterestedBg: '#7F1D1D',
  chipNeutralBg: 'rgba(255, 255, 255, 0.05)',
  chipSelectedText: '#A5B4FC',
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
    const isDarkTheme = isDark;
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
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          line-height: 1.8;
          font-size: 17px;
          font-weight: 400;
          padding: 24px 20px;
          margin: 0;
          letter-spacing: -0.011em;
        }
        h1 {
          font-size: 32px;
          line-height: 1.25;
          font-weight: 800;
          letter-spacing: -0.022em;
          margin-bottom: 12px !important;
        }
        h2, h3, h4 {
          color: ${c.text} !important;
          margin-top: 1.8em;
          margin-bottom: 0.6em;
          font-weight: 700;
          letter-spacing: -0.015em;
        }
        h2 { font-size: 22px; border-bottom: 1px solid ${c.border}; padding-bottom: 8px; }
        h3 { font-size: 19px; }
        p { margin: 1.2em 0; color: ${c.textSecondary} !important; font-size: 17px; }
        ul, ol { color: ${c.textSecondary} !important; padding-left: 20px; }
        li { margin: 0.6em 0; }
        a { color: ${c.primary} !important; text-decoration: none; font-weight: 500; }
        img { max-width: 100%; height: auto; border-radius: 12px; margin: 24px 0; box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
        blockquote {
          border-left: 3px solid ${c.primary};
          margin: 1.5em 0;
          padding: 4px 18px;
          background-color: ${c.surfaceSecondary} !important;
          color: ${c.textSecondary} !important;
          border-radius: 0 8px 8px 0;
          font-style: italic;
        }
        code {
          background-color: ${c.surfaceSecondary} !important;
          padding: 3px 6px;
          border-radius: 6px;
          font-size: 14px;
          font-family: Menlo, Monaco, Consolas, "Courier New", monospace;
        }
        pre {
          background-color: ${c.surfaceSecondary} !important;
          padding: 16px;
          border-radius: 10px;
          overflow-x: auto;
          font-family: Menlo, Monaco, Consolas, "Courier New", monospace;
        }
        hr { border: none; border-top: 1px solid ${c.border}; margin: 32px 0; }
      </style>
    `;
  }, [colors, isDark]);

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
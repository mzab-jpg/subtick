// ============================================================
// SubTick — Unified Theme Context
// Prevents UI flashing by centralizing theme state.
// Screens consume this context; they do NOT call useColorScheme directly.
// ============================================================

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useColorScheme, StatusBar } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeMode, ThemeColors } from '../types';

// --- Light Theme Palette (High-Contrast Editorial) ---
const lightColors: ThemeColors = {
  background: '#FFFFFF', // Pure, stark white
  surface: '#FFFFFF', // Pure white
  surfaceSecondary: '#F3F4F6', // Muted cool grey for secondary areas
  text: '#111111', // Almost pure black for extreme contrast
  textSecondary: '#4B5563', // Solid mid-grey for descriptions
  textMuted: '#9CA3AF',
  primary: '#000000', // Editorial pure black for primary highlights
  primaryLight: '#E5E7EB', // Soft grey for badge backgrounds
  accent: '#EF4444', // Classic editorial red
  border: '#E5E7EB', // Very light hairline border
  error: '#EF4444',
  success: '#10B981',
  warning: '#F59E0B',
  cardShadow: 'transparent', // Remove generic drop shadows for a flatter, starker look
  hudBackground: 'rgba(255, 255, 255, 0.70)', // Light blur tint
  progressBar: '#111111',
  progressBarBackground: 'transparent',
  skeleton: '#E5E7EB',
  skeletonHighlight: '#F9FAFB',
  chipSelectedBg: '#111111',
  chipNotInterestedBg: '#FEE2E2',
  chipNeutralBg: '#F3F4F6',
  chipSelectedText: '#FFFFFF',
  chipNotInterestedText: '#991B1B',
  chipNeutralText: '#4B5563',
};

// --- Dark Theme Palette (Deep High-Contrast Editorial) ---
const darkColors: ThemeColors = {
  background: '#000000', // Pitch black
  surface: '#000000', // Pitch black
  surfaceSecondary: '#111827', // Deep slate for secondary areas
  text: '#F9FAFB', // Stark white
  textSecondary: '#9CA3AF', // Muted slate for descriptions
  textMuted: '#6B7280',
  primary: '#FFFFFF', // Editorial pure white for primary highlights
  primaryLight: '#1F2937', // Deep slate for badge backgrounds
  accent: '#EF4444', // Classic editorial red
  border: '#1F2937', // Deep slate hairline border
  error: '#F87171',
  success: '#34D399',
  warning: '#FBBF24',
  cardShadow: 'transparent',
  hudBackground: 'rgba(0, 0, 0, 0.70)', // Dark blur tint
  progressBar: '#FFFFFF',
  progressBarBackground: 'transparent',
  skeleton: '#1F2937',
  skeletonHighlight: '#374151',
  chipSelectedBg: '#FFFFFF',
  chipNotInterestedBg: '#7F1D1D',
  chipNeutralBg: '#1F2937',
  chipSelectedText: '#000000',
  chipNotInterestedText: '#FCA5A5',
  chipNeutralText: '#9CA3AF',
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
    // We inject premium magazine-style CSS, using a beautifully legible serif for titles
    // and an elegant sans-serif for the body text with wide, comfortable tracking and huge line heights.
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
          line-height: 1.85;
          font-size: 19px;
          font-weight: 400;
          padding: 24px 24px 80px 24px;
          margin: 0;
          letter-spacing: -0.015em;
        }
        h1, h2, h3, h4 {
          font-family: "Georgia", "Times New Roman", serif;
          color: ${c.text} !important;
          font-weight: 700;
          letter-spacing: -0.02em;
        }
        h1 {
          font-size: 34px;
          line-height: 1.2;
          margin-top: 0.5em;
          margin-bottom: 0.5em !important;
        }
        h2 { 
          font-size: 26px; 
          margin-top: 1.8em;
          margin-bottom: 0.8em;
          border-bottom: 1px solid ${c.border}; 
          padding-bottom: 8px; 
        }
        h3 { 
          font-size: 22px; 
          margin-top: 1.5em;
          margin-bottom: 0.6em;
        }
        p { 
          margin: 1.4em 0; 
          color: ${c.textSecondary} !important; 
          font-size: 19px; 
        }
        ul, ol { 
          color: ${c.textSecondary} !important; 
          padding-left: 20px; 
          margin: 1.2em 0;
          font-size: 19px;
        }
        li { margin: 0.6em 0; line-height: 1.7; }
        a { 
          color: ${c.primary} !important; 
          text-decoration: none; 
          border-bottom: 1px solid ${c.border};
        }
        img { 
          max-width: 100%; 
          height: auto; 
          margin: 32px 0; 
        }
        figcaption {
          font-size: 14px;
          color: ${c.textMuted} !important;
          text-align: center;
          margin-top: 8px;
          font-style: italic;
        }
        blockquote {
          border-left: 2px solid ${c.primary};
          margin: 2em 0;
          padding: 4px 0 4px 20px;
          background-color: transparent !important;
          color: ${c.text} !important;
          font-style: italic;
          font-size: 22px;
          line-height: 1.6;
        }
        code {
          background-color: ${c.surfaceSecondary} !important;
          padding: 3px 6px;
          border-radius: 4px;
          font-size: 16px;
          font-family: Menlo, Monaco, Consolas, "Courier New", monospace;
        }
        pre {
          background-color: ${c.surfaceSecondary} !important;
          padding: 20px;
          border-radius: 8px;
          overflow-x: auto;
          font-family: Menlo, Monaco, Consolas, "Courier New", monospace;
          font-size: 14px;
        }
        hr { 
          border: none; 
          border-top: 1px solid ${c.border}; 
          margin: 40px auto; 
          width: 60px;
        }
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
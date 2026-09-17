// ============================================================
// SubTick — Unified Theme Context
// Prevents UI flashing by centralizing theme state.
// Screens consume this context; they do NOT call useColorScheme directly.
// ============================================================

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { StatusBar } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeMode, ThemeColors, ThemeFonts } from '../types';

// --- Obsidian Steel Glacier (dark-only UI; see design/stitch-export/new-ui-B/README.md) ---
// Tokens are byte-identical to the approved B-series screens. The old Editorial
// Minimalism light palette was retired with the redesign; ThemeMode storage is
// kept for backward compatibility but no longer changes rendering.
const obsidianColors: ThemeColors = {
  background: '#0C0E12',
  surface: '#1B1F28',
  surfaceSecondary: '#161A20',
  surfaceCard: '#1B1F28',
  surfaceRaised: '#161A20',
  text: '#F0F3F8',
  textSecondary: '#9BA7BA',
  textMuted: '#475263',
  textFaint: '#475263',
  primary: '#F0F3F8', // silver — primary buttons
  primaryLight: '#252A32',
  accent: '#7FA8C9', // muted steel — NEVER bright cyan
  accentDeep: '#5E86A6',
  accentSoft: 'rgba(127, 168, 201, 0.12)',
  onPrimary: '#0B0E13',
  border: '#252A32',
  borderStrong: '#4B535D',
  error: '#FFB4AB',
  success: '#7FC9A8',
  warning: '#E2C088',
  cardShadow: 'transparent',
  hudBackground: 'rgba(12, 14, 18, 0.85)',
  progressBar: '#7FA8C9',
  progressBarBackground: 'transparent',
  chipSelectedBg: 'rgba(127, 168, 201, 0.12)',
  chipNotInterestedBg: '#0C0E12',
  chipNeutralBg: '#1B1F28',
  chipSelectedText: '#7FA8C9',
  chipNotInterestedText: '#475263',
  chipNeutralText: '#9BA7BA',
};

// --- Typography (families as loaded in App.tsx via expo-font) ---
const themeFonts: ThemeFonts = {
  display: 'SpaceGrotesk_500Medium',
  headline: 'SpaceGrotesk_500Medium',
  title: 'SpaceGrotesk_600SemiBold',
  body: 'Manrope_400Regular',
  bodyMedium: 'Manrope_500Medium',
  bodySemiBold: 'Manrope_600SemiBold',
  mono: 'JetBrainsMono_500Medium',
  monoRegular: 'JetBrainsMono_400Regular',
};

const THEME_STORAGE_KEY = '@subtick_theme_preference';

interface ThemeContextValue {
  mode: ThemeMode;
  colors: ThemeColors;
  fonts: ThemeFonts;
  isDark: boolean;
  setThemeMode: (mode: ThemeMode) => void;
  webViewCSS: string; // Pre-compiled CSS for WebView injection
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [, setLoaded] = useState(false);

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

  // Dark-only UI (Obsidian Steel Glacier). Kept as a constant so every consumer
  // keeps working; re-introduce light support by resolving `mode` again.
  const isDark = true;

  const colors = useMemo(() => obsidianColors, []);

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
          /* M2 Fix: force h1 colour so theme switches mid-article recolour the
             headline too — its inline style previously won over this sheet. */
          color: ${c.text} !important;
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
          color: ${c.text} !important;
          font-size: 18px;
        }
        ul, ol {
          color: ${c.text} !important;
          padding-left: 20px;
          margin: 1.2em 0;
          font-size: 18px;
        }
        li { margin: 0.6em 0; line-height: 1.6; color: ${c.text} !important; }
        a {
          color: ${c.primary} !important;
          text-decoration: none;
          border-bottom: 1px solid ${c.textSecondary};
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
          border-left: 2px solid ${c.accent};
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
    () => ({ mode, colors, fonts: themeFonts, isDark, setThemeMode, webViewCSS }),
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

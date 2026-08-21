// ============================================================
// Tangent — Shared motion language (fade-in only)
// One simple, compositing-safe animation everywhere: content
// fades in over a shared 220ms rhythm. No slides, no rises, no
// transforms.
//
// Two delivery mechanisms, chosen by surface:
//  - articleFadeCss(): Reader motion runs INSIDE the WebView
//    document via CSS. Android does not reliably composite
//    wrapper opacity/transform around a WebView, so we never
//    animate the RN View that holds it.
//  - startFadeIn(): motion for plain (non-WebView) RN Views.
// ============================================================

import { Animated } from 'react-native';

export const ARRIVAL_DURATION_MS = 220;

/**
 * In-WebView CSS that fades the article document into place on load. Runs
 * inside the WebView's own engine (CSS keyframes), never on the RN wrapper
 * around it, so it is compositing-safe on Android.
 */
export function articleFadeCss(durationMs: number = ARRIVAL_DURATION_MS): string {
  return `
    <style data-tangent-fade>
      html, body { margin: 0; }
      #tangent-article {
        animation: tangent-fade-in ${durationMs}ms ease-out both;
      }
      @keyframes tangent-fade-in {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
    </style>`;
}

/**
 * Starts a simple fade-in (0 -> 1) on a plain RN View. Fade only — no
 * transform. Use exclusively on non-WebView surfaces.
 */
export function startFadeIn(opacity: Animated.Value) {
  opacity.setValue(0);
  Animated.timing(opacity, {
    toValue: 1,
    duration: ARRIVAL_DURATION_MS,
    useNativeDriver: true,
  }).start();
}
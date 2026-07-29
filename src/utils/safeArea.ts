// ============================================================
// SubTick — Safe Area Insets (Fabric-safe, no native module)
// Uses StatusBar.currentHeight (Android) and hardcoded iOS
// values. Avoids react-native-safe-area-context which causes
// Fabric crashes on RN 0.86 when insets are undefined/NaN.
// ============================================================

import { Platform, StatusBar } from 'react-native';

// Top inset: status bar height
// iOS: 44pt covers notch devices (iPhone X+). Harmless on non-notch.
// Android: StatusBar.currentHeight is synchronous, always a number.
export const topInset: number = Platform.select({
  ios: 44,
  android: StatusBar.currentHeight ?? 24,
  default: 0,
}) ?? 0;

// Bottom inset: home indicator height
// iOS: 34pt covers home indicator on Face ID devices.
// Android: gesture nav bar is handled by system, no inset needed.
export const bottomInset: number = Platform.select({
  ios: 34,
  android: 0,
  default: 0,
}) ?? 0;
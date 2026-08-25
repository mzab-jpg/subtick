// ============================================================
// SubTick — Crash Reporter
// Fire-and-forget renderer-crash reporting to the reportCrash
// Cloud Function (writes to the crash_reports collection).
// Privacy-conscious: no third party, capped per session, and
// reporting failures are always silently swallowed.
// ============================================================

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { functions } from './firebase';
import { httpsCallable } from 'firebase/functions';

const MAX_REPORTS_PER_SESSION = 5;
let reportsSent = 0;

export function reportCrash(error: Error | null | undefined, componentStack?: string): void {
  try {
    if (!error || reportsSent >= MAX_REPORTS_PER_SESSION) return;
    reportsSent++;

    const payload = {
      message: String(error.message || 'Unknown render error').slice(0, 500),
      stack: String(error.stack || '').slice(0, 4000),
      componentStack: String(componentStack || '').slice(0, 2000),
      platform: Platform.OS === 'android' ? 'android' : 'ios',
      appVersion: String(Constants.expoConfig?.version || 'unknown').slice(0, 40),
    };

    const report = httpsCallable(functions, 'reportCrash');
    void report(payload).catch(() => {
      // Reporting must never surface its own failures to the user.
    });
  } catch {
    // Swallow everything — a failing reporter must not cause a second crash.
  }
}

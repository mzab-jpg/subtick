// ============================================================
// SubTick — Shared Dashboard Metric Utilities
// ============================================================

import React from 'react';
import { Flame, CalendarDays, Clock, Gauge, BookCheck, BookHeart, BarChart3 } from 'lucide-react-native';
import { BehaviorEvent, ReaderSessionSummary, UserProfile } from '../types';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type LocalReadOutcome = 'quick_exit' | 'read_shallow' | 'read_skim' | 'read_thorough' | 'swipe_next';

/** WPM is simply words read divided by active foreground reading time. */
export function calculateWpm(wordCount: number | undefined, sessionDurationMs: number): number | null {
  if (!wordCount || wordCount <= 0 || sessionDurationMs <= 0) return null;
  return wordCount / (sessionDurationMs / 60_000);
}

/**
 * Immediate display estimate using Tangent's shipped default classification rules.
 * Cloud Functions reclassify with the live server config before persisting anything.
 */
export function classifyLocalRead(summary: ReaderSessionSummary, averageWpm: number): LocalReadOutcome {
  if (summary.scrollDepth < 0.20 && summary.sessionDuration < 15_000) return 'quick_exit';
  if (summary.scrollDepth >= 0.70) {
    const expectedMs = summary.actualWordCount && summary.actualWordCount > 0
      ? (summary.actualWordCount / Math.max(50, averageWpm || 200)) * 60_000
      : 0;
    return expectedMs <= 0 || summary.sessionDuration >= expectedMs * 0.60
      ? 'read_thorough'
      : 'read_skim';
  }
  if (summary.scrollDepth >= 0.40) return 'read_shallow';
  return 'swipe_next';
}

export function isQualifyingRead(outcome: LocalReadOutcome): boolean {
  return outcome === 'read_thorough' || outcome === 'read_skim';
}

export function estimateNextStreak(lastReadDate: number, currentStreakDays: number, now: number): number {
  const today = new Date(now).toDateString();
  const last = new Date(lastReadDate || 0).toDateString();
  if (last === today) return currentStreakDays || 1;
  const yesterday = new Date(now - 24 * 60 * 60 * 1000).toDateString();
  return last === yesterday ? Math.max(1, currentStreakDays + 1) : 1;
}

/**
 * Counts the only event types Tangent presents as completed reads in the
 * rolling seven-day dashboard metric. Kept pure for regression testing.
 */
export function countWeeklyQualifyingReads(
  events: Pick<BehaviorEvent, 'eventType' | 'timestamp'>[],
  now: number = Date.now()
): number {
  const windowStart = now - WEEK_MS;
  return events.filter((event) =>
    event.timestamp >= windowStart
    && event.timestamp <= now
    && (event.eventType === 'read_thorough' || event.eventType === 'read_skim')
  ).length;
}

/** Keeps the dashboard's visual three-metric limit consistent everywhere. */
export function normalizeDashboardMetricIds(metricIds: string[]): string[] {
  return [...new Set(metricIds)].slice(0, 3);
}

/**
 * Returns the appropriate icon element for a dashboard metric ID.
 * Shared between DashboardScreen and DashboardStatsScreen.
 */
export function getMetricIcon(id: string, color: string, size: number = 16) {
  switch (id) {
    case 'streak': return <Flame size={size} color={color} />;
    case 'weeklyReads': return <CalendarDays size={size} color={color} />;
    case 'totalReadTime': return <Clock size={size} color={color} />;
    case 'avgWpm': return <Gauge size={size} color={color} />;
    case 'totalRead': return <BookCheck size={size} color={color} />;
    case 'topCategory': return <BookHeart size={size} color={color} />;
    default: return <BarChart3 size={size} color={color} />;
  }
}

/**
 * Returns the user's top category (highest weight, excluding compound keys
 * like "Technology::long" and publisher keys like "pub::Example").
 * Shared between DashboardScreen and DashboardStatsScreen.
 */
export function getTopCategory(profile: UserProfile | null): string {
  if (!profile) return '—';
  const weights = profile.categoryWeights || {};
  let topCat = '—';
  let topWeight = 0;
  Object.entries(weights).forEach(([cat, w]) => {
    if (!cat.includes('::') && !cat.startsWith('pub::') && w > topWeight) {
      topWeight = w;
      topCat = cat;
    }
  });
  return topCat;
}
// ============================================================
// SubTick — Shared Dashboard Metric Utilities
// ============================================================

import React from 'react';
import { Flame, CalendarDays, Clock, Gauge, BookCheck, BookHeart, BarChart3 } from 'lucide-react-native';
import { BehaviorEvent, UserProfile } from '../types';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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
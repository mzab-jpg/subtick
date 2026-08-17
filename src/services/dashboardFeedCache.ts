// ============================================================
// Tangent — Dashboard Feed Cache
// Keeps visible Dashboard cards stable across screen remounts for one user.
// ============================================================

import { Article } from '../types';

interface CachedDashboardFeed {
  articles: Article[];
  shownIds: string[];
}

const feeds = new Map<string, CachedDashboardFeed>();

export function getCachedDashboardFeed(userId: string): CachedDashboardFeed | null {
  return feeds.get(userId) ?? null;
}

export function setCachedDashboardFeed(userId: string, articles: Article[], shownIds: Iterable<string>): void {
  feeds.set(userId, { articles, shownIds: Array.from(shownIds) });
}

export function clearCachedDashboardFeed(userId?: string): void {
  if (userId) feeds.delete(userId);
  else feeds.clear();
}

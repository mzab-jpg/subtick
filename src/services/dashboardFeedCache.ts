// ============================================================
// Tangent — Dashboard Feed Cache
// Keeps visible Dashboard cards stable across screen remounts for one user.
// ============================================================

import { Article } from '../types';
import {
  clearPersistentStartupCache,
  getPersistedDashboardFeed,
  savePersistedDashboardFeed,
} from './startupCache';
import { clearInitialDashboardFeedRequest } from './initialDashboardFeed';

interface CachedDashboardFeed {
  articles: Article[];
  shownIds: string[];
}

const feeds = new Map<string, CachedDashboardFeed>();
const listeners = new Map<string, Set<(feed: CachedDashboardFeed | null) => void>>();

function notify(userId: string) {
  listeners.get(userId)?.forEach((listener) => listener(feeds.get(userId) ?? null));
}

export function subscribeToCachedDashboardFeed(userId: string, listener: (feed: CachedDashboardFeed | null) => void): () => void {
  const userListeners = listeners.get(userId) ?? new Set();
  userListeners.add(listener);
  listeners.set(userId, userListeners);
  return () => {
    userListeners.delete(listener);
    if (userListeners.size === 0) listeners.delete(userId);
  };
}

export function getCachedDashboardFeed(userId: string): CachedDashboardFeed | null {
  return feeds.get(userId) ?? null;
}

export function setCachedDashboardFeed(userId: string, articles: Article[], shownIds: Iterable<string>): void {
  const feed = { articles, shownIds: Array.from(shownIds) };
  feeds.set(userId, feed);
  notify(userId);
  void savePersistedDashboardFeed(userId, feed.articles, feed.shownIds);
}

/** Save a fresh background result for the next launch without replacing visible cards. */
export function stageDashboardFeedForNextLaunch(userId: string, articles: Article[], shownIds: Iterable<string>): void {
  void savePersistedDashboardFeed(userId, articles, Array.from(shownIds));
}

/** Restore only this UID's recent unread cards before requesting a fresh feed. */
export async function restoreCachedDashboardFeed(userId: string, seenIds: Iterable<string> = []): Promise<CachedDashboardFeed | null> {
  const persisted = await getPersistedDashboardFeed(userId);
  if (!persisted) return null;

  const excluded = new Set(seenIds);
  const articles = persisted.articles.filter((article) => !excluded.has(article.id));
  const shownIds = persisted.shownIds.filter((id) => !excluded.has(id));
  if (articles.length === 0) return null;

  const restored = { articles, shownIds };
  feeds.set(userId, restored);
  notify(userId);
  void savePersistedDashboardFeed(userId, articles, shownIds);
  return restored;
}

/** Remove only a genuinely opened article; unread cards retain their order. */
export function removeArticleFromCachedDashboardFeed(userId: string, articleId: string): void {
  const cached = feeds.get(userId);
  if (!cached) return;
  const articles = cached.articles.filter((article) => article.id !== articleId);
  if (articles.length === cached.articles.length) return;
  const next = { ...cached, articles };
  feeds.set(userId, next);
  notify(userId);
  void savePersistedDashboardFeed(userId, next.articles, next.shownIds);
}

export function clearCachedDashboardFeed(userId?: string): void {
  if (userId) {
    feeds.delete(userId);
    notify(userId);
    void clearPersistentStartupCache(userId);
    clearInitialDashboardFeedRequest(userId);
  } else {
    const userIds = Array.from(feeds.keys());
    feeds.clear();
    userIds.forEach(notify);
    void clearPersistentStartupCache();
    clearInitialDashboardFeedRequest();
  }
}

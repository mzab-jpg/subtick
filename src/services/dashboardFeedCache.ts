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
  feeds.set(userId, { articles, shownIds: Array.from(shownIds) });
  notify(userId);
}

/** Remove only a genuinely opened article; unread cards retain their order. */
export function removeArticleFromCachedDashboardFeed(userId: string, articleId: string): void {
  const cached = feeds.get(userId);
  if (!cached) return;
  const articles = cached.articles.filter((article) => article.id !== articleId);
  if (articles.length === cached.articles.length) return;
  feeds.set(userId, { ...cached, articles });
  notify(userId);
}

export function clearCachedDashboardFeed(userId?: string): void {
  if (userId) {
    feeds.delete(userId);
    notify(userId);
  } else {
    const userIds = Array.from(feeds.keys());
    feeds.clear();
    userIds.forEach(notify);
  }
}

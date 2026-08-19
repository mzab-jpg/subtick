// ============================================================
// Tangent — Persistent Startup Cache
// Non-sensitive, UID-bound display cache. Firebase remains authoritative.
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Article, UserProfile } from '../types';

const STARTUP_SNAPSHOT_PREFIX = '@subtick_startup_snapshot_';
const DASHBOARD_FEED_PREFIX = '@subtick_dashboard_feed_';
const MAX_DASHBOARD_CACHE_AGE_MS = 24 * 60 * 60 * 1000;

export interface StartupSnapshot {
  userId: string;
  isOnboarded: boolean;
  savedAt: number;
}

export interface PersistedDashboardFeed {
  userId: string;
  articles: Article[];
  shownIds: string[];
  savedAt: number;
}

const snapshotKey = (userId: string) => `${STARTUP_SNAPSHOT_PREFIX}${userId}`;
const feedKey = (userId: string) => `${DASHBOARD_FEED_PREFIX}${userId}`;

export async function getStartupSnapshot(userId: string): Promise<StartupSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(snapshotKey(userId));
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as StartupSnapshot;
    return snapshot.userId === userId ? snapshot : null;
  } catch {
    return null;
  }
}

export async function saveStartupSnapshot(profile: UserProfile): Promise<void> {
  const snapshot: StartupSnapshot = {
    userId: profile.userId,
    isOnboarded: profile.isOnboarded === true,
    savedAt: Date.now(),
  };
  try {
    await AsyncStorage.setItem(snapshotKey(profile.userId), JSON.stringify(snapshot));
  } catch {
    // The cloud profile remains usable if this non-essential cache cannot save.
  }
}

export async function getPersistedDashboardFeed(userId: string): Promise<PersistedDashboardFeed | null> {
  try {
    const raw = await AsyncStorage.getItem(feedKey(userId));
    if (!raw) return null;
    const feed = JSON.parse(raw) as PersistedDashboardFeed;
    if (feed.userId !== userId || !Array.isArray(feed.articles) || !Array.isArray(feed.shownIds)) return null;
    if (Date.now() - feed.savedAt > MAX_DASHBOARD_CACHE_AGE_MS) return null;
    return feed;
  } catch {
    return null;
  }
}

export async function savePersistedDashboardFeed(
  userId: string,
  articles: Article[],
  shownIds: string[]
): Promise<void> {
  const feed: PersistedDashboardFeed = { userId, articles, shownIds, savedAt: Date.now() };
  try {
    await AsyncStorage.setItem(feedKey(userId), JSON.stringify(feed));
  } catch {
    // A memory cache still keeps Dashboard stable for this app session.
  }
}

export async function clearPersistentStartupCache(userId?: string): Promise<void> {
  try {
    if (userId) {
      await AsyncStorage.multiRemove([snapshotKey(userId), feedKey(userId)]);
      return;
    }
    const keys = await AsyncStorage.getAllKeys();
    const keysToRemove = keys.filter((key) =>
      key.startsWith(STARTUP_SNAPSHOT_PREFIX) || key.startsWith(DASHBOARD_FEED_PREFIX)
    );
    if (keysToRemove.length > 0) await AsyncStorage.multiRemove(keysToRemove);
  } catch {
    // Account cleanup also removes all @subtick_ values as a final safeguard.
  }
}

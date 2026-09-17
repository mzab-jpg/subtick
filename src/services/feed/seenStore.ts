// ============================================================
// SubTick — Feed: Seen Article Store
// Local AsyncStorage record of read articles (capped at 1000),
// cached metadata for offline History rendering, and cross-device
// Firestore sync via arrayUnion.
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db } from '../firebase';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { Article } from '../../types';
import { ArticleMeta } from './articleMeta';
import { SEEN_ARTICLES_KEY, SEEN_ARTICLES_META_KEY } from '../../utils/constants';
import { feedStorageMutex } from './storageMutex';
import { removeArticleFromCachedDashboardFeed } from '../dashboardFeedCache';

/**
 * Get seen article IDs from local AsyncStorage, optionally merging with
 * already-known server-side IDs. This avoids a redundant Firestore read
 * when the caller already has the user profile (e.g. via onSnapshot or
 * UserContext) and can pass in the server-side seenArticleIds directly.
 */
export async function getSeenArticleIdsLocally(serverSeenIds?: string[]): Promise<string[]> {
  return feedStorageMutex.enqueue(async () => {
    try {
      const raw = await AsyncStorage.getItem(SEEN_ARTICLES_KEY);
      const localIds: string[] = raw ? JSON.parse(raw) : [];

      if (serverSeenIds && serverSeenIds.length > 0) {
        const merged = Array.from(new Set([...localIds, ...serverSeenIds]));
        if (merged.length > 1000) {
          return merged.slice(merged.length - 1000);
        }
        return merged;
      }

      return localIds;
    } catch {
      return [];
    }
  });
}

/**
 * Mark an article as seen and cache its metadata for instant offline History list rendering.
 * Serialized in the feed storage queue to prevent rapid swiping race conditions.
 */
export async function markArticleSeen(articleId: string, article?: Article): Promise<void> {
  return feedStorageMutex.enqueue(async () => {
    try {
      const raw = await AsyncStorage.getItem(SEEN_ARTICLES_KEY);
      const seen: string[] = raw ? JSON.parse(raw) : [];

      // Avoid duplicates
      if (!seen.includes(articleId)) {
        seen.push(articleId);
        // Cap at 1000
        if (seen.length > 1000) {
          seen.splice(0, seen.length - 1000);
        }
        await AsyncStorage.setItem(SEEN_ARTICLES_KEY, JSON.stringify(seen));

        // The Dashboard remains mounted behind Reader. Remove only this opened
        // card from its in-memory cache so returning never suggests it again.
        const cachedUserId = auth.currentUser?.uid;
        if (cachedUserId) removeArticleFromCachedDashboardFeed(cachedUserId, articleId);

        // Cross-device seen-ID sync is deliberately background work. Local
        // AsyncStorage/History is authoritative for immediate Reader dismissal.
        const userId = auth.currentUser?.uid;
        if (userId) {
          void updateDoc(doc(db, 'users', userId), {
            seenArticleIds: arrayUnion(articleId),
            lastUpdated: Date.now(),
          }).catch((firestoreErr) => {
            console.warn('[FeedService] Failed to sync seen article to Firestore:', firestoreErr);
          });
        }
      }

      // Also cache metadata so History can render without Firestore
      if (article) {
        const metaRaw = await AsyncStorage.getItem(SEEN_ARTICLES_META_KEY);
        const metas: Record<string, ArticleMeta> = metaRaw ? JSON.parse(metaRaw) : {};
        metas[articleId] = {
          id: articleId,
          title: article.title,
          publicationName: article.publicationName,
          category: article.category,
          estimatedReadMinutes: article.estimatedReadMinutes,
          seenAt: Date.now(),
        };
        await AsyncStorage.setItem(SEEN_ARTICLES_META_KEY, JSON.stringify(metas));
      }
    } catch (error) {
      console.error('[FeedService] markArticleSeen error:', error);
    }
  });
}

/**
 * Get cached metadata for seen articles (ordered most-recent first by seen IDs order).
 * Returns only articles that have cached metadata; any legacy IDs without metadata are skipped.
 */
export async function getSeenArticleMetas(limit = 30): Promise<ArticleMeta[]> {
  try {
    const [idsRaw, metaRaw] = await Promise.all([
      AsyncStorage.getItem(SEEN_ARTICLES_KEY),
      AsyncStorage.getItem(SEEN_ARTICLES_META_KEY),
    ]);
    const ids: string[] = idsRaw ? JSON.parse(idsRaw) : [];
    const metas: Record<string, ArticleMeta> = metaRaw ? JSON.parse(metaRaw) : {};
    // Most recent first (ids are stored oldest→newest so we reverse)
    return ids
      .slice(-limit)
      .reverse()
      .filter(id => !!metas[id])
      .map(id => metas[id]);
  } catch {
    return [];
  }
}

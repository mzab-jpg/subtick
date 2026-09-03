// ============================================================
// SubTick — Feed: Saved Article Store
// Local AsyncStorage record of bookmarked articles (with full
// sanitized HTML for offline reads), cached metadata, Firestore
// mirroring, and offline retry of failed save mirrors.
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db } from '../firebase';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { Article } from '../../types';
import { ArticleMeta } from './articleMeta';
import {
  SAVED_ARTICLES_KEY,
  SAVED_ARTICLES_META_KEY,
  RSS_FAILED_KEY_PREFIX,
  PENDING_SAVE_MIRRORS_KEY,
} from '../../utils/constants';
import { feedStorageMutex } from './storageMutex';

/**
 * Get locally stored saved article IDs from AsyncStorage.
 * Uses the serialization queue to avoid reading mid-write.
 */
export async function getSavedArticleIds(): Promise<string[]> {
  return feedStorageMutex.enqueue(async () => {
    try {
      const raw = await AsyncStorage.getItem(SAVED_ARTICLES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
}

/**
 * Mark an article as saved, store its full sanitized HTML, and cache metadata for offline list rendering.
 * Serialized in the feed storage queue to prevent concurrent write collisions.
 */
export async function markArticleSaved(articleId: string, extractedHtml: string, article?: Article): Promise<void> {
  return feedStorageMutex.enqueue(async () => {
    try {
      const raw = await AsyncStorage.getItem(SAVED_ARTICLES_KEY);
      const saved: string[] = raw ? JSON.parse(raw) : [];

      if (!saved.includes(articleId)) {
        saved.push(articleId);
        await AsyncStorage.setItem(SAVED_ARTICLES_KEY, JSON.stringify(saved));
        // Save the personal copy of the HTML locally so it never hits the network or backend again
        await AsyncStorage.setItem(`@subtick_saved_html_${articleId}`, extractedHtml);

        // Also cache metadata so SavedReads can render without Firestore (fully offline)
        if (article) {
          const metaRaw = await AsyncStorage.getItem(SAVED_ARTICLES_META_KEY);
          const metas: Record<string, ArticleMeta> = metaRaw ? JSON.parse(metaRaw) : {};
          metas[articleId] = {
            id: articleId,
            title: article.title,
            publicationName: article.publicationName,
            category: article.category,
            estimatedReadMinutes: article.estimatedReadMinutes,
          };
          await AsyncStorage.setItem(SAVED_ARTICLES_META_KEY, JSON.stringify(metas));

          // C8 Fix: Firestore write is now inside the !saved.includes() guard so it only
          // fires when the article isn't already saved. Previously ran unconditionally on
          // every bookmark tap, even re-taps on already-saved articles.
          try {
            const userId = auth.currentUser?.uid;
            if (userId) {
              await setDoc(doc(db, 'users', userId, 'saved_articles', articleId), {
                id: articleId,
                title: article.title,
                author: article.author,
                publicationName: article.publicationName,
                publicationUrl: article.publicationUrl,
                feedUrl: article.feedUrl,
                category: article.category,
                lengthStyle: article.lengthStyle,
                description: article.description,
                publishDate: article.publishDate,
                wordCount: article.wordCount,
                estimatedReadMinutes: article.estimatedReadMinutes,
                savedAt: Date.now(),
              });
            }
          } catch (firestoreErr) {
            // Audit fix: queue the failed mirror for automatic retry on reconnect
            // instead of failing silently (the local save is unaffected).
            try {
              const outRaw = await AsyncStorage.getItem(PENDING_SAVE_MIRRORS_KEY);
              const outbox: Record<string, unknown>[] = outRaw ? JSON.parse(outRaw) : [];
              const payload: Record<string, unknown> = {
                id: articleId,
                title: article.title,
                author: article.author,
                publicationName: article.publicationName,
                publicationUrl: article.publicationUrl,
                feedUrl: article.feedUrl,
                category: article.category,
                lengthStyle: article.lengthStyle,
                description: article.description,
                publishDate: article.publishDate,
                wordCount: article.wordCount,
                estimatedReadMinutes: article.estimatedReadMinutes,
              };
              const filtered = outbox.filter((entry) => entry.id !== articleId);
              filtered.push(payload);
              await AsyncStorage.setItem(PENDING_SAVE_MIRRORS_KEY, JSON.stringify(filtered));
              console.warn('[FeedService] Save mirror queued for retry (offline or transient error).');
            } catch (outboxErr) {
              console.warn('[FeedService] Failed to queue pending save mirror:', outboxErr);
            }
            console.warn('[FeedService] Failed to write saved article to Firestore:', firestoreErr);
          }
        }
      }
    } catch (error) {
      console.error('[FeedService] markArticleSaved error:', error);
    }
  });
}

/**
 * Audit fix: retry queued save-mirror writes (created when a save's Firestore
 * copy failed while offline). Called from offlineManager on reconnect.
 * Entries for articles un-saved in the meantime are dropped.
 */
export async function flushPendingSaveMirrors(): Promise<number> {
  try {
    const userId = auth.currentUser?.uid;
    if (!userId) return 0;
    const outRaw = await AsyncStorage.getItem(PENDING_SAVE_MIRRORS_KEY);
    if (!outRaw) return 0;
    const outbox = JSON.parse(outRaw) as Record<string, unknown>[];
    if (outbox.length === 0) return 0;

    const savedRaw = await AsyncStorage.getItem(SAVED_ARTICLES_KEY);
    const savedIds: string[] = savedRaw ? JSON.parse(savedRaw) : [];

    const remaining: Record<string, unknown>[] = [];
    let synced = 0;
    for (const entry of outbox) {
      if (!savedIds.includes(String(entry.id))) continue; // un-saved since queueing
      try {
        await setDoc(
          doc(db, 'users', userId, 'saved_articles', String(entry.id)),
          { ...entry, savedAt: entry.savedAt ?? Date.now() }
        );
        synced++;
      } catch {
        remaining.push(entry);
      }
    }
    await AsyncStorage.setItem(PENDING_SAVE_MIRRORS_KEY, JSON.stringify(remaining));
    if (synced > 0) {
      console.log(`[FeedService] Flushed ${synced} pending save mirror(s) to Firestore.`);
    }
    return synced;
  } catch (error) {
    console.warn('[FeedService] flushPendingSaveMirrors error:', error);
    return 0;
  }
}

/**
 * Get cached metadata for saved articles (ordered most-recently saved first).
 * Fully offline — no network or Firestore needed.
 */
export async function getSavedArticleMetas(): Promise<ArticleMeta[]> {
  try {
    const [idsRaw, metaRaw] = await Promise.all([
      AsyncStorage.getItem(SAVED_ARTICLES_KEY),
      AsyncStorage.getItem(SAVED_ARTICLES_META_KEY),
    ]);
    const ids: string[] = idsRaw ? JSON.parse(idsRaw) : [];
    const metas: Record<string, ArticleMeta> = metaRaw ? JSON.parse(metaRaw) : {};
    // Most recently saved first
    return ids
      .slice()
      .reverse()
      .filter(id => !!metas[id])
      .map(id => metas[id]);
  } catch {
    return [];
  }
}

/**
 * Unmark an article as saved and delete its local HTML and metadata.
 * Serialized in the feed storage queue to prevent concurrent write collisions.
 */
export async function unmarkArticleSaved(articleId: string): Promise<void> {
  return feedStorageMutex.enqueue(async () => {
    try {
      const raw = await AsyncStorage.getItem(SAVED_ARTICLES_KEY);
      const saved: string[] = raw ? JSON.parse(raw) : [];

      const index = saved.indexOf(articleId);
      if (index !== -1) {
        saved.splice(index, 1);
        await AsyncStorage.setItem(SAVED_ARTICLES_KEY, JSON.stringify(saved));
        await AsyncStorage.removeItem(`@subtick_saved_html_${articleId}`);
        // Audit fix: also drop any queued mirror retry for this article.
        try {
          const outRaw = await AsyncStorage.getItem(PENDING_SAVE_MIRRORS_KEY);
          if (outRaw) {
            const outbox = JSON.parse(outRaw) as Record<string, unknown>[];
            const filtered = outbox.filter((entry) => entry.id !== articleId);
            if (filtered.length !== outbox.length) {
              await AsyncStorage.setItem(PENDING_SAVE_MIRRORS_KEY, JSON.stringify(filtered));
            }
          }
        } catch (mirrorErr) {
          console.warn('[FeedService] Failed to update pending save mirror queue:', mirrorErr);
        }
        // Also clean up cached metadata
        const metaRaw = await AsyncStorage.getItem(SAVED_ARTICLES_META_KEY);
        if (metaRaw) {
          const metas: Record<string, ArticleMeta> = JSON.parse(metaRaw);
          delete metas[articleId];
          await AsyncStorage.setItem(SAVED_ARTICLES_META_KEY, JSON.stringify(metas));
        }

        // B4 Fix: Delete the Firestore server copy as well.
        // Previously only AsyncStorage was cleaned up, leaving an orphaned
        // document in users/{uid}/saved_articles/ forever.
        // Security rules already allow owner-delete on this subcollection.
        try {
          const userId = auth.currentUser?.uid;
          if (userId) {
            await deleteDoc(doc(db, 'users', userId, 'saved_articles', articleId));
          }
        } catch (firestoreErr) {
          // Best-effort — if the doc doesn't exist or the user is offline, ignore.
          console.warn('[FeedService] Failed to delete saved article from Firestore:', firestoreErr);
        }
      }
    } catch (error) {
      console.error('[FeedService] unmarkArticleSaved error:', error);
    }
  });
}

/**
 * Get locally stored saved HTML for an article.
 */
export async function getSavedArticleHtml(articleId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(`@subtick_saved_html_${articleId}`);
  } catch {
    return null;
  }
}

/**
 * Mark an article's RSS feed as permanently failed on this device.
 * Used as a replacement for writing rssStatus='archived' to Firestore,
 * which is blocked by security rules. This flag persists across sessions.
 */
export async function markRssFailed(articleId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(`${RSS_FAILED_KEY_PREFIX}${articleId}`, '1');
  } catch (error) {
    console.error('[FeedService] markRssFailed error:', error);
  }
}

/**
 * Check whether an article's RSS feed was previously marked as failed on this device.
 */
export async function isRssFailed(articleId: string): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(`${RSS_FAILED_KEY_PREFIX}${articleId}`);
    return val === '1';
  } catch {
    return false;
  }
}

// ============================================================
// SubTick — Feed Service
// Handles getRankedFeed callable, article fetching, and seen tracking.
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { functions, db } from './firebase';
import { httpsCallable } from 'firebase/functions';
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import { Article, RankedFeedResult } from '../types';
import { SEEN_ARTICLES_KEY, CANDIDATE_POOL_SIZE, MAX_FEED_ARTICLES } from '../utils/constants';
import { auth } from './firebase';

/**
 * Call the getRankedFeed Cloud Function (HTTPS Callable).
 * Falls back to a direct Firestore query if Functions are unavailable.
 */
export async function getRankedFeed(seenArticleIds: string[]): Promise<RankedFeedResult> {
  try {
    const getRankedFeedFn = httpsCallable<{ userId: string; seenArticleIds: string[] }, RankedFeedResult>(
      functions,
      'getRankedFeed'
    );
    const result = await getRankedFeedFn({
      userId: auth.currentUser?.uid || 'anonymous',
      seenArticleIds,
    });
    return result.data;
  } catch (error) {
    console.warn('[FeedService] getRankedFeed callable failed, falling back to Firestore:', error);
    return fallbackGetArticles();
  }
}

/**
 * Fallback: directly query Firestore for recent non-paywalled articles.
 */
async function fallbackGetArticles(): Promise<RankedFeedResult> {
  try {
    const articlesRef = collection(db, 'articles');
    const q = query(
      articlesRef,
      orderBy('publishDate', 'desc'),
      limit(MAX_FEED_ARTICLES * 2)
    );
    const snapshot = await getDocs(q);

    // Filter paywalled in memory (no index needed)
    const articles = snapshot.docs
      .map((doc) => ({ ...doc.data(), id: doc.id } as Article))
      .filter((a) => !a.isPaywalled);

    return {
      articles,
      generatedAt: Date.now(),
      remainingCount: articles.length,
    };
  } catch (error) {
    console.error('[FeedService] fallbackGetArticles error:', error);
    return {
      articles: [],
      generatedAt: Date.now(),
      remainingCount: 0,
    };
  }
}

/**
 * Fetch a single article by ID.
 */
export async function getArticleById(articleId: string): Promise<Article | null> {
  try {
    const snap = await getDoc(doc(db, 'articles', articleId));
    if (!snap.exists()) return null;
    return { ...snap.data(), id: snap.id } as Article;
  } catch (error) {
    console.error('[FeedService] getArticleById error:', error);
    return null;
  }
}

/**
 * Get locally stored seen article IDs from AsyncStorage.
 */
export async function getSeenArticleIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_ARTICLES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Mark an article as seen (append to local AsyncStorage list).
 * Keeps the list capped at 1000 entries to prevent storage bloat.
 */
export async function markArticleSeen(articleId: string): Promise<void> {
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
    }
  } catch (error) {
    console.error('[FeedService] markArticleSeen error:', error);
  }
}

/**
 * Increment article read count for the current user in Firestore.
 */
export async function incrementReadCount(): Promise<void> {
  try {
    const userId = auth.currentUser?.uid;
    if (!userId) return;
    const userRef = doc(db, 'users', userId);
    await setDoc(
      userRef,
      {
        totalArticlesRead: 1, // Will be merged/incremented via Cloud Function weightUpdater
        lastReadDate: Date.now(),
        lastUpdated: Date.now(),
      },
      { merge: true }
    );
  } catch (error) {
    console.error('[FeedService] incrementReadCount error:', error);
  }
}
// ============================================================
// SubTick — Feed: Ranked Feed
// Calls the getRankedFeed Cloud Function with the user's seen
// history; falls back to a direct Firestore query when the
// Cloud Function is unavailable.
// ============================================================

import { functions, db, auth, getClientId } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc } from 'firebase/firestore';
import { Article, RankedFeedResult } from '../../types';
import { MAX_FEED_ARTICLES } from '../../utils/constants';

/**
 * Call the getRankedFeed Cloud Function (HTTPS Callable).
 * Falls back to a direct Firestore query if Functions are unavailable.
 */
export async function getRankedFeed(seenArticleIds: string[]): Promise<RankedFeedResult> {
  try {
    const clientId = await getClientId();
    const getRankedFeedFn = httpsCallable<{ userId: string; seenArticleIds: string[]; client_id: string }, RankedFeedResult>(
      functions,
      'getRankedFeed'
    );

    // Send full seen history to server to ensure it correctly filters candidates.
    // capped at 1000 by AsyncStorage, which is only ~20KB.
    const result = await getRankedFeedFn({
      userId: auth.currentUser?.uid || 'anonymous',
      seenArticleIds: seenArticleIds,
      client_id: clientId,
    });

    const returnedFeed = result.data;

    // Bulletproof Client-Side Seen Filter:
    // We filter the 100 returned scored candidates against the user's FULL local seen list.
    // This completely prevents duplicates and works instantaneously on-device (<0.5ms).
    const seenSet = new Set(seenArticleIds);
    const filteredArticles = returnedFeed.articles.filter(article => !seenSet.has(article.id));

    return {
      articles: filteredArticles.slice(0, MAX_FEED_ARTICLES), // Return exactly 30 for the active queue
      generatedAt: returnedFeed.generatedAt,
      remainingCount: Math.max(0, filteredArticles.length - MAX_FEED_ARTICLES),
    };
  } catch (error) {
    console.warn('[FeedService] getRankedFeed callable failed, falling back to Firestore:', error);
    return fallbackGetArticles(seenArticleIds);
  }
}

/**
 * Fallback: directly query Firestore for recent non-paywalled articles.
 * Filters out already-seen articles so users don't see repeats even when the
 * Cloud Function is unavailable.
 */
async function fallbackGetArticles(seenArticleIds: string[] = []): Promise<RankedFeedResult> {
  try {
    const articlesRef = collection(db, 'articles');
    // This fallback must respect the same archived-content preference as the
    // backend. It is intentionally read from the signed-in user's profile rather
    // than trusting a caller-supplied value.
    let includeArchivedArticles = false;
    if (auth.currentUser) {
      const profile = await getDoc(doc(db, 'users', auth.currentUser.uid));
      includeArchivedArticles = profile.exists() && profile.data().includeArchivedArticles === true;
    }

    // Push the current-RSS restriction into Firestore when archived content is
    // disabled, so webpage-only records are never downloaded by this fallback.
    const constraints: any[] = [
      where('isPaywalled', '==', false),
      ...(includeArchivedArticles ? [] : [where('rssStatus', '==', 'current')]),
      orderBy('publishDate', 'desc'),
      limit(MAX_FEED_ARTICLES * 3),
    ];
    const q = query(articlesRef, ...constraints);
    const snapshot = await getDocs(q);

    const seenSet = new Set(seenArticleIds);

    // Filter out already-seen articles (paywall filter is now handled by Firestore)
    const articles = snapshot.docs
      .map((doc) => ({ ...doc.data(), id: doc.id } as Article))
      .filter((a) => !seenSet.has(a.id))
      .slice(0, MAX_FEED_ARTICLES);

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

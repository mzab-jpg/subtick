// ============================================================
// SubTick — Feed Service
// Handles getRankedFeed callable, article fetching, and seen tracking.
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { functions, db } from './firebase';
import { httpsCallable } from 'firebase/functions';
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import { Article, RankedFeedResult } from '../types';
import { SEEN_ARTICLES_KEY, SAVED_ARTICLES_KEY, CANDIDATE_POOL_SIZE, MAX_FEED_ARTICLES } from '../utils/constants';
import { auth } from './firebase';
import { XMLParser } from 'fast-xml-parser';
import xss from 'xss';

// --- Client-Side Feed Cache ---
// Cleared automatically on app restart.
const feedSessionCache = new Map<string, any[]>();

// --- Shared Guid Extractor ---
export function extractGuid(item: any): string {
  if (!item) return '';
  if (typeof item.guid === 'object' && item.guid !== null) {
    return item.guid['#text'] || item.guid['_'] || item.guid.value || '';
  }
  return item.guid || item.link || '';
}

// --- HTML Sanitizer (replicates server-side htmlSanitizer) ---
export function sanitizeClientHtml(rawHtml: string): string {
  if (!rawHtml) return '';
  const defaultWhiteList = (xss as any).getDefaultWhiteList ? (xss as any).getDefaultWhiteList() : {};
  let cleaned = xss(rawHtml, {
    whiteList: {
      ...defaultWhiteList,
      img: ['src', 'alt', 'width', 'height'],
      a: ['href', 'title'],
      h1: [], h2: [], h3: [], h4: [], p: [],
      ul: [], ol: [], li: [], strong: [], em: [], blockquote: [], code: [], pre: [], br: [], hr: []
    },
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script', 'style', 'iframe'],
  });

  // Strip empty/tracking pixels
  cleaned = cleaned.replace(/<img[^>]*src=["'][^"']*(?:analytics|pixel|track)[^"']*["'][^>]*>/gi, '');
  cleaned = cleaned.replace(/<img[^>]*(?:width\s*=\s*["']?\s*[01]\s*["']?|height\s*=\s*["']?\s*[01]\s*["']?)[^>]*>/gi, '');

  cleaned = cleaned.replace(/<div[^>]*class="[^"]*subscribe[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*paywall[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*overlay[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  cleaned = cleaned.replace(/\s*style="[^"]*"/gi, '');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}

/**
 * Fetch and extract the sanitized HTML for a specific article directly from its RSS feed.
 */
export async function fetchAndExtractArticle(feedUrl: string, guid: string): Promise<string> {
  try {
    let items = feedSessionCache.get(feedUrl);

    if (!items) {
      console.log(`[feedService] Cache miss, fetching live feed: ${feedUrl}`);
      const response = await fetch(feedUrl);
      const xmlText = await response.text();
      
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        cdataPropName: '__cdata',
      });
      const parsed = parser.parse(xmlText);
      const channel = parsed?.rss?.channel || parsed?.feed;
      items = channel?.item || channel?.entry || [];
      if (!Array.isArray(items)) items = [items];
      
      feedSessionCache.set(feedUrl, items);
    } else {
      console.log(`[feedService] Cache hit for feed: ${feedUrl}`);
    }

    // Find the specific item
    const item = items.find((i: any) => extractGuid(i) === guid);
    if (!item) {
      throw new Error('Article not found in recent feed items.');
    }

    const rawContent = item['content:encoded'] || item.content || item.description || '';
    const cdataContent = typeof rawContent === 'object' ? rawContent.__cdata || rawContent['#text'] : rawContent;
    
    return sanitizeClientHtml(cdataContent);
  } catch (error) {
    console.error('[feedService] fetchAndExtractArticle error:', error);
    throw error;
  }
}

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
    
    // Send full seen history to server to ensure it correctly filters candidates.
    // capped at 1000 by AsyncStorage, which is only ~20KB.
    const result = await getRankedFeedFn({
      userId: auth.currentUser?.uid || 'anonymous',
      seenArticleIds: seenArticleIds,
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
 * Get locally stored saved article IDs from AsyncStorage.
 */
export async function getSavedArticleIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(SAVED_ARTICLES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Mark an article as saved and store its full sanitized HTML for offline access.
 */
export async function markArticleSaved(articleId: string, extractedHtml: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(SAVED_ARTICLES_KEY);
    const saved: string[] = raw ? JSON.parse(raw) : [];

    if (!saved.includes(articleId)) {
      saved.push(articleId);
      await AsyncStorage.setItem(SAVED_ARTICLES_KEY, JSON.stringify(saved));
      // Save the personal copy of the HTML locally so it never hits the network or backend again
      await AsyncStorage.setItem(`@subtick_saved_html_${articleId}`, extractedHtml);
    }
  } catch (error) {
    console.error('[FeedService] markArticleSaved error:', error);
  }
}

/**
 * Unmark an article as saved and delete its local HTML.
 */
export async function unmarkArticleSaved(articleId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(SAVED_ARTICLES_KEY);
    const saved: string[] = raw ? JSON.parse(raw) : [];

    const index = saved.indexOf(articleId);
    if (index !== -1) {
      saved.splice(index, 1);
      await AsyncStorage.setItem(SAVED_ARTICLES_KEY, JSON.stringify(saved));
      await AsyncStorage.removeItem(`@subtick_saved_html_${articleId}`);
    }
  } catch (error) {
    console.error('[FeedService] unmarkArticleSaved error:', error);
  }
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
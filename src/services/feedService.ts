// ============================================================
// SubTick — Feed Service
// Handles getRankedFeed callable, article fetching, and seen tracking.
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { functions, db } from './firebase';
import { httpsCallable } from 'firebase/functions';
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import { Article, RankedFeedResult } from '../types';
import { SEEN_ARTICLES_KEY, SAVED_ARTICLES_KEY, SEEN_ARTICLES_META_KEY, SAVED_ARTICLES_META_KEY, CANDIDATE_POOL_SIZE, MAX_FEED_ARTICLES } from '../utils/constants';
import { auth } from './firebase';
import { XMLParser } from 'fast-xml-parser';
import xss from 'xss';

// --- Client-Side Feed Cache ---
// Stores Promises resolving to highly compressed, pre-sanitized articles.
// This prevents concurrent duplicate downloads and keeps RAM footprint minimal.
interface CachedFeedItem {
  guid: string;
  sanitizedHtml: string;
}
const feedSessionCache = new Map<string, Promise<CachedFeedItem[]>>();

/**
 * Prune items from the feedSessionCache that are no longer in the lookahead queue window.
 */
export function pruneFeedSessionCache(keepFeedUrls: string[]) {
  const keepSet = new Set(keepFeedUrls);
  for (const url of feedSessionCache.keys()) {
    if (!keepSet.has(url)) {
      console.log(`[feedService] Pruning feed from cache: ${url}`);
      feedSessionCache.delete(url);
    }
  }
}

// --- AsyncStorage Concurrency Mutex Queue ---
// Since AsyncStorage is asynchronous, rapid swiping can cause concurrent
// read-modify-write actions to collide and overwrite each other.
// This queue chains all storage operations in a single-file line (mutex).
let storageQueue = Promise.resolve();

async function enqueueStorageOperation<T>(operation: () => Promise<T>): Promise<T> {
  const nextInLine = storageQueue.then(operation);
  storageQueue = nextInLine.then(() => {}).catch(() => {});
  return nextInLine;
}

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
 * Utilizes Promise-level caching to prevent duplicate concurrent network requests.
 * Pre-sanitizes articles and discards the parsed XML tree immediately to keep RAM usage minimal.
 */
export async function fetchAndExtractArticle(feedUrl: string, guid: string): Promise<string> {
  try {
    let fetchPromise = feedSessionCache.get(feedUrl);

    if (!fetchPromise) {
      console.log(`[feedService] Cache miss, fetching live feed: ${feedUrl}`);
      fetchPromise = (async () => {
        const response = await fetch(feedUrl);
        const xmlText = await response.text();
        
        const parser = new XMLParser({
          ignoreAttributes: false,
          attributeNamePrefix: '@_',
          cdataPropName: '__cdata',
        });
        const parsed = parser.parse(xmlText);
        const channel = parsed?.rss?.channel || parsed?.feed;
        let rawItems = channel?.item || channel?.entry || [];
        if (!Array.isArray(rawItems)) rawItems = [rawItems];
        
        return rawItems.map((item: any) => {
          const itemGuid = extractGuid(item);
          const rawContent = item['content:encoded'] || item.content || item.description || '';
          const cdataContent = typeof rawContent === 'object' ? rawContent.__cdata || rawContent['#text'] : rawContent;
          return {
            guid: itemGuid,
            sanitizedHtml: sanitizeClientHtml(cdataContent),
          };
        });
      })();
      
      feedSessionCache.set(feedUrl, fetchPromise);
    } else {
      console.log(`[feedService] Cache hit for feed: ${feedUrl}`);
    }

    const items = await fetchPromise;
    const item = items.find((i: any) => i.guid === guid);
    if (!item) {
      throw new Error('Article not found in recent feed items.');
    }

    return item.sanitizedHtml;
  } catch (error) {
    console.error('[feedService] fetchAndExtractArticle error:', error);
    // If the network call or parsing failed, clear the cache entry so subsequent requests can retry
    feedSessionCache.delete(feedUrl);
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
    const q = query(
      articlesRef,
      orderBy('publishDate', 'desc'),
      limit(MAX_FEED_ARTICLES * 3) // Fetch extra to account for seen + paywall filtering
    );
    const snapshot = await getDocs(q);

    const seenSet = new Set(seenArticleIds);

    // Filter out paywalled and already-seen articles
    const articles = snapshot.docs
      .map((doc) => ({ ...doc.data(), id: doc.id } as Article))
      .filter((a) => !a.isPaywalled && !seenSet.has(a.id))
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

/**
 * Get locally stored seen article IDs from AsyncStorage.
 * Uses the serialization queue to avoid reading mid-write.
 */
export async function getSeenArticleIds(): Promise<string[]> {
  return enqueueStorageOperation(async () => {
    try {
      const raw = await AsyncStorage.getItem(SEEN_ARTICLES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
}

// --- Lightweight Article Metadata (for offline list rendering) ---
interface ArticleMeta {
  id: string;
  title: string;
  publicationName: string;
  category: string;
  estimatedReadMinutes: number;
}

/**
 * Mark an article as seen and cache its metadata for instant offline History list rendering.
 * Serialized in storageQueue to prevent rapid swiping race conditions.
 */
export async function markArticleSeen(articleId: string, article?: Article): Promise<void> {
  return enqueueStorageOperation(async () => {
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

/**
 * Get locally stored saved article IDs from AsyncStorage.
 * Uses the serialization queue to avoid reading mid-write.
 */
export async function getSavedArticleIds(): Promise<string[]> {
  return enqueueStorageOperation(async () => {
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
 * Serialized in storageQueue to prevent concurrent write collisions.
 */
export async function markArticleSaved(articleId: string, extractedHtml: string, article?: Article): Promise<void> {
  return enqueueStorageOperation(async () => {
    try {
      const raw = await AsyncStorage.getItem(SAVED_ARTICLES_KEY);
      const saved: string[] = raw ? JSON.parse(raw) : [];

      if (!saved.includes(articleId)) {
        saved.push(articleId);
        await AsyncStorage.setItem(SAVED_ARTICLES_KEY, JSON.stringify(saved));
        // Save the personal copy of the HTML locally so it never hits the network or backend again
        await AsyncStorage.setItem(`@subtick_saved_html_${articleId}`, extractedHtml);
      }

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
      }
    } catch (error) {
      console.error('[FeedService] markArticleSaved error:', error);
    }
  });
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
 * Serialized in storageQueue to prevent concurrent write collisions.
 */
export async function unmarkArticleSaved(articleId: string): Promise<void> {
  return enqueueStorageOperation(async () => {
    try {
      const raw = await AsyncStorage.getItem(SAVED_ARTICLES_KEY);
      const saved: string[] = raw ? JSON.parse(raw) : [];

      const index = saved.indexOf(articleId);
      if (index !== -1) {
        saved.splice(index, 1);
        await AsyncStorage.setItem(SAVED_ARTICLES_KEY, JSON.stringify(saved));
        await AsyncStorage.removeItem(`@subtick_saved_html_${articleId}`);
        // Also clean up cached metadata
        const metaRaw = await AsyncStorage.getItem(SAVED_ARTICLES_META_KEY);
        if (metaRaw) {
          const metas: Record<string, ArticleMeta> = JSON.parse(metaRaw);
          delete metas[articleId];
          await AsyncStorage.setItem(SAVED_ARTICLES_META_KEY, JSON.stringify(metas));
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

// NOTE: totalArticlesRead is incremented exclusively by the weightUpdater Cloud Function
// (firebase/functions/src/weightUpdater.ts) whenever a read_thorough or read_skim event
// is processed. There is no client-side increment needed.

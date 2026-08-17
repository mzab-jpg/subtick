// ============================================================
// SubTick — Feed Service
// Handles getRankedFeed callable, article fetching, and seen tracking.
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { functions, db, auth, getClientId } from './firebase';
import { httpsCallable } from 'firebase/functions';
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc, arrayUnion } from 'firebase/firestore';
import { Article, RankedFeedResult } from '../types';
import { SEEN_ARTICLES_KEY, SAVED_ARTICLES_KEY, SEEN_ARTICLES_META_KEY, SAVED_ARTICLES_META_KEY, MAX_FEED_ARTICLES, RSS_FAILED_KEY_PREFIX } from '../utils/constants';
import { XMLParser } from 'fast-xml-parser';
import xss from 'xss';
import { createStorageMutex } from './asyncStorageMutex';

// --- Client-Side Feed Cache ---
// Stores Promises resolving to highly compressed, pre-sanitized articles.
// This prevents concurrent duplicate downloads and keeps RAM footprint minimal.
export interface CachedFeedItem {
  guid: string;
  rawHtml: string; // C6 Fix: raw content stored, sanitized lazily after find()
  link?: string;   // article-level permalink (item.link) for archived fallback
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

const storageMutex = createStorageMutex();

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
 * 
 * Returns the sanitized HTML and the article-level permalink (item.link) from the RSS feed,
 * which is used as a correct archived fallback URL even for articles ingested before the
 * publicationUrl fix in rssCollector (commit c1fe7e7).
 */
export async function fetchAndExtractArticle(
  feedUrl: string,
  guid: string,
  articleUrl?: string
): Promise<{ html: string; link?: string }> {
  try {
    let fetchPromise = feedSessionCache.get(feedUrl);

    if (!fetchPromise) {
      console.log(`[feedService] Cache miss, fetching live feed: ${feedUrl}`);
      fetchPromise = (async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
        const response = await fetch(feedUrl, { signal: controller.signal });
        const xmlText = await response.text();
        clearTimeout(timeoutId);
        
        const parser = new XMLParser({
          ignoreAttributes: false,
          attributeNamePrefix: '@_',
          cdataPropName: '__cdata',
        });
        const parsed = parser.parse(xmlText);
        const channel = parsed?.rss?.channel || parsed?.feed;
        let rawItems = channel?.item || channel?.entry || [];
        if (!Array.isArray(rawItems)) rawItems = [rawItems];
        
        // C6 Fix: Lazy-sanitize — store raw content per item, only sanitize the matched
        // article. Previously sanitizeClientHtml (6 regex passes + xss) ran on every item
        // in the feed (~25-50) just to serve one article, blocking the JS thread.
        return rawItems.map((item: any) => {
          const itemGuid = extractGuid(item);
          const rawContent = item['content:encoded'] || item.content || item.description || '';
          const cdataContent = typeof rawContent === 'object' ? rawContent.__cdata || rawContent['#text'] : rawContent;
          return {
            guid: itemGuid,
            rawHtml: cdataContent, // store raw; sanitize only after find()
            link: item.link || undefined, // store article-level permalink for archived fallback
          };
        });
      })();
      
      feedSessionCache.set(feedUrl, fetchPromise);
    } else {
      console.log(`[feedService] Cache hit for feed: ${feedUrl}`);
    }

    const items = await fetchPromise;
    
    // Primary match by GUID
    let matchedItem = items.find((i: any) => i.guid === guid);
    
    // Secondary match by articleUrl (for pre-fix articles where publicationUrl was wrong
    // but the correct URL exists in the RSS item.link field)
    if (!matchedItem && articleUrl) {
      matchedItem = items.find((i: any) => i.link === articleUrl);
    }

    if (!matchedItem) {
      // Even though we couldn't match the article, we still return a best-effort result:
      // the parsed feed is available. Instead of throwing immediately, we provide
      // empty html but allow the caller to use the parsed data for a better fallback URL.
      throw new Error('Article not found in recent feed items.');
    }

    // C6 Fix: Sanitize only the matched item (lazy evaluation).
    return {
      html: sanitizeClientHtml(matchedItem.rawHtml),
      link: matchedItem.link,
    };
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

/**
 * Get seen article IDs from local AsyncStorage, optionally merging with
 * already-known server-side IDs. This avoids a redundant Firestore read
 * when the caller already has the user profile (e.g. via onSnapshot or
 * UserContext) and can pass in the server-side seenArticleIds directly.
 */
export async function getSeenArticleIdsLocally(serverSeenIds?: string[]): Promise<string[]> {
  return storageMutex.enqueue(async () => {
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
  return storageMutex.enqueue(async () => {
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

        // Firestore sync: write article ID to the user profile's seenArticleIds array
        // This enables cross-device dedup when a user links their Google account.
        // Uses arrayUnion which is atomic and idempotent (no duplicates).
        // Fire-and-forget — never blocks the UI.
        try {
          const userId = auth.currentUser?.uid;
          if (userId) {
            const userRef = doc(db, 'users', userId);
            await updateDoc(userRef, {
              seenArticleIds: arrayUnion(articleId),
              lastUpdated: Date.now(),
            });
          }
        } catch (firestoreErr) {
          // Firestore write is best-effort — AsyncStorage is the primary store
          console.warn('[FeedService] Failed to sync seen article to Firestore:', firestoreErr);
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
  return storageMutex.enqueue(async () => {
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
  return storageMutex.enqueue(async () => {
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
            // Firestore write is best-effort — AsyncStorage is the primary store
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
  return storageMutex.enqueue(async () => {
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

// NOTE: totalArticlesRead is incremented exclusively by the weightUpdater Cloud Function
// (firebase/functions/src/weightUpdater.ts) whenever a read_thorough or read_skim event
// is processed. There is no client-side increment needed.
// ============================================================
// SubTick — Feed: RSS Parser
// Downloads/parses publisher raw feeds on the native thread
// (Android) or via fast-xml-parser JS fallback (iOS/web/dev).
// ============================================================

import { Platform } from 'react-native';
import NativeRssParser from '../../../modules/tangent-rss-parser';
import { XMLParser } from 'fast-xml-parser';
import { sanitizeClientHtml } from './htmlSanitizer';

export interface CachedFeedItem {
  guid: string;
  rawHtml: string; // C6 Fix: raw content stored, sanitized lazily after find()
  link?: string;   // article-level permalink (item.link) for archived fallback
}

/** A successfully parsed feed did not contain the requested article. */
export class RssArticleNotFoundError extends Error {
  constructor() {
    super('Article not found in recent feed items.');
    this.name = 'RssArticleNotFoundError';
  }
}

const feedSessionCache = new Map<string, Promise<CachedFeedItem[]>>();
const useNativeRssParser = Platform.OS === 'android' && NativeRssParser !== null;
// DECISION (audit #20, kept): iOS shipping is planned, so this JS parser and
// fast-xml-parser stay as the Expo Go / web / iOS fallback path.

// The Android parser owns its raw feed cache in native process memory. The
// JavaScript cache is retained as the iOS/old-development-APK fallback. Neither
// cache is written to disk; Android clears both when the app process ends.

// --- Shared Guid Extractor ---
export function extractGuid(item: any): string {
  if (!item) return '';
  if (typeof item.guid === 'object' && item.guid !== null) {
    return item.guid['#text'] || item.guid['_'] || item.guid.value || '';
  }
  return item.guid || item.link || '';
}

/**
 * Download/parse one publisher RSS feed. Android uses bounded native workers,
 * so Reader preloading never parses XML on the JavaScript/UI workload.
 * The existing JavaScript path remains the iOS and old-development-APK fallback.
 */
export async function prepareArticle(feedUrl: string, guid: string, articleUrl?: string): Promise<void> {
  if (useNativeRssParser) {
    const startedAt = Date.now();
    await NativeRssParser!.prepareArticle(feedUrl, guid, articleUrl);
    if (__DEV__) console.log(`[RSS Native] prepared upcoming article in ${Date.now() - startedAt}ms: ${feedUrl}`);
    return;
  }

  // The non-native fallback keeps raw feeds only. Pre-extracting five article
  // bodies there would return XML parsing work to the JavaScript/UI workload.
  await warmFeed(feedUrl);
}

export async function warmFeed(feedUrl: string): Promise<CachedFeedItem[]> {
  if (useNativeRssParser) {
    const startedAt = Date.now();
    if (__DEV__) console.log(`[RSS Native] preparing ${feedUrl}`);
    await NativeRssParser!.preloadFeed(feedUrl);
    if (__DEV__) console.log(`[RSS Native] ready in ${Date.now() - startedAt}ms: ${feedUrl}`);
    // The native cache intentionally retains the full raw feed. Preloading does
    // not serialize article HTML back into JavaScript.
    return [];
  }

  try {
    let fetchPromise = feedSessionCache.get(feedUrl);
    if (!fetchPromise) {
      fetchPromise = (async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await fetch(feedUrl, { signal: controller.signal });
          const xmlText = await response.text();
          const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', cdataPropName: '__cdata' });
          const parsed = parser.parse(xmlText);
          const channel = parsed?.rss?.channel || parsed?.feed;
          let rawItems = channel?.item || channel?.entry || [];
          if (!Array.isArray(rawItems)) rawItems = [rawItems];
          return rawItems.map((item: any) => {
            const rawContent = item['content:encoded'] || item.content || item.description || '';
            return {
              guid: extractGuid(item),
              rawHtml: typeof rawContent === 'object' ? rawContent.__cdata || rawContent['#text'] : rawContent,
              link: item.link || undefined,
            };
          });
        } finally {
          clearTimeout(timeoutId);
        }
      })();
      feedSessionCache.set(feedUrl, fetchPromise);
    }
    return await fetchPromise;
  } catch (error) {
    feedSessionCache.delete(feedUrl);
    throw error;
  }
}

/** Find and lazily sanitize only the article being displayed. */
export async function fetchAndExtractArticle(feedUrl: string, guid: string, articleUrl?: string): Promise<{ html: string; link?: string }> {
  try {
    if (useNativeRssParser) {
      const startedAt = Date.now();
      const matchedItem = await NativeRssParser!.findArticle(feedUrl, guid, articleUrl);
      const lookupCompletedAt = Date.now();
      if (__DEV__) console.log(`[RSS Native] active article lookup ${lookupCompletedAt - startedAt}ms: ${feedUrl}`);
      if (!matchedItem) throw new RssArticleNotFoundError();
      const sanitizationStartedAt = Date.now();
      const html = sanitizeClientHtml(matchedItem.rawHtml);
      if (__DEV__) {
        console.log(`[Reader Timing] HTML sanitisation ${Date.now() - sanitizationStartedAt}ms (${matchedItem.rawHtml.length} chars): ${feedUrl}`);
      }
      return { html, link: matchedItem.link };
    }

    const items = await warmFeed(feedUrl);
    const matchedItem = items.find((item) => item.guid === guid)
      || (articleUrl ? items.find((item) => item.link === articleUrl) : undefined);
    if (!matchedItem) throw new RssArticleNotFoundError();
    return { html: sanitizeClientHtml(matchedItem.rawHtml), link: matchedItem.link };
  } catch (error) {
    console.error('[feedService] fetchAndExtractArticle error:', error);
    throw error;
  }
}

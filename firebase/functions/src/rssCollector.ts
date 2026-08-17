// ============================================================
// SubTick — rssCollector (Scheduled — every 3 hours)
// Parses dynamic RSS feeds from Firestore and writes new articles.
// ============================================================

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import Parser from 'rss-parser';
import { createHash } from 'crypto';
import { SUBSTACK_FEEDS, PAYWALL_KEYWORDS } from './constants.js';
import { Article, FeedSource } from './types.js';

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'SubTick/1.0 RSS Collector' },
});

const db = admin.firestore();

interface OgMetadata {
  headerImageUrl?: string;
  description?: string;
  author?: string;
  title?: string;
}

/**
 * Fallback metadata scraper that extracts Open Graph details from an article's live webpage.
 */
async function fetchOgMetadata(url: string): Promise<OgMetadata> {
  const metadata: OgMetadata = {};
  if (!url) return metadata;

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 6000); // 6 second timeout for scraper fallback

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    });
    clearTimeout(id);

    if (!response.ok) return metadata;
    const html = await response.text();

    // 1. og:image
    const ogImageMatch = 
      html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    if (ogImageMatch && ogImageMatch[1]) {
      metadata.headerImageUrl = ogImageMatch[1];
    }

    // Helper to decode basic HTML entities
    const decodeHtmlEntities = (str: string) => {
      return str
        .replace(/"/g, '"')
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');
    };

    // 2. og:description / twitter:description / name=description
    const ogDescMatch = 
      html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i) ||
      html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
    if (ogDescMatch && ogDescMatch[1]) {
      metadata.description = decodeHtmlEntities(ogDescMatch[1]).substring(0, 300);
    }

    // 3. author
    const authorMatch = 
      html.match(/<meta[^>]*name=["']author["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']author["']/i) ||
      html.match(/<meta[^>]*property=["']article:author["'][^>]*content=["']([^"']+)["']/i);
    if (authorMatch && authorMatch[1]) {
      metadata.author = decodeHtmlEntities(authorMatch[1]);
    }

    // 4. title fallback
    const ogTitleMatch = 
      html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i) ||
      html.match(/<title>([^<]+)<\/title>/i);
    if (ogTitleMatch && ogTitleMatch[1]) {
      metadata.title = decodeHtmlEntities(ogTitleMatch[1]).trim();
    }

  } catch (err: any) {
    console.log(`[rssCollector] OG metadata scrape failed for ${url}:`, err.message);
  }

  return metadata;
}

function generateArticleId(url: string, title: string): string {
  const hash = createHash('sha256').update(`${url}::${title}`).digest('hex');
  return `article_${hash.substring(0, 16)}`;
}

function calculateWordCount(htmlContent: string): number {
  if (!htmlContent) return 0;
  let text = htmlContent.replace(/<[^>]*>/g, ' ');
  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&[a-z]+;/gi, '');
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length === 0) return 0;
  return text.split(' ').length;
}

function estimateReadMinutes(wordCount: number): number {
  return Math.max(1, Math.ceil(wordCount / 250));
}

function extractFirstImage(html: string): string | undefined {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : undefined;
}

export function extractGuid(item: any): string {
  if (!item) return '';
  if (typeof item.guid === 'object' && item.guid !== null) {
    return item.guid['#text'] || item.guid['_'] || item.guid.value || '';
  }
  return item.guid || item.link || '';
}

function checkIsPaywalled(title: string, description: string, bodyHtml: string): boolean {
  const contentToCheck = `${title} ${description} ${bodyHtml}`.toLowerCase();
  
  const isPaywalled = PAYWALL_KEYWORDS.some((keyword) =>
    contentToCheck.includes(keyword.toLowerCase())
  );

  const hasPaywallClass =
    /class="[^"]*paywall[^"]*"/i.test(bodyHtml) ||
    /class="[^"]*subscriber-only[^"]*"/i.test(bodyHtml) ||
    /class="[^"]*locked-content[^"]*"/i.test(bodyHtml);

  const hasPaywallScript = /paywall/i.test(bodyHtml) && /<script/i.test(bodyHtml);

  return isPaywalled || hasPaywallClass || hasPaywallScript;
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Collect all active feeds, or only the supplied feed(s) for an admin's immediate
 * first collection. The scheduled job and dashboard flow share this exact path.
 */
export async function collectRssFeeds(feedOverride?: FeedSource[]): Promise<{ totalNew: number; totalErrors: number }> {
  console.log('[rssCollector] Starting RSS collection...');
  let totalNew = 0;
  let totalErrors = 0;

  // 1. Use a supplied feed for immediate admin collection, otherwise load the
  // active Firestore directory used by the scheduled job.
  let feedsList: FeedSource[] = feedOverride ? [...feedOverride] : [];
  if (!feedOverride) {
    try {
      const feedsSnap = await db.collection('feeds').get();
      feedsSnap.forEach((doc) => {
        const data = doc.data() as FeedSource;
        if (data.isActive !== false) {
          feedsList.push(data);
        }
      });
      console.log(`[rssCollector] Loaded ${feedsList.length} active feeds from Firestore 'feeds' collection.`);
    } catch (dbErr: any) {
      console.warn('[rssCollector] Failed to query Firestore feeds, falling back to static list:', dbErr.message);
    }
  }

  // 2. Fallback to static list only for the scheduled full-directory collection.
  if (!feedOverride && feedsList.length === 0) {
    console.log('[rssCollector] No active feeds found in Firestore. Using static SUBSTACK_FEEDS fallback.');
    feedsList = SUBSTACK_FEEDS.map(f => ({ ...f, isActive: true, forceArchived: false }));
  }

  // Process feeds concurrently in smaller batches of 5 to avoid connection issues or rate limits
  const feedChunks = chunkArray(feedsList, 5);

  for (const chunk of feedChunks) {
    await Promise.allSettled(
      chunk.map(async (feed) => {
        try {
          console.log(`[rssCollector] Fetching: ${feed.publicationName} (${feed.url})`);
          const feedData = await parser.parseURL(feed.url);

          if (!feedData.items || feedData.items.length === 0) {
            console.log(`[rssCollector] No items for ${feed.publicationName}`);
            return;
          }

          const activeGuids = new Set<string>();

          // C3 Fix: Batch-check article existence with a single getAll() call per feed
          // instead of one individual read per item. Reduces latency from N round trips
          // to 1 round trip (counted as N reads in billing, but far faster).
          const itemMeta = feedData.items.map(item => {
            const title = item.title || 'Untitled';
            const link = item.link || '';
            return {
              item,
              title,
              link,
              articleId: generateArticleId(link, title),
              guid: extractGuid(item),
            };
          });

          const articleRefs = itemMeta.map(m => db.collection('articles').doc(m.articleId));
          const existingDocs = articleRefs.length > 0
            ? await db.getAll(...articleRefs)
            : [];
          const existingIds = new Set(existingDocs.filter(d => d.exists).map(d => d.id));

          for (const { item, title: rawTitle, link, articleId, guid } of itemMeta) {
            try {
              let title = rawTitle;

              if (guid) activeGuids.add(guid);

              if (existingIds.has(articleId)) continue;

              const bodyHtml = item['content:encoded'] || item.content || item.description || '';
              let description = (item.contentSnippet || item.description || '').substring(0, 300);
              let author = item.creator || item['dc:creator'] || 'Unknown';
              let headerImageUrl = extractFirstImage(bodyHtml);

              // 3. Automated Web-Scraping Fallback for incomplete/missing metadata
              if (!headerImageUrl || !description || author === 'Unknown' || title === 'Untitled') {
                console.log(`[rssCollector] Missing metadata for "${title}". Scraping live webpage: ${link}`);
                const og = await fetchOgMetadata(link);
                
                if (!headerImageUrl && og.headerImageUrl) {
                  headerImageUrl = og.headerImageUrl;
                }
                if (!description && og.description) {
                  description = og.description;
                }
                if (author === 'Unknown' && og.author) {
                  author = og.author;
                }
                if (title === 'Untitled' && og.title) {
                  title = og.title;
                }
              }

              const wordCount = calculateWordCount(bodyHtml);
              let lengthStyle = 'medium';
              if (wordCount < 800) lengthStyle = 'short';
              else if (wordCount > 2000) lengthStyle = 'long';

              const isPaywalled = checkIsPaywalled(title, description, bodyHtml);
              
              // Self-check for truncated feed (if description is suspiciously close to full body)
              const isTruncatedFeed = bodyHtml.length > 0 && (description.length / bodyHtml.length) > 0.9;

              // 4. Layout Rule Support: if feed is forced to archived or is web-only/truncated
              const shouldForceArchived = feed.forceArchived === true;
              const rssStatus = shouldForceArchived ? 'archived' : 'current';

              const article: Record<string, any> = {
                id: articleId,
                title,
                author,
                publicationName: feed.publicationName,
                publicationUrl: item.link || guid,
                feedUrl: feed.url,
                category: feed.category,
                lengthStyle,
                guid,
                isTruncatedFeed,
                description,
                publishDate: item.pubDate ? new Date(item.pubDate).getTime() : Date.now(),
                cacheTimestamp: Date.now(),
                isPaywalled,
                wordCount,
                estimatedReadMinutes: estimateReadMinutes(wordCount),
                trendingScore: 0,
                qualityScore: feed.qualityScore,
                isSeed: false,
                rssStatus,
                // random_score: uniformly distributed [0,1) random number used for cheap random
                // sampling in cronUpdateCandidatePool. Refreshed daily by cronDecayTrendingScores
                // so the candidate pool never stagnates.
                random_score: Math.random(),
              };

              if (feed.frontendRules) {
                article.frontendRules = feed.frontendRules;
              }
              
              if (typeof headerImageUrl === 'string') {
                article.headerImageUrl = headerImageUrl;
              }

              await db.collection('articles').doc(articleId).set(article);
              totalNew++;
              console.log(`[rssCollector] New article: ${title.substring(0, 60)} (Status: ${rssStatus})`);
            } catch (itemError: any) {
              console.error(`[rssCollector] Item error for ${feed.publicationName}:`, itemError.message);
              totalErrors++;
            }
          }

          // C4 Fix: Delta-driven archive update.
          // Instead of scanning ALL articles for this feed (which grows unboundedly),
          // only query articles currently marked 'current'. Any that are no longer in
          // the live feed's activeGuids set need to be flipped to 'archived'.
          // Uses the existing feedUrl+rssStatus composite index — cost is proportional
          // only to the number of currently-active articles, not the full archive.
          try {
            const batch = db.batch();
            let archivedCount = 0;

            if (feed.forceArchived === true) {
              // Force-archived feed: flip all current articles to archived in one query.
              const currentSnap = await db.collection('articles')
                .where('feedUrl', '==', feed.url)
                .where('rssStatus', '==', 'current')
                .get();
              currentSnap.forEach(doc => {
                batch.update(doc.ref, { rssStatus: 'archived' });
                archivedCount++;
              });
            } else {
              // Normal feed: only look at currently-active articles.
              // Any whose GUID is not in the live feed snapshot gets archived.
              const currentSnap = await db.collection('articles')
                .where('feedUrl', '==', feed.url)
                .where('rssStatus', '==', 'current')
                .get();
              currentSnap.forEach(doc => {
                const data = doc.data() as Article;
                if (data.guid && !activeGuids.has(data.guid)) {
                  batch.update(doc.ref, { rssStatus: 'archived' });
                  archivedCount++;
                }
              });
            }

            if (archivedCount > 0) {
              await batch.commit();
              console.log(`[rssCollector] Status sync for ${feed.publicationName}: ${archivedCount} archived.`);
            }
          } catch (archiveErr: any) {
            console.error(`[rssCollector] Archive sync error for ${feed.publicationName}:`, archiveErr.message);
          }

        } catch (feedError: any) {
          console.error(`[rssCollector] Feed error for ${feed.publicationName}:`, feedError.message);
          totalErrors++;
        }
      })
    );
  }

  console.log(`[rssCollector] Complete. New articles: ${totalNew}, Errors: ${totalErrors}`);
  return { totalNew, totalErrors };
}

export const rssCollector = onSchedule({ schedule: 'every 3 hours', memory: '512MiB' }, async () => {
  await collectRssFeeds();
});

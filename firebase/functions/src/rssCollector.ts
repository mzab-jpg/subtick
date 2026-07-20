// ============================================================
// SubTick — rssCollector (Scheduled — every 3 hours)
// Parses 35 Substack RSS feeds and writes new articles to Firestore.
// ============================================================

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import Parser from 'rss-parser';
import { createHash } from 'crypto';
import { SUBSTACK_FEEDS, PAYWALL_KEYWORDS } from './constants.js';
import { Article } from './types.js';

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'SubTick/1.0 RSS Collector' },
});

const db = admin.firestore();

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

export const rssCollector = onSchedule('every 3 hours', async () => {
  console.log('[rssCollector] Starting RSS collection for 35 feeds...');
  let totalNew = 0;
  let totalErrors = 0;

  // Process feeds concurrently in smaller batches of 5 to avoid connection issues or Substack rate limits
  const feedChunks = chunkArray(SUBSTACK_FEEDS, 5);

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

          for (const item of feedData.items) {
            try {
              const title = item.title || 'Untitled';
              const link = item.link || '';
              const articleId = generateArticleId(link, title);
              const guid = extractGuid(item);
              
              if (guid) activeGuids.add(guid);

              const existing = await db.collection('articles').doc(articleId).get();
              if (existing.exists) continue;

              const bodyHtml = item['content:encoded'] || item.content || item.description || '';
              const description = (item.contentSnippet || item.description || '').substring(0, 300);
              const publishDate = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();
              const author = item.creator || item['dc:creator'] || 'Unknown';
              const headerImageUrl = extractFirstImage(bodyHtml);

              const wordCount = calculateWordCount(bodyHtml);
              let lengthStyle = 'medium';
              if (wordCount < 800) lengthStyle = 'short';
              else if (wordCount > 2000) lengthStyle = 'long';

              const isPaywalled = checkIsPaywalled(title, description, bodyHtml);
              
              // Self-check for truncated feed (if description is suspiciously close to full body)
              // Protect from potential divide-by-zero
              const isTruncatedFeed = bodyHtml.length > 0 && (description.length / bodyHtml.length) > 0.9;

              const article: Record<string, any> = {
                id: articleId,
                title,
                author,
                publicationName: feed.publicationName,
                publicationUrl: feedData.link || feed.url,
                feedUrl: feed.url,
                category: feed.category,
                lengthStyle,
                guid,
                isTruncatedFeed,
                description,
                publishDate,
                cacheTimestamp: Date.now(),
                isPaywalled,
                wordCount,
                estimatedReadMinutes: estimateReadMinutes(wordCount),
                trendingScore: 0,
                qualityScore: feed.qualityScore,
                isSeed: false,
                rssStatus: 'current',
              };
              
              // Only add headerImageUrl if it's a string (Firestore rejects undefined)
              if (typeof headerImageUrl === 'string') {
                article.headerImageUrl = headerImageUrl;
              }

              await db.collection('articles').doc(articleId).set(article);
              totalNew++;
              console.log(`[rssCollector] New article: ${title.substring(0, 60)}`);
            } catch (itemError: any) {
              console.error(`[rssCollector] Item error for ${feed.publicationName}:`, itemError.message);
              totalErrors++;
            }
          }

          // Post-processing: Tag older articles that fell off the RSS feed as 'archived', and fix legacy articles
          try {
            const allArticlesSnap = await db.collection('articles').where('feedUrl', '==', feed.url).get();
            const batch = db.batch();
            let archivedCount = 0;
            let currentUpdateCount = 0;

            allArticlesSnap.forEach((doc) => {
              const data = doc.data() as Article;
              if (data.guid && !activeGuids.has(data.guid) && data.rssStatus !== 'archived') {
                batch.update(doc.ref, { rssStatus: 'archived' });
                archivedCount++;
              } else if (data.guid && activeGuids.has(data.guid) && data.rssStatus !== 'current') {
                batch.update(doc.ref, { rssStatus: 'current' });
                currentUpdateCount++;
              }
            });

            if (archivedCount > 0 || currentUpdateCount > 0) {
              await batch.commit();
              console.log(`[rssCollector] Status sync for ${feed.publicationName}: ${archivedCount} archived, ${currentUpdateCount} updated to current.`);
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
});

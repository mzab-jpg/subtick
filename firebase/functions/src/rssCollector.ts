// ============================================================
// SubTick — rssCollector (Scheduled — every 4 hours)
// Parses 35 Substack RSS feeds and writes new articles to Firestore.
// ============================================================

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import Parser from 'rss-parser';
import { createHash } from 'crypto';
import { SUBSTACK_FEEDS } from './constants.js';
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

export const rssCollector = onSchedule('every 4 hours', async () => {
  console.log('[rssCollector] Starting RSS collection for 35 feeds...');
  let totalNew = 0;
  let totalErrors = 0;

  for (const feed of SUBSTACK_FEEDS) {
    try {
      console.log(`[rssCollector] Fetching: ${feed.publicationName} (${feed.url})`);
      const feedData = await parser.parseURL(feed.url);

      if (!feedData.items || feedData.items.length === 0) {
        console.log(`[rssCollector] No items for ${feed.publicationName}`);
        continue;
      }

      for (const item of feedData.items) {
        try {
          const title = item.title || 'Untitled';
          const link = item.link || '';
          const articleId = generateArticleId(link, title);

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

          const article: Record<string, any> = {
            id: articleId,
            title,
            author,
            publicationName: feed.publicationName,
            publicationUrl: feedData.link || feed.url,
            feedUrl: feed.url,
            category: feed.category,
            lengthStyle,
            bodyHtml,
            description,
            publishDate,
            cacheTimestamp: Date.now(),
            isPaywalled: false,
            wordCount,
            estimatedReadMinutes: estimateReadMinutes(wordCount),
            trendingScore: 0,
            qualityScore: feed.qualityScore,
            isSeed: false,
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
    } catch (feedError: any) {
      console.error(`[rssCollector] Feed error for ${feed.publicationName}:`, feedError.message);
      totalErrors++;
    }
  }

  console.log(`[rssCollector] Complete. New articles: ${totalNew}, Errors: ${totalErrors}`);
});
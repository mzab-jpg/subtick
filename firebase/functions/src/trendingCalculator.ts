// ============================================================
// SubTick — trendingCalculator (Scheduled — every 24 hours)
// Computes trending scores based on engagement metrics.
// ============================================================

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';

const db = admin.firestore();

export const trendingCalculator = onSchedule('every 24 hours', async () => {
  console.log('[trendingCalculator] Computing trending scores...');
  let updatedCount = 0;

  try {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const articlesSnapshot = await db
      .collection('articles')
      .where('publishDate', '>=', sevenDaysAgo)
      .get();

    if (articlesSnapshot.empty) {
      console.log('[trendingCalculator] No recent articles to score');
      return;
    }

    const eventsSnapshot = await db
      .collection('behavior_events')
      .where('timestamp', '>=', sevenDaysAgo)
      .get();

    const articleEngagement: Record<string, {
      reads: number; likes: number; saves: number;
      dwell5min: number; scroll80: number;
      uniqueUsers: Set<string>;
    }> = {};

    eventsSnapshot.forEach((doc) => {
      const event = doc.data();
      const articleId = event.articleId;
      if (!articleId) return;

      if (!articleEngagement[articleId]) {
        articleEngagement[articleId] = {
          reads: 0, likes: 0, saves: 0,
          dwell5min: 0, scroll80: 0,
          uniqueUsers: new Set(),
        };
      }

      const eng = articleEngagement[articleId];
      eng.uniqueUsers.add(event.userId);

      switch (event.eventType) {
        case 'swipe_next': eng.reads++; break;
        case 'like': eng.likes++; break;
        case 'save': eng.saves++; break;
        case 'dwell_5min': eng.dwell5min++; break;
        case 'scroll_80': eng.scroll80++; break;
      }
    });

    const batch = db.batch();
    let batchCount = 0;

    for (const [articleId, engagement] of Object.entries(articleEngagement)) {
      const rawScore =
        engagement.reads +
        engagement.likes * 2 +
        engagement.saves * 3 +
        engagement.dwell5min * 2 +
        engagement.scroll80 * 1.5;

      const userFactor = Math.log(engagement.uniqueUsers.size + 1);
      const trendingScore = Math.round((rawScore * userFactor) * 100) / 100;

      batch.update(db.collection('articles').doc(articleId), { trendingScore });
      batchCount++;
      if (batchCount >= 500) break;
    }

    if (batchCount > 0) await batch.commit();
    updatedCount = batchCount;
    console.log(`[trendingCalculator] Updated ${updatedCount} article trending scores`);
  } catch (error: any) {
    console.error('[trendingCalculator] Error:', error.message);
  }
});
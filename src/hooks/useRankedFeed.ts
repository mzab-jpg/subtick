// ============================================================
// SubTick — useRankedFeed Hook
// Manages feed state, queue, seen tracking, and pagination.
// Does NOT clear storage on mount — uses targeted reads only.
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { Article } from '../types';
import { getRankedFeed, getSeenArticleIds, markArticleSeen } from '../services/feedService';
import { MAX_FEED_ARTICLES } from '../utils/constants';

interface UseRankedFeedReturn {
  articles: Article[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  currentIndex: number;
  setCurrentIndex: (index: number) => void;
  hasNext: boolean;
  hasPrev: boolean;
  goToNext: () => void;
  goToPrev: () => void;
  refreshFeed: () => Promise<void>;
  markSeen: (articleId: string) => Promise<void>;
  isQueueExhausted: boolean;
  totalArticles: number;
}

export function useRankedFeed(initialArticles: Article[] = []): UseRankedFeedReturn {
  const [articles, setArticles] = useState<Article[]>(initialArticles);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isQueueExhausted, setIsQueueExhausted] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());

  // Load seen IDs once on mount
  useEffect(() => {
    (async () => {
      const seenIds = await getSeenArticleIds();
      seenRef.current = new Set(seenIds);
    })();
  }, []);

  // Load initial feed
  useEffect(() => {
    if (initialArticles.length === 0) {
      refreshFeed();
    }
  }, []);

  const refreshFeed = useCallback(async () => {
    try {
      setRefreshing(true);
      setError(null);
      const seenArray = Array.from(seenRef.current);
      const result = await getRankedFeed(seenArray);

      if (result.articles.length === 0) {
        setIsQueueExhausted(true);
        return;
      }

      setArticles(result.articles);
      setCurrentIndex(0);
      setIsQueueExhausted(false);
    } catch (err: any) {
      setError(err.message || 'Failed to load feed');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  const markSeen = useCallback(async (articleId: string) => {
    seenRef.current.add(articleId);
    await markArticleSeen(articleId);
  }, []);

  const hasNext = currentIndex < articles.length - 1;
  const hasPrev = currentIndex > 0;

  const goToNext = useCallback(() => {
    if (!hasNext) {
      // Queue exhausted — try loading more
      refreshFeed().then(() => {
        // If still no articles, mark exhausted
        if (articles.length === 0 || currentIndex >= articles.length - 1) {
          setIsQueueExhausted(true);
        }
      });
      return;
    }
    // Mark current as seen before advancing
    if (articles[currentIndex]) {
      markSeen(articles[currentIndex].id);
    }
    setCurrentIndex((prev) => Math.min(prev + 1, articles.length - 1));
  }, [hasNext, currentIndex, articles, markSeen, refreshFeed]);

  const goToPrev = useCallback(() => {
    if (!hasPrev) return;
    setCurrentIndex((prev) => Math.max(prev - 1, 0));
  }, [hasPrev]);

  // Guard: ensure currentIndex never goes out of bounds
  useEffect(() => {
    if (articles.length > 0 && currentIndex >= articles.length) {
      setCurrentIndex(articles.length - 1);
    }
    if (currentIndex < 0) {
      setCurrentIndex(0);
    }
  }, [articles.length, currentIndex]);

  return {
    articles,
    loading,
    refreshing,
    error,
    currentIndex,
    setCurrentIndex,
    hasNext,
    hasPrev,
    goToNext,
    goToPrev,
    refreshFeed,
    markSeen,
    isQueueExhausted,
    totalArticles: articles.length,
  };
}
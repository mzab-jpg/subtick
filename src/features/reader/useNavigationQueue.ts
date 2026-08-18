// ============================================================
// SubTick — useNavigationQueue Hook
// Extracted from ReaderScreen. Handles queue navigation,
// next/prev article switching, and background preloader triggers.
// ============================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import { getRankedFeed, getSeenArticleIdsLocally, getSavedArticleIds } from '../../services/feedService';
import { RecommendationContext } from '../../types';

interface UseNavigationQueueParams {
  queueArticleIds: string[];
  recommendationContexts?: Record<string, RecommendationContext>;
  startIndex: number;
  isRestrictedMode: boolean;
  loadArticle: (id: string) => Promise<void>;
  setIsSaved: (saved: boolean) => void;
  setIsLiked: (liked: boolean) => void;
  /** Server-side seen article IDs from the user profile (avoids a redundant Firestore read). */
  serverSeenIds?: string[];
}

interface UseNavigationQueueResult {
  activeQueueIds: string[];
  recommendationContexts: Record<string, RecommendationContext>;
  currentIndex: number;
  hasNext: boolean;
  hasPrev: boolean;
  queueExhausted: boolean;
  preloading: boolean;
  setQueueExhausted: (v: boolean) => void;
  /** Removes a failed future RSS card from this Reader session only. */
  removeUnavailableFutureArticle: (articleId: string) => void;
  goToNext: () => void;
  goToPrev: () => void;
}

export function useNavigationQueue({
  queueArticleIds,
  recommendationContexts: initialRecommendationContexts = {},
  startIndex,
  isRestrictedMode,
  loadArticle,
  setIsSaved,
  setIsLiked,
  serverSeenIds,
}: UseNavigationQueueParams): UseNavigationQueueResult {
  const [activeQueueIds, setQueueIds] = useState<string[]>(queueArticleIds || []);
  const [recommendationContexts, setRecommendationContexts] = useState<Record<string, RecommendationContext>>(initialRecommendationContexts);
  const [currentIndex, setCurrentIndex] = useState(startIndex ?? 0);
  const [queueExhausted, setQueueExhausted] = useState(false);
  const [preloading, setPreloading] = useState(false);

  const preloadingRef = useRef(false);

  const hasNext = currentIndex < activeQueueIds.length - 1;
  const hasPrev = currentIndex > 0;

  const removeUnavailableFutureArticle = useCallback((articleId: string) => {
    setQueueIds((previous) => {
      const articleIndex = previous.indexOf(articleId);
      // Never replace the current/tapped card or alter Reader history. This is
      // only a current-session removal for a future card whose RSS preparation
      // has already failed before it can block a swipe.
      if (articleIndex <= currentIndex) return previous;
      if (__DEV__) console.log(`[Reader Queue] removed unavailable future article: ${articleId}`);
      return previous.filter((id) => id !== articleId);
    });
    setRecommendationContexts((previous) => {
      if (!(articleId in previous)) return previous;
      const next = { ...previous };
      delete next[articleId];
      return next;
    });
  }, [currentIndex]);

  const preloadNextArticles = useCallback(async () => {
    if (preloadingRef.current) return;
    preloadingRef.current = true;
    setPreloading(true);

    try {
      // Recommendation replenishment must not start a behavior Cloud Function
      // upload while the person is actively swiping through Reader.
      const historicalSeen = await getSeenArticleIdsLocally(serverSeenIds);
      const combinedSeenIds = Array.from(new Set([...historicalSeen, ...activeQueueIds]));
      const result = await getRankedFeed(combinedSeenIds);

      if (result.articles && result.articles.length > 0) {
        const newIds = result.articles.map((a) => a.id);
        const newContexts = Object.fromEntries(
          result.articles
            .filter((article) => !!article.recommendationContext)
            .map((article) => [article.id, article.recommendationContext!])
        );
        setQueueIds((prev) => [...prev, ...newIds]);
        setRecommendationContexts((previous) => ({ ...previous, ...newContexts }));
      }
    } catch (error) {
      console.warn('[Preloader] Background preloading failed:', error);
    } finally {
      preloadingRef.current = false;
      setPreloading(false);
    }
  }, [activeQueueIds, serverSeenIds]);

  const goToNext = useCallback(() => {
    if (!hasNext) {
      setQueueExhausted(true);
      return;
    }

    const nextIndex = currentIndex + 1;
    const nextId = activeQueueIds[nextIndex];
    setCurrentIndex(nextIndex);
    setIsLiked(false);
    void loadArticle(nextId);

    if (!isRestrictedMode && activeQueueIds.length - nextIndex <= 5 && !preloadingRef.current) {
      void preloadNextArticles();
    }

    getSavedArticleIds().then((saved) => setIsSaved(saved.includes(nextId)));
  }, [hasNext, currentIndex, activeQueueIds, loadArticle, preloadNextArticles, isRestrictedMode, setIsSaved, setIsLiked]);

  const goToPrev = useCallback(() => {
    if (!hasPrev) return;
    const prevIdx = currentIndex - 1;
    setCurrentIndex(prevIdx);
    setIsLiked(false);

    getSavedArticleIds().then((saved) => setIsSaved(saved.includes(activeQueueIds[prevIdx])));
    loadArticle(activeQueueIds[prevIdx]);
  }, [hasPrev, currentIndex, activeQueueIds, loadArticle, setIsSaved, setIsLiked]);

  // Auto-recover from fast-swipe trap
  useEffect(() => {
    if (queueExhausted && currentIndex < activeQueueIds.length - 1) {
      setQueueExhausted(false);
      goToNext();
    }
  }, [queueExhausted, currentIndex, activeQueueIds.length, goToNext]);

  return {
    activeQueueIds,
    recommendationContexts,
    currentIndex,
    hasNext,
    hasPrev,
    queueExhausted,
    preloading,
    setQueueExhausted,
    removeUnavailableFutureArticle,
    goToNext,
    goToPrev,
  };
}
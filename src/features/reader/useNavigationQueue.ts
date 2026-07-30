// ============================================================
// SubTick — useNavigationQueue Hook
// Extracted from ReaderScreen. Handles queue navigation,
// next/prev article switching, and background preloader triggers.
// ============================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import { flushBehaviorQueue } from '../../services/behaviorSync';
import { getRankedFeed, getSeenArticleIdsLocally, getSavedArticleIds } from '../../services/feedService';

interface UseNavigationQueueParams {
  queueArticleIds: string[];
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
  currentIndex: number;
  hasNext: boolean;
  hasPrev: boolean;
  queueExhausted: boolean;
  preloading: boolean;
  setQueueExhausted: (v: boolean) => void;
  goToNext: () => void;
  goToPrev: () => void;
}

export function useNavigationQueue({
  queueArticleIds,
  startIndex,
  isRestrictedMode,
  loadArticle,
  setIsSaved,
  setIsLiked,
  serverSeenIds,
}: UseNavigationQueueParams): UseNavigationQueueResult {
  const [activeQueueIds, setQueueIds] = useState<string[]>(queueArticleIds || []);
  const [currentIndex, setCurrentIndex] = useState(startIndex ?? 0);
  const [queueExhausted, setQueueExhausted] = useState(false);
  const [preloading, setPreloading] = useState(false);

  const preloadingRef = useRef(false);

  const hasNext = currentIndex < activeQueueIds.length - 1;
  const hasPrev = currentIndex > 0;

  const preloadNextArticles = useCallback(async () => {
    if (preloadingRef.current) return;
    preloadingRef.current = true;
    setPreloading(true);

    try {
      flushBehaviorQueue().catch((e) => console.warn('[Preloader] Flush failed silently:', e));

      const historicalSeen = await getSeenArticleIdsLocally(serverSeenIds);
      const combinedSeenIds = Array.from(new Set([...historicalSeen, ...activeQueueIds]));
      const result = await getRankedFeed(combinedSeenIds);

      if (result.articles && result.articles.length > 0) {
        const newIds = result.articles.map((a) => a.id);
        setQueueIds((prev) => [...prev, ...newIds]);
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
    const nextIdx = currentIndex + 1;
    setCurrentIndex(nextIdx);

    setIsLiked(false);
    loadArticle(activeQueueIds[nextIdx]);

    if (!isRestrictedMode && activeQueueIds.length - nextIdx <= 5 && !preloadingRef.current) {
      preloadNextArticles();
    }

    getSavedArticleIds().then((saved) => setIsSaved(saved.includes(activeQueueIds[nextIdx])));
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
    currentIndex,
    hasNext,
    hasPrev,
    queueExhausted,
    preloading,
    setQueueExhausted,
    goToNext,
    goToPrev,
  };
}
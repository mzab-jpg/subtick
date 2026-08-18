// ============================================================
// SubTick — useArticleLoader Hook
// Extracted from ReaderScreen. Handles article fetching from
// Firestore + RSS, prefetching, and in-memory caching.
// ============================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import { Article } from '../../types';
import { db } from '../../services/firebase';
import { doc, getDoc } from 'firebase/firestore';
import {
  getSavedArticleHtml,
  fetchAndExtractArticle,
  RssArticleNotFoundError,
  prepareArticle,
} from '../../services/feedService';

interface UseArticleLoaderParams {
  articleId: string;
  isSavedMode: boolean;
  isMockMode: boolean;
  /** Raw publication pages are allowed only after the user opts in. */
  allowArchivedFallback: boolean;
  mockArticle?: Article;
  /** Called only after an exact future article body is fully prepared. */
  onArticlePrepared?: (articleId: string) => void;
}

interface UseArticleLoaderResult {
  article: Article | null;
  resolvedHtml: string;
  fetchError: boolean;
  /** The live RSS item is unavailable and raw webpages are not permitted. */
  unavailableFromRss: boolean;
  loading: boolean;
  /** True only after an article transition exceeds the no-flash delay. */
  slowLoading: boolean;
  /** Development timing for the currently requested Reader article. */
  articleTimingRef: React.MutableRefObject<{ id: string; startedAt: number; contentReadyAt?: number } | null>;
  rssResolvedLinkRef: React.MutableRefObject<string>;
  cacheRef: React.MutableRefObject<Record<string, Article>>;
  loadArticle: (id: string) => Promise<void>;
  prefetchArticles: (upcomingIds: string[]) => Promise<void>;
  cancelPrefetch: () => void;
}

export function useArticleLoader({
  articleId,
  isSavedMode,
  isMockMode,
  allowArchivedFallback,
  mockArticle,
  onArticlePrepared,
}: UseArticleLoaderParams): UseArticleLoaderResult {
  const [article, setArticle] = useState<Article | null>(null);
  const [resolvedHtml, setResolvedHtml] = useState<string>('');
  const [fetchError, setFetchError] = useState(false);
  const [unavailableFromRss, setUnavailableFromRss] = useState(false);
  const [loading, setLoading] = useState(true);
  const [slowLoading, setSlowLoading] = useState(false);

  const cacheRef = useRef<Record<string, Article>>({});
  const loadGenerationRef = useRef(0);
  const slowLoadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const articleTimingRef = useRef<{ id: string; startedAt: number; contentReadyAt?: number } | null>(null);
  const rssUnavailableIdsRef = useRef<Set<string>>(new Set());
  const rssResolvedLinkRef = useRef<string>('');
  const prefetchGenerationRef = useRef(0);
  const prefetchingRef = useRef(false);
  const activePrefetchIdsRef = useRef<string[]>([]);
  const pendingPrefetchIdsRef = useRef<string[] | null>(null);

  const loadArticle = useCallback(async (id: string) => {
    const generation = ++loadGenerationRef.current;
    const startedAt = Date.now();
    articleTimingRef.current = { id, startedAt };
    if (__DEV__) console.log(`[Reader Timing] requested ${id}`);
    const isCurrentLoad = () => generation === loadGenerationRef.current;
    if (slowLoadingTimerRef.current) clearTimeout(slowLoadingTimerRef.current);
    setLoading(true);
    setSlowLoading(false);
    // Do not flash a loading UI for cache-ready transitions. The existing Reader
    // remains visible until a request is genuinely slow.
    slowLoadingTimerRef.current = setTimeout(() => {
      if (isCurrentLoad()) setSlowLoading(true);
    }, 180);

    try {
      setFetchError(false);
      setUnavailableFromRss(false);
      rssResolvedLinkRef.current = '';

      if (isMockMode && mockArticle && id === mockArticle.id) {
        if (!isCurrentLoad()) return;
        setArticle(mockArticle);
        setResolvedHtml('');
        return;
      }

      let data = cacheRef.current[id];

      if (!data) {
        const snap = await getDoc(doc(db, 'articles', id));
        if (snap.exists()) {
          data = snap.data() as Article;
          cacheRef.current[id] = data;
        }
      }

      if (data) {
        let contentHtml = '';
        let needsFallback = false;

        if (isSavedMode) {
          const savedHtml = await getSavedArticleHtml(id);
          contentHtml = savedHtml || data.bodyHtml || '';
        } else if (data.rssStatus === 'archived') {
          if (!allowArchivedFallback) {
            // A stale queue can contain an archived item after the preference
            // changes. Reader silently advances instead of exposing a webpage.
            if (!isCurrentLoad()) return;
            setArticle(data);
            setResolvedHtml('');
            setUnavailableFromRss(true);
            return;
          }
          contentHtml = '';
        } else if (data.guid && data.feedUrl) {
          // Do not trust legacy device-persisted RSS failure flags here: earlier
          // versions recorded temporary network/queue delays as permanent misses.
          // Only this Reader session remembers a confirmed absent feed item.
          const alreadyMissing = rssUnavailableIdsRef.current.has(id);
          if (alreadyMissing) {
            needsFallback = true;
          } else {
            try {
              const result = await fetchAndExtractArticle(data.feedUrl, data.guid, data.publicationUrl);
              contentHtml = result.html;
              if (result.link) rssResolvedLinkRef.current = result.link;
            } catch (error) {
              // Only a confirmed missing item is permanent. Network delay,
              // cancellation, timeout, or native-worker failure stays retryable.
              if (error instanceof RssArticleNotFoundError) needsFallback = true;
              else throw error;
            }
          }
        } else {
          contentHtml = data.bodyHtml || '';
        }

        if (needsFallback) {
          if (!allowArchivedFallback) {
            // Never offer a raw webpage/browser escape when the user opted out.
            // Reader uses this explicit state to skip to its next queue item.
            rssUnavailableIdsRef.current.add(id);
            if (!isCurrentLoad()) return;
            setArticle(data);
            setResolvedHtml('');
            setUnavailableFromRss(true);
            return;
          }
          data.rssStatus = 'archived';
          contentHtml = '';
        }

        if (!isCurrentLoad()) return;
        const contentReadyAt = Date.now();
        articleTimingRef.current = { id, startedAt, contentReadyAt };
        if (__DEV__) {
          console.log(`[Reader Timing] content state ready ${contentReadyAt - startedAt}ms: ${id}`);
        }
        setResolvedHtml(contentHtml);
        setArticle(data);
      } else if (isCurrentLoad()) {
        setArticle(null);
        setFetchError(true);
      }
    } catch (error) {
      if (isCurrentLoad()) {
        console.error('[useArticleLoader] loadArticle error:', error);
        setFetchError(true);
      }
    } finally {
      if (isCurrentLoad()) {
        if (slowLoadingTimerRef.current) clearTimeout(slowLoadingTimerRef.current);
        slowLoadingTimerRef.current = null;
        setSlowLoading(false);
        setLoading(false);
      }
    }
  }, [isSavedMode, isMockMode, allowArchivedFallback, mockArticle]);

  const prefetchArticles = useCallback(async (upcomingIds: string[]) => {
    // Warm the rolling five upcoming Reader entries with at most two concurrent
    // native preparations. Article HTML is sanitized only when opened, keeping
    // XML parsing and speculative work off the Reader JavaScript/UI workload.
    if (prefetchingRef.current) {
      // A readiness reorder changes display order but not the five targets.
      // Keep their existing work alive instead of cancelling/restarting it.
      const activeIds = activePrefetchIdsRef.current;
      const sameTargets = activeIds.length === upcomingIds.length
        && activeIds.every((id) => upcomingIds.includes(id));
      if (sameTargets) return;

      // Reader position genuinely changed. Let in-flight native requests finish,
      // but replace unsubmitted stale targets with the newest five-item buffer.
      pendingPrefetchIdsRef.current = upcomingIds;
      prefetchGenerationRef.current += 1;
      return;
    }
    prefetchingRef.current = true;
    activePrefetchIdsRef.current = upcomingIds;
    const prefetchGeneration = ++prefetchGenerationRef.current;
    let nextTargetIndex = 0;

    const prepareNextTarget = async () => {
      while (prefetchGeneration === prefetchGenerationRef.current) {
        const id = upcomingIds[nextTargetIndex++];
        if (!id) return;
        if (rssUnavailableIdsRef.current.has(id)) continue;

        let data = cacheRef.current[id];
        if (!data) {
          try {
            const snap = await getDoc(doc(db, 'articles', id));
            if (!snap.exists()) continue;
            data = snap.data() as Article;
            cacheRef.current[id] = data;
          } catch {
            continue;
          }
        }

        if (isSavedMode || isMockMode || data.rssStatus !== 'current' || !data.feedUrl || !data.guid) continue;

        try {
          // Run at most two exact future targets at once. Android performs both
          // requests/parses off the Reader JS/UI workload; unrelated feed entries
          // and cleaned HTML remain unprepared.
          await prepareArticle(data.feedUrl, data.guid, data.publicationUrl);
          if (prefetchGeneration !== prefetchGenerationRef.current) return;
          // This is a completed preparation, not a prediction. Reader may now
          // safely bring it forward inside its bounded unseen window.
          onArticlePrepared?.(id);
        } catch {
          // Speculative preparation may fail due to temporary network or feed
          // conditions. The active request remains authoritative and retryable;
          // do not poison this article as unavailable before it is opened.
        }
      }
    };

    try {
      await Promise.all([prepareNextTarget(), prepareNextTarget()]);
    } catch (error) {
      console.warn('[useArticleLoader] Background prefetching failed:', error);
    } finally {
      // A newer Reader position may have replaced this target while one native
      // feed was running. Always start that newest buffer next, never the old one.
      prefetchingRef.current = false;
      activePrefetchIdsRef.current = [];
      const pendingIds = pendingPrefetchIdsRef.current;
      pendingPrefetchIdsRef.current = null;
      if (pendingIds) void prefetchArticles(pendingIds);
    }
  }, [isSavedMode, isMockMode, onArticlePrepared]);

  const cancelPrefetch = useCallback(() => {
    prefetchGenerationRef.current += 1;
    prefetchingRef.current = false;
    activePrefetchIdsRef.current = [];
    rssUnavailableIdsRef.current.clear();
    pendingPrefetchIdsRef.current = null;
  }, []);

  useEffect(() => {
    loadArticle(articleId);
  }, [articleId]);

  useEffect(() => () => {
    loadGenerationRef.current += 1;
    if (slowLoadingTimerRef.current) clearTimeout(slowLoadingTimerRef.current);
  }, []);

  return {
    article,
    resolvedHtml,
    fetchError,
    unavailableFromRss,
    loading,
    slowLoading,
    articleTimingRef,
    rssResolvedLinkRef,
    cacheRef,
    loadArticle,
    prefetchArticles,
    cancelPrefetch,
  };
}
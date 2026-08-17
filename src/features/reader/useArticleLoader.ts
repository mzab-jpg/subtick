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
  warmFeed,
  markRssFailed,
  isRssFailed,
} from '../../services/feedService';

interface UseArticleLoaderParams {
  articleId: string;
  isSavedMode: boolean;
  isMockMode: boolean;
  /** Raw publication pages are allowed only after the user opts in. */
  allowArchivedFallback: boolean;
  mockArticle?: Article;
}

interface UseArticleLoaderResult {
  article: Article | null;
  resolvedHtml: string;
  fetchError: boolean;
  /** The live RSS item is unavailable and raw webpages are not permitted. */
  unavailableFromRss: boolean;
  loading: boolean;
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
}: UseArticleLoaderParams): UseArticleLoaderResult {
  const [article, setArticle] = useState<Article | null>(null);
  const [resolvedHtml, setResolvedHtml] = useState<string>('');
  const [fetchError, setFetchError] = useState(false);
  const [unavailableFromRss, setUnavailableFromRss] = useState(false);
  const [loading, setLoading] = useState(true);

  const cacheRef = useRef<Record<string, Article>>({});
  const rssUnavailableIdsRef = useRef<Set<string>>(new Set());
  const rssResolvedLinkRef = useRef<string>('');
  const prefetchGenerationRef = useRef(0);
  const prefetchingRef = useRef(false);
  const pendingPrefetchIdsRef = useRef<string[] | null>(null);

  const loadArticle = useCallback(async (id: string) => {
    try {
      setLoading(true);
      setFetchError(false);
      setUnavailableFromRss(false);
      rssResolvedLinkRef.current = '';

      if (isMockMode && mockArticle && id === mockArticle.id) {
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
            setArticle(data);
            setResolvedHtml('');
            setUnavailableFromRss(true);
            return;
          }
          contentHtml = '';
        } else if (data.guid && data.feedUrl) {
          const alreadyFailed = rssUnavailableIdsRef.current.has(id) || await isRssFailed(id);
          if (alreadyFailed) {
            needsFallback = true;
          } else {
            try {
              const result = await fetchAndExtractArticle(data.feedUrl, data.guid, data.publicationUrl);
              contentHtml = result.html;
              if (result.link) rssResolvedLinkRef.current = result.link;
            } catch {
              needsFallback = true;
            }
          }
        } else {
          contentHtml = data.bodyHtml || '';
        }

        if (needsFallback) {
          await markRssFailed(id);
          if (!allowArchivedFallback) {
            // Never offer a raw webpage/browser escape when the user opted out.
            // Reader uses this explicit state to skip to its next queue item.
            rssUnavailableIdsRef.current.add(id);
            setArticle(data);
            setResolvedHtml('');
            setUnavailableFromRss(true);
            return;
          }
          data.rssStatus = 'archived';
          contentHtml = '';
        }

        setResolvedHtml(contentHtml);
        setArticle(data);
      } else {
        setArticle(null);
        setFetchError(true);
      }
    } catch (error) {
      console.error('[useArticleLoader] loadArticle error:', error);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [isSavedMode, isMockMode, allowArchivedFallback, mockArticle]);

  const prefetchArticles = useCallback(async (upcomingIds: string[]) => {
    // Warm only the next two Reader entries, one at a time. Raw RSS is shared
    // by feed URL; article HTML is sanitized only when the person opens it. This
    // keeps publisher downloads/parsing from competing with active reading.
    if (prefetchingRef.current) {
      // Reader position can change while the worker is warming its two entries.
      // Keep the latest two-item request for one follow-up pass rather than
      // starting concurrent downloads.
      pendingPrefetchIdsRef.current = upcomingIds;
      return;
    }
    prefetchingRef.current = true;
    const prefetchGeneration = ++prefetchGenerationRef.current;

    try {
      for (const id of upcomingIds) {
        if (prefetchGeneration !== prefetchGenerationRef.current) return;
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
          // Warm only the raw parsed feed. HTML sanitization waits until the
          // person actually opens this article, keeping scrolling lightweight.
          await warmFeed(data.feedUrl);
        } catch {
          // A missing item is remembered for this Reader session so it does not
          // repeatedly trigger a network attempt while the user advances.
          rssUnavailableIdsRef.current.add(id);
        }
      }
    } catch (error) {
      console.warn('[useArticleLoader] Background prefetching failed:', error);
    } finally {
      if (prefetchGeneration === prefetchGenerationRef.current) {
        prefetchingRef.current = false;
        const pendingIds = pendingPrefetchIdsRef.current;
        pendingPrefetchIdsRef.current = null;
        if (pendingIds) void prefetchArticles(pendingIds);
      }
    }
  }, [isSavedMode, isMockMode]);

  const cancelPrefetch = useCallback(() => {
    prefetchGenerationRef.current += 1;
    prefetchingRef.current = false;
    rssUnavailableIdsRef.current.clear();
    pendingPrefetchIdsRef.current = null;
  }, []);

  useEffect(() => {
    loadArticle(articleId);
  }, [articleId]);

  return {
    article,
    resolvedHtml,
    fetchError,
    unavailableFromRss,
    loading,
    rssResolvedLinkRef,
    cacheRef,
    loadArticle,
    prefetchArticles,
    cancelPrefetch,
  };
}
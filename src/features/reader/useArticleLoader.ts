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
  pruneFeedSessionCache,
  markRssFailed,
  isRssFailed,
} from '../../services/feedService';

interface UseArticleLoaderParams {
  articleId: string;
  isSavedMode: boolean;
  isMockMode: boolean;
  mockArticle?: Article;
}

interface UseArticleLoaderResult {
  article: Article | null;
  resolvedHtml: string;
  fetchError: boolean;
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
  mockArticle,
}: UseArticleLoaderParams): UseArticleLoaderResult {
  const [article, setArticle] = useState<Article | null>(null);
  const [resolvedHtml, setResolvedHtml] = useState<string>('');
  const [fetchError, setFetchError] = useState(false);
  const [loading, setLoading] = useState(true);

  const cacheRef = useRef<Record<string, Article>>({});
  const rssResolvedLinkRef = useRef<string>('');
  const prefetchGenerationRef = useRef(0);

  const loadArticle = useCallback(async (id: string) => {
    try {
      setLoading(true);
      setFetchError(false);
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
          contentHtml = '';
        } else if (data.guid && data.feedUrl) {
          const alreadyFailed = await isRssFailed(id);
          if (alreadyFailed) {
            needsFallback = true;
          } else {
            try {
              const result = await fetchAndExtractArticle(data.feedUrl, data.guid, data.publicationUrl);
              contentHtml = result.html;
              if (result.link) {
                rssResolvedLinkRef.current = result.link;
              }
            } catch {
              needsFallback = true;
            }
          }
        } else {
          contentHtml = data.bodyHtml || '';
        }

        if (needsFallback) {
          data.rssStatus = 'archived';
          contentHtml = '';
          await markRssFailed(id);
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
  }, [isSavedMode, isMockMode, mockArticle]);

  const prefetchArticles = useCallback(async (upcomingIds: string[]) => {
    // Work through a small queue one article at a time. This gives the immediate
    // next article first use of the network instead of competing with many RSS
    // downloads at once. The Reader effect cleanup invalidates stale queues.
    const prefetchGeneration = ++prefetchGenerationRef.current;
    const seenFeedUrls = new Set<string>();

    try {
      for (const id of upcomingIds) {
        if (prefetchGeneration !== prefetchGenerationRef.current) return;

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

        if (isSavedMode || isMockMode || data.rssStatus !== 'current' || !data.feedUrl || !data.guid) {
          continue;
        }

        // One RSS fetch warms every queued article from the same feed, so do
        // not repeat it while this sequential prefetch pass is still running.
        if (seenFeedUrls.has(data.feedUrl)) continue;
        seenFeedUrls.add(data.feedUrl);
        pruneFeedSessionCache([data.feedUrl]);

        try {
          await fetchAndExtractArticle(data.feedUrl, data.guid);
        } catch {
          // Background prefetch failures are non-fatal; normal article loading
          // still retries and falls back to the publication URL when necessary.
        }
      }
    } catch (error) {
      console.warn('[useArticleLoader] Background prefetching failed:', error);
    }
  }, [isSavedMode, isMockMode]);

  const cancelPrefetch = useCallback(() => {
    prefetchGenerationRef.current += 1;
  }, []);

  useEffect(() => {
    loadArticle(articleId);
  }, [articleId]);

  return {
    article,
    resolvedHtml,
    fetchError,
    loading,
    rssResolvedLinkRef,
    cacheRef,
    loadArticle,
    prefetchArticles,
    cancelPrefetch,
  };
}
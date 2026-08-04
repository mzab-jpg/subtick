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
    try {
      const metadataPromises = upcomingIds.map(async (id) => {
        if (cacheRef.current[id]) return cacheRef.current[id];
        try {
          const snap = await getDoc(doc(db, 'articles', id));
          if (snap.exists()) {
            const data = snap.data() as Article;
            cacheRef.current[id] = data;
            return data;
          }
        } catch {
          // Silent catch
        }
        return null;
      });

      const resolvedArticles = await Promise.all(metadataPromises);
      const activeArticles = resolvedArticles.filter((a): a is Article => a !== null);

      if (isSavedMode || isMockMode) return;

      const currentArticles = activeArticles.filter((a) => a.rssStatus === 'current');
      const uniqueFeedUrls = Array.from(
        new Set(currentArticles.map((a) => a.feedUrl).filter((url): url is string => !!url))
      );

      pruneFeedSessionCache(uniqueFeedUrls);

      await Promise.all(
        currentArticles.map(async (art) => {
          if (art.feedUrl && art.guid) {
            try {
              await fetchAndExtractArticle(art.feedUrl, art.guid);
            } catch {
              // Silent fail for background prefetch
            }
          }
        })
      );
    } catch (error) {
      console.warn('[useArticleLoader] Background prefetching failed:', error);
    }
  }, [isSavedMode, isMockMode]);

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
  };
}
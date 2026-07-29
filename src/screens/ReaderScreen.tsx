// ============================================================
// SubTick — Reader Screen
// WebView article shell + PanResponder edge zones + HUD.
// Uses useBehaviorTracker to queue swipes/likes/scrolls for
// syncBehaviorEvents → weightUpdater pipeline.
//
// Features: Real-Time Calibrating Infinite Preloader.
// When 5 articles are left in the queue, automatically flushes
// swipes, calibrates weights, fetches the next batch of fresh articles,
// and appends them cleanly in the background.
// ============================================================

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Animated,
  PanResponder,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme } from '../contexts/ThemeContext';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Article, RootStackParamList } from '../types';
import { db } from '../services/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { useBehaviorTracker } from '../hooks/useBehaviorTracker';
import { markArticleSeen, getRankedFeed, getSeenArticleIds, markArticleSaved, unmarkArticleSaved, getSavedArticleIds, fetchAndExtractArticle, getSavedArticleHtml, pruneFeedSessionCache, markRssFailed, isRssFailed } from '../services/feedService';
import { flushBehaviorQueue } from '../services/behaviorSync';
import { Linking } from 'react-native';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import { topInset, bottomInset } from '../utils/safeArea';
import { Platform } from 'react-native';
import { X, Bookmark, Compass, AlertCircle, Heart } from 'lucide-react-native';
import { TEXT_SM, TEXT_BASE, TEXT_LG, TEXT_2XL } from '../utils/constants';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const EDGE_ZONE_WIDTH = 45; // px — touch-intercepting margin zones (more sensitive)
const SWIPE_THRESHOLD = 40; // px — minimum horizontal swipe to trigger action (more sensitive)

export default function ReaderScreen() {
  const { colors, webViewCSS, isDark } = useTheme();
  const route = useRoute<RouteProp<RootStackParamList, 'Reader'>>();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();

  const { articleId, queueArticleIds, startIndex, userWpm, mode, mockArticle, mockHtml } = route.params;
  const currentWpm = userWpm || 250;
  const isHistoryMode = mode === 'history';
  const isSavedMode = mode === 'saved';
  // Mock mode disables tracking completely
  const isMockMode = !!mockArticle;
  const isRestrictedMode = isHistoryMode || isSavedMode || isMockMode;

  // --- State ---
  const [article, setArticle] = useState<Article | null>(null);
  const [resolvedHtml, setResolvedHtml] = useState<string>('');
  const [fetchError, setFetchError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(startIndex ?? 0);
  const [isLiked, setIsLiked] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [queueExhausted, setQueueExhausted] = useState(false);
  // HUD starts hidden — revealed only on tap or scroll-up
  const [hudVisible, setHudVisible] = useState(false);
  // Bug #4: Track WebView load errors for archived articles
  const [webViewLoadError, setWebViewLoadError] = useState(false);

  const hudTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleHudAutoHide = useCallback((visible: boolean, duration: number = 2500) => {
    if (hudTimeoutRef.current) {
      clearTimeout(hudTimeoutRef.current);
      hudTimeoutRef.current = null;
    }
    // Auto-hide after the specified duration
    if (visible) {
      hudTimeoutRef.current = setTimeout(() => {
        setHudVisible(false);
      }, duration);
    }
  }, []);

  useEffect(() => {
    // Cleanup only — HUD starts hidden, no auto-show on mount
    return () => {
      if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
    };
  }, [handleHudAutoHide]);

  // Sliding cache for instant swiping
  const [articleCache, setArticleCache] = useState<Record<string, Article>>({});

  // Dynamic preloaded queue (initially populated from Dashboard)
  const [activeQueueIds, setQueueIds] = useState<string[]>(queueArticleIds || []);
  const [preloading, setPreloading] = useState(false);

  // Guard references
  const preloadingRef = useRef(false);
  const cacheRef = useRef<Record<string, Article>>({});
  const panX = useRef(new Animated.Value(0)).current;
  // Fabric-safe: plain React state for progress bar width.
  // Animated.View with non-native-driver `width` crashes Fabric on RN 0.86.
  const [scrollProgress, setScrollProgress] = useState(0);
  const lastScrollProgressRef = useRef(0);
  const actualWordCountRef = useRef<number>(0);
  const webViewInitialLoadRef = useRef<boolean>(true);
  const webViewRef = useRef<WebView>(null);
  // Swipe pause detection — if finger stops moving for 200ms, the swipe is cancelled
  const swipeLastMoveTimeRef = useRef<number>(0);
  const SWIPE_PAUSE_THRESHOLD_MS = 200;
  // Stores the article-level permalink extracted from the RSS feed during
  // fetchAndExtractArticle. Used as the correct archived fallback URL when
  // the RSS fetch fails, fixing the bug where pre-fix articles (with incorrect
  // publicationUrl set to the publisher homepage) would load the publisher's
  // entire home feed instead of the specific article.
  const rssResolvedLinkRef = useRef<string>('');

  // Reset webview initial load guard whenever article changes
  useEffect(() => {
    webViewInitialLoadRef.current = true;
    setWebViewLoadError(false); // Reset error state on article change
  }, [currentIndex, articleId]);

  // --- Behavior tracker hook ---
  const behaviorTracker = useBehaviorTracker({
    articleId: article?.id || articleId,
    articleCategory: article?.category || 'misc',
    lengthStyle: article?.lengthStyle || 'medium',
    publicationName: article?.publicationName,
    enabled: !!article && !loading && !isRestrictedMode,
  });

  // --- Load article ---
  // B8 Fix: Add isMockMode and mockArticle to the dependency array — they were
  // previously missing even though the function closes over them.
  const loadArticle = useCallback(async (id: string) => {
    try {
      setLoading(true);
      setFetchError(false);
      setWebViewLoadError(false);
      // Reset the RSS-resolved link at the start of every article load.
      // This prevents carry-over from a previous article (e.g. when navigating
      // from a successfully-resolved article to an archived one, or when swiping
      // to an article whose RSS fetch fails). Without this reset, archivedArticleUrl
      // would incorrectly use the previous article's link.
      rssResolvedLinkRef.current = '';

      if (isMockMode && mockArticle && id === mockArticle.id) {
        setArticle(mockArticle);
        setResolvedHtml(mockHtml || '');
        return;
      }

      let data = cacheRef.current[id];

      if (!data) {
        const snap = await getDoc(doc(db, 'articles', id));
        if (snap.exists()) {
          data = snap.data() as Article;
          cacheRef.current[id] = data;
          setArticleCache(prev => ({ ...prev, [id]: data }));
        }
      }

      if (data) {
        let contentHtml = '';
        let needsFallback = false;

        if (isSavedMode) {
          const savedHtml = await getSavedArticleHtml(id);
          contentHtml = savedHtml || data.bodyHtml || '';
      } else if (data.rssStatus === 'archived') {
          // Archived articles do not exist in live RSS. We will load the publicationUrl directly.
          contentHtml = '';
        } else if (data.guid && data.feedUrl) {
          // P1-C Fix: Check local AsyncStorage flag before attempting RSS fetch.
          // This avoids repeatedly retrying feeds that have already failed,
          // without needing a Firestore write (which is blocked by security rules).
          const alreadyFailed = await isRssFailed(id);
          if (alreadyFailed) {
            console.log(`[Reader] Skipping RSS fetch for ${id} — previously marked failed in AsyncStorage.`);
            needsFallback = true;
          } else {
            try {
              const result = await fetchAndExtractArticle(data.feedUrl, data.guid, data.publicationUrl);
              contentHtml = result.html;
              // Capture the article-level permalink from the RSS feed item for correct
              // archived fallback. This fixes the bug where pre-fix articles (with incorrect
              // publicationUrl set to the publisher homepage) would load the publisher's
              // entire home feed instead of the specific article.
              if (result.link) {
                rssResolvedLinkRef.current = result.link;
              }
            } catch (rssError) {
              console.warn(`[Reader] RSS fetch failed for ${data.guid}, falling back to raw URI.`);
              needsFallback = true;
            }
          }
        } else {
          contentHtml = data.bodyHtml || '';
        }

        // P1-C Fix: If the RSS fetch fails, record this in AsyncStorage so future loads
        // skip the failed fetch. Firestore article updates are blocked by security rules,
        // so we use device-local storage instead. The flag is per-article and persists
        // across sessions on this device.
        if (needsFallback) {
          data.rssStatus = 'archived';
          contentHtml = '';
          await markRssFailed(id);
          console.log(`[Reader] Marked RSS as failed in AsyncStorage for article ${id}`);
        }

        setResolvedHtml(contentHtml);
        setArticle(data);
      } else {
        setArticle(null);
        setFetchError(true);
      }
    } catch (error) {
      console.error('[Reader] loadArticle error:', error);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [isSavedMode, isMockMode, mockArticle, mockHtml]);

  // --- Background Sliding Prefetcher (Definite Future Reads sliding-window) ---
  const prefetchArticles = useCallback(async (upcomingIds: string[]) => {
    try {
      // 1. Fetch metadata from Firestore for all upcoming articles in parallel
      const metadataPromises = upcomingIds.map(async (id) => {
        if (cacheRef.current[id]) return cacheRef.current[id];
        try {
          const snap = await getDoc(doc(db, 'articles', id));
          if (snap.exists()) {
            const data = snap.data() as Article;
            cacheRef.current[id] = data;
            setArticleCache(prev => ({ ...prev, [id]: data }));
            return data;
          }
        } catch (err) {
          // Silent catch
        }
        return null;
      });

      const resolvedArticles = await Promise.all(metadataPromises);
      const activeArticles = resolvedArticles.filter((a): a is Article => a !== null);

      if (isSavedMode || isMockMode) return; // Saved/Mock mode uses offline HTML, no live RSS fetches needed

      // Bug #6 Fix: Only fetch RSS feeds for explicitly 'current' articles.
      // Articles with undefined rssStatus are treated as archived to avoid wasteful failed fetches.
      const currentArticles = activeArticles.filter(a => a.rssStatus === 'current');

      // 2. Extract unique feedUrls for the upcoming window
      const uniqueFeedUrls = Array.from(
        new Set(currentArticles.map(a => a.feedUrl).filter((url): url is string => !!url))
      );

      // 3. Prune our local in-memory feed cache to only keep feeds that show up in the look-ahead window.
      pruneFeedSessionCache(uniqueFeedUrls);

      // 4. Concurrently fetch the unique RSS feeds
      await Promise.all(
        currentArticles.map(async (art) => {
          if (art.feedUrl && art.guid) {
            try {
              await fetchAndExtractArticle(art.feedUrl, art.guid);
            } catch (err) {
              // Silent fail for background prefetch
            }
          }
        })
      );
    } catch (error) {
      console.warn('[Reader] Background prefetching failed:', error);
    }
  }, [isSavedMode]);

  useEffect(() => {
    loadArticle(articleId);
  }, [articleId]);

  useEffect(() => {
    // Sliding look-ahead window: Scan the next 10 articles in the queue
    const upcomingIds = activeQueueIds.slice(currentIndex + 1, currentIndex + 11);
    if (upcomingIds.length > 0) {
      prefetchArticles(upcomingIds);
    }
  }, [currentIndex, activeQueueIds, prefetchArticles]);

  useEffect(() => {
    // Check initial saved state
    if (articleId) {
      getSavedArticleIds().then(saved => {
        setIsSaved(saved.includes(articleId));
      });
    }
  }, [articleId]);

  // --- Queue navigation helpers ---
  const hasNext = currentIndex < activeQueueIds.length - 1;
  const hasPrev = currentIndex > 0;

  /**
   * Real-Time Calibrating Background Preloader:
   * When 5 articles are left in the queue, we flush current swipes,
   * trigger weightUpdater, pull a fresh tailored batch of 30, and append it.
   */
  const preloadNextArticles = useCallback(async () => {
    if (preloadingRef.current) return;
    preloadingRef.current = true;
    setPreloading(true);
    console.log('[Preloader] Trigger zone reached. Synchronizing swipes & preloading next batch...');

    try {
      // Perf fix: fire-and-forget the flush — don't block the feed fetch waiting for
      // the Cloud Function to process events. The feed fetch and weight sync are independent.
      flushBehaviorQueue().catch(e => console.warn('[Preloader] Flush failed silently:', e));
      console.log('[Preloader] Behavior flush initiated (non-blocking). Fetching next batch...');

      const historicalSeen = await getSeenArticleIds();
      const combinedSeenIds = Array.from(new Set([...historicalSeen, ...activeQueueIds]));
      const result = await getRankedFeed(combinedSeenIds);

      if (result.articles && result.articles.length > 0) {
        const newIds = result.articles.map(a => a.id);
        setQueueIds(prev => [...prev, ...newIds]);
        console.log(`[Preloader] Preloaded and appended ${newIds.length} fresh articles to the queue.`);
      } else {
        console.log('[Preloader] No new recommendations available from cloud.');
      }
    } catch (error) {
      console.warn('[Preloader] Background preloading failed:', error);
    } finally {
      preloadingRef.current = false;
      setPreloading(false);
    }
  }, [activeQueueIds]);

  const goToNext = useCallback(() => {
    if (!hasNext) {
      setQueueExhausted(true);
      return;
    }
    const nextIdx = currentIndex + 1;
    setCurrentIndex(nextIdx);

    // Reset reader state
    setIsLiked(false);
    loadArticle(activeQueueIds[nextIdx]);

    // TRIGGER ZONE CHECK: If 5 articles or less are left, preload the next batch.
    if (!isRestrictedMode && activeQueueIds.length - nextIdx <= 5 && !preloadingRef.current) {
      preloadNextArticles();
    }

    // Set saved state for next article after checking storage
    getSavedArticleIds().then(saved => setIsSaved(saved.includes(activeQueueIds[nextIdx])));
  }, [hasNext, currentIndex, activeQueueIds, loadArticle, preloadNextArticles, isRestrictedMode]);

  const goToPrev = useCallback(() => {
    if (!hasPrev) return;
    const prevIdx = currentIndex - 1;
    setCurrentIndex(prevIdx);
    setIsLiked(false);

    getSavedArticleIds().then(saved => setIsSaved(saved.includes(activeQueueIds[prevIdx])));
    loadArticle(activeQueueIds[prevIdx]);
  }, [hasPrev, currentIndex, activeQueueIds, loadArticle]);

  // --- WebView scroll message handler ---
  const handleWebViewMessage = useCallback(
    (event: any) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === 'scrollDepth' && typeof data.depth === 'number') {
          const depth = Math.min(1, Math.max(0, data.depth));
          behaviorTracker.trackScrollDepth(depth);

          if (typeof data.currentDepth === 'number') {
            const current = Math.min(1, Math.max(0, data.currentDepth));
            // Throttle to 1% steps — prevents 50-100 re-renders per article
            const rounded = Math.round(current * 100) / 100;
            if (rounded !== lastScrollProgressRef.current) {
              lastScrollProgressRef.current = rounded;
              setScrollProgress(rounded);
            }
          }
        } else if (data.type === 'wordCount' && typeof data.count === 'number') {
          actualWordCountRef.current = data.count;
        } else if (data.type === 'hud') {
          setHudVisible(data.visible);
          if (data.visible) {
            handleHudAutoHide(true, 2500);
          } else {
            if (hudTimeoutRef.current) {
              clearTimeout(hudTimeoutRef.current);
              hudTimeoutRef.current = null;
            }
          }
        } else if (data.type === 'hudToggle') {
          setHudVisible((prev) => {
            const next = !prev;
            if (next) {
              handleHudAutoHide(true, 2500);
            } else {
              if (hudTimeoutRef.current) {
                clearTimeout(hudTimeoutRef.current);
                hudTimeoutRef.current = null;
              }
            }
            return next;
          });
        }
      } catch {
        // Ignore non-JSON messages
      }
    },
    [behaviorTracker, scrollProgress, handleHudAutoHide]
  );

  // --- PanResponder for edge swipe zones ---
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (evt) => {
          if (isHistoryMode) return false;
          const x = evt.nativeEvent.locationX;
          return x <= EDGE_ZONE_WIDTH || x >= SCREEN_WIDTH - EDGE_ZONE_WIDTH;
        },
        onMoveShouldSetPanResponder: (evt, gestureState) => {
          return Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
        },
        onPanResponderMove: (evt, gestureState) => {
          panX.setValue(gestureState.dx);
          // Track the last time the finger moved significantly
          if (Math.abs(gestureState.dx) > 5) {
            swipeLastMoveTimeRef.current = Date.now();
          }
        },
        onPanResponderRelease: (evt, gestureState) => {
          const dx = gestureState.dx;
          Animated.spring(panX, { toValue: 0, useNativeDriver: true }).start();

          // If the user paused mid-swipe (finger stopped moving for 200ms+), cancel the swipe
          const timeSinceLastMove = Date.now() - swipeLastMoveTimeRef.current;
          if (timeSinceLastMove > SWIPE_PAUSE_THRESHOLD_MS) {
            return; // Abort — user paused, treat as cancelled swipe
          }

          if (dx < -SWIPE_THRESHOLD) {
            if (!isRestrictedMode) {
              const expectedReadTimeMs = article?.wordCount ? (article.wordCount / currentWpm) * 60000 : 60000;
              behaviorTracker.concludeSession(expectedReadTimeMs, actualWordCountRef.current);
              // Pass article object so metadata is cached for the History screen (no Firestore needed)
              if (article?.id) markArticleSeen(article.id, article);
            }
            goToNext();
          } else if (dx > SWIPE_THRESHOLD) {
            // B5 Fix: Allow right-swipe to navigate backwards in both saved and history modes.
            // Previously only isSavedMode was handled; isHistoryMode fell through to !isRestrictedMode
            // which is false for history, creating a dead-zone right swipe.
            if (isSavedMode || isHistoryMode) {
              goToPrev();
            } else if (!isRestrictedMode) {
              behaviorTracker.trackEvent('swipe_not_interested');
              if (article?.id) markArticleSeen(article.id, article);
              goToNext();
            }
          }
        },
      }),
    [goToNext, goToPrev, behaviorTracker, panX, article, isRestrictedMode, isSavedMode, isHistoryMode]
  );

  // --- HUD Fade Animation (useNativeDriver: true — Fabric-safe) ---
  const hudAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(hudAnim, {
      toValue: hudVisible ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [hudVisible, hudAnim]);

  const hudOpacity = hudAnim;

  const hudTranslateY = hudAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-100, 0],
    extrapolate: 'clamp',
  });

  // P1-D Fix: Escape HTML special characters in metadata fields before inserting into WebView HTML.
  // article.title, publicationName, and author come from RSS and must not be trusted as safe HTML.
  const escapeHtml = (str: string): string => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  // B9 Fix: Inject CSS updates dynamically when the theme changes instead of rebuilding
  // the entire HTML string. Previously, colors/webViewCSS were in the articleHTML memo
  // deps, so every theme toggle caused a full WebView reload (losing scroll position).
  // Now articleHTML only rebuilds when the article content changes. Theme updates are
  // pushed into the already-loaded WebView via injectJavaScript.
  useEffect(() => {
    if (!webViewRef.current || !article) return;
    // Inject a <style> tag update into the existing WebView page without reloading it.
    const cssUpdateScript = `
      (function() {
        var existing = document.getElementById('__tangent_theme__');
        if (existing) existing.remove();
        var s = document.createElement('style');
        s.id = '__tangent_theme__';
        s.innerHTML = ${JSON.stringify(webViewCSS.replace(/<\/?style>/g, ''))};
        document.head.appendChild(s);
      })();
      true;
    `;
    webViewRef.current.injectJavaScript(cssUpdateScript);
  }, [colors, webViewCSS]);

  // --- Pre-compiled HTML for WebView ---
  // B9 Fix: colors and webViewCSS removed from deps — theme changes are handled by
  // the CSS injection effect above without triggering a full page reload.
  const articleHTML = useMemo(() => {
    if (!article) return '';
    const readMinutes = Math.max(1, Math.ceil((article.wordCount || 0) / currentWpm));
    const frontendRules = article.frontendRules;

    const safeTitle = escapeHtml(article.title);
    const safePublicationName = escapeHtml(article.publicationName);
    const safeAuthor = escapeHtml(article.author);

    const publishDate = article.publishDate ? new Date(article.publishDate) : null;
    const formattedDate = publishDate
      ? `${String(publishDate.getDate()).padStart(2, '0')}/${String(publishDate.getMonth() + 1).padStart(2, '0')}`
      : '';

    const titleBlock = `<h1 style="color:${colors.text}; margin-bottom:16px;">${safeTitle}</h1>`;
    const authorBlock = `<p style="color:${colors.textSecondary}; font-size:18px; font-weight:600; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px; border-bottom:1px solid ${colors.border}; display:inline-block; padding-bottom:4px;">${safePublicationName}</p>`;
    const metaBlock = `<p style="color:${colors.textMuted}; font-size:14px; margin-bottom:32px;">${formattedDate} · ${readMinutes} min read</p>`;

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
        <style>
          ${frontendRules?.injectCss || ''}
        </style>
        ${webViewCSS}
      </head>
      <body>
        ${authorBlock}
        ${titleBlock}
        ${metaBlock}
        ${resolvedHtml}
        <script>
          (function() {
            try {
              var rules = ${JSON.stringify(frontendRules?.removeCss || [])};
              if (rules && rules.length > 0) {
                rules.forEach(function(selector) {
                  var els = document.querySelectorAll(selector);
                  for (var i = 0; i < els.length; i++) {
                    els[i].style.display = 'none';
                  }
                });
              }
            } catch (e) {
              console.warn('SubTick Rule Error: ' + e);
            }

            var text = document.body.innerText || document.body.textContent || '';
            var wordCount = text.trim().split(/\s+/).length;
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'wordCount', count: wordCount }));

            var maxDepth = 0;
            var lastScrollTop = 0;
            function reportScroll() {
              var scrollTop = window.scrollY || document.documentElement.scrollTop;
              var docHeight = document.documentElement.scrollHeight - window.innerHeight;
              if (docHeight <= 0) return;
              var depth = Math.min(1, Math.max(0, scrollTop / docHeight));
              if (depth > maxDepth) { maxDepth = depth; }

              if (scrollTop > lastScrollTop + 15) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'hud', visible: false, autoHide: false }));
                lastScrollTop = scrollTop;
              } else if (scrollTop < lastScrollTop - 15) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'hud', visible: true, autoHide: scrollTop > 50 }));
                lastScrollTop = scrollTop;
              } else if (scrollTop <= 0) {
                // At the very top — don't show HUD. It should only appear when
                // the user actively scrolls up, not on initial page load.
                lastScrollTop = scrollTop;
              }
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'scrollDepth', depth: maxDepth, currentDepth: depth }));
            }
            window.addEventListener('scroll', reportScroll, { passive: true });

            document.body.addEventListener('click', function(e) {
              if (e.target.tagName !== 'A') {
                var scrollTop = window.scrollY || document.documentElement.scrollTop;
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'hudToggle', autoHide: scrollTop > 50 }));
              }
            });

            setTimeout(reportScroll, 100);
          })();
        </script>
      </body>
      </html>
    `;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article, resolvedHtml, currentWpm]);

  const rawWebpageInjectedScript = useMemo(() => {
    const frontendRules = article?.frontendRules;
    return `
      (function() {
        try {
          var rules = ${JSON.stringify(frontendRules?.removeCss || [])};
          if (rules && rules.length > 0) {
            rules.forEach(function(selector) {
              var els = document.querySelectorAll(selector);
              for (var i = 0; i < els.length; i++) {
                els[i].style.display = 'none';
              }
            });
          }
        } catch (e) {
          console.warn('SubTick Rule Error: ' + e);
        }

        try {
          var css = ${JSON.stringify(frontendRules?.injectCss || '')};
          if (css) {
            var style = document.createElement('style');
            style.innerHTML = css;
            document.head.appendChild(style);
          }
        } catch (e) {
          console.warn('SubTick CSS Error: ' + e);
        }

        var meta = document.createElement('meta');
        meta.name = 'viewport';
        meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
        document.getElementsByTagName('head')[0].appendChild(meta);

        var text = document.body.innerText || document.body.textContent || '';
        var wordCount = text.trim().split(/\\s+/).length;
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'wordCount', count: wordCount }));

        var maxDepth = 0;
        var lastScrollTop = 0;
        function reportScroll() {
          var scrollTop = window.scrollY || document.documentElement.scrollTop;
          var docHeight = document.documentElement.scrollHeight - window.innerHeight;
          if (docHeight <= 0) return;
          var depth = Math.min(1, Math.max(0, scrollTop / docHeight));
          if (depth > maxDepth) { maxDepth = depth; }

          if (scrollTop > lastScrollTop + 15) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'hud', visible: false, autoHide: false }));
            lastScrollTop = scrollTop;
          } else if (scrollTop < lastScrollTop - 15) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'hud', visible: true, autoHide: scrollTop > 50 }));
            lastScrollTop = scrollTop;
          } else if (scrollTop <= 0) {
            // At the very top — don't show HUD. It should only appear when
            // the user actively scrolls up, not on initial page load.
            lastScrollTop = scrollTop;
          }
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'scrollDepth', depth: maxDepth, currentDepth: depth }));
        }
        window.addEventListener('scroll', reportScroll, { passive: true });

        document.body.addEventListener('click', function(e) {
          if (e.target.tagName !== 'A') {
            var scrollTop = window.scrollY || document.documentElement.scrollTop;
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'hudToggle', autoHide: scrollTop > 50 }));
          }
        });

        setTimeout(reportScroll, 100);
      })();
      true;
    `;
  }, [article]);

  // Determine if we should load the raw URL instead of sanitized HTML
  const useDirectUri = article && (article.rssStatus === 'archived' || (isSavedMode && !resolvedHtml));

  // Bug #1/#2 Fix: Use the article's own URL (publicationUrl = item.link from RSS) as the source.
  // For legacy articles where publicationUrl was incorrectly stored as the feed homepage,
  // fall back to the guid (which holds the article-level URL).
  //
  // Publication URL Fix: prefer the RSS-resolved article link (captured during a successful
  // fetchAndExtractArticle call) over the Firestore-stored publicationUrl. This ensures that
  // even articles ingested before the rssCollector fix (commit c1fe7e7) get the correct
  // article-level URL rather than the publisher's homepage when falling back to archived mode.
  const archivedArticleUrl = article
    ? (rssResolvedLinkRef.current || article.publicationUrl || article.guid || '')
    : '';

  // --- Prevent WebView Escape (Lock Navigation) ---
  const handleShouldStartLoadWithRequest = (request: any) => {
    if (!article) return true;

    // Always allow internal about:blank or data: URIs
    if (request.url.startsWith('data:') || request.url.startsWith('about:')) return true;

    if (!useDirectUri) {
      // In the clean sanitized HTML view, ANY external link click is sent to browser
      if (request.url.startsWith('http')) {
        Linking.openURL(request.url);
        return false;
      }
      return true;
    } else {
      // In the raw URI view, allow all navigations during initial load (redirects, custom domains, etc.)
      if (webViewInitialLoadRef.current) return true;

      // Bug #5 Fix: Compare using the archived article URL (article-level), not the publication homepage.
      // Use domain comparison for broader compatibility with redirects and slug changes.
      try {
        const currentDomain = new URL(archivedArticleUrl).hostname;
        const requestDomain = new URL(request.url).hostname;
        if (currentDomain === requestDomain) return true;
      } catch {
        // URL parsing failed — fall back to simple prefix check
        const currentUrlBase = archivedArticleUrl.split('?')[0];
        const reqUrlBase = request.url.split('?')[0];
        if (reqUrlBase === currentUrlBase) return true;
      }

      // User clicked an external link — open in browser
      Linking.openURL(request.url);
      return false;
    }
  };

  // --- Immersive mode: hide system UI bars while reading ---
  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setVisibilityAsync('hidden').catch(() => {});
    }
    return () => {
      if (Platform.OS === 'android') {
        NavigationBar.setVisibilityAsync('visible').catch(() => {});
      }
    };
  }, []);

  // --- Flush pending behavior events when leaving the Reader ---
  useEffect(() => {
    return () => {
      flushBehaviorQueue().catch(() => {
        // Silently fail — events stay queued for next flush
      });
    };
  }, []);

  // --- Auto-Recover from Fast-Swipe Trap ---
  useEffect(() => {
    if (queueExhausted && currentIndex < activeQueueIds.length - 1) {
      console.log('[Reader] Queue replenished! Auto-recovering from exhaustion screen.');
      setQueueExhausted(false);
      goToNext();
    }
  }, [queueExhausted, currentIndex, activeQueueIds.length, goToNext]);

  // --- Render ---
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} {...panResponder.panHandlers}>
      <StatusBar hidden={true} />

      {/* HUD Overlay (Frosted Glass Panel Actions via expo-blur) — fade restored */}
      <Animated.View style={[styles.hudContainer, { opacity: hudOpacity, transform: [{ translateY: hudTranslateY }] }]}>
        <BlurView
          intensity={isDark ? 40 : 80}
          tint={isDark ? 'dark' : 'light'}
          style={[styles.hudBlur, { paddingTop: topInset + 8 }]}
        >
          <View style={styles.hudTopRow}>
            {/* Back/Close Button */}
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.hudBackButton}>
              <X size={24} color={colors.text} />
            </TouchableOpacity>

            <Text style={[styles.hudTitle, { color: colors.text }]} numberOfLines={1} ellipsizeMode="tail">
              {article?.title || 'Reading'}
            </Text>

            <View style={styles.hudActions}>
              <TouchableOpacity
                onPress={() => {
                  const newVal = !isLiked;
                  setIsLiked(newVal);
                  if (article && !isRestrictedMode) {
                    if (newVal) {
                      behaviorTracker.trackEvent('like');
                    } else {
                      behaviorTracker.trackEvent('unlike');
                    }
                  }
                }}
                style={styles.hudIconButton}
              >
                <Heart
                  size={24}
                  color={isLiked ? colors.accent : colors.text}
                  fill={isLiked ? colors.accent : 'transparent'}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const newVal = !isSaved;
                  setIsSaved(newVal);
                  if (article) {
                    if (newVal) {
                      // Pass article object so metadata is cached for offline SavedReads list
                      markArticleSaved(article.id, resolvedHtml, article);
                      if (!isRestrictedMode) behaviorTracker.trackEvent('save');
                    } else {
                      unmarkArticleSaved(article.id);
                      if (!isRestrictedMode) behaviorTracker.trackEvent('unsave');
                    }
                  }
                }}
                style={styles.hudIconButton}
              >
                <Bookmark
                  size={24}
                  color={isSaved ? colors.accent : colors.text}
                  fill={isSaved ? colors.accent : 'transparent'}
                />
              </TouchableOpacity>
            </View>
          </View>
        </BlurView>
      </Animated.View>

      {/* Progress Bar at Bottom — Fabric-safe: plain View with percentage width */}
      <View style={[styles.bottomProgressBarContainer, { bottom: bottomInset }]}>
        <View
          style={[
            styles.bottomProgressBarFill,
            {
              backgroundColor: colors.accent,
              width: `${Math.round(scrollProgress * 100)}%`,
            },
          ]}
        />
      </View>

      {/* Swipe Zone Indicators (edge hints) */}
      {!isRestrictedMode && (
        <View style={[styles.edgeHintLeft, { backgroundColor: colors.surfaceSecondary + '20' }]}>
          <Text style={[styles.edgeHintText, { color: colors.textMuted }]}>◂</Text>
        </View>
      )}
      {!isHistoryMode && (
        <View style={[styles.edgeHintRight, { backgroundColor: colors.surfaceSecondary + '20' }]}>
          <Text style={[styles.edgeHintText, { color: colors.textMuted }]}>▸</Text>
        </View>
      )}

      {/* Content */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : queueExhausted ? (
        <View style={styles.catchUpContainer}>
          <Compass size={48} color={colors.textMuted} style={styles.emptyIcon} />
          <Text style={[styles.catchUpTitle, { color: colors.text }]}>Personalizing your next reads…</Text>
          <Text style={[styles.catchUpSubtitle, { color: colors.textSecondary }]}>
            We're finding more articles matched to your taste.
          </Text>
          <TouchableOpacity
            style={[styles.catchUpButton, { backgroundColor: colors.primary }]}
            onPress={() => navigation.goBack()}
          >
            <Text style={[styles.catchUpButtonText, { color: colors.background }]}>Back to Dashboard</Text>
          </TouchableOpacity>
        </View>
      ) : fetchError ? (
        <View style={styles.errorContainer}>
          <AlertCircle size={48} color={colors.textMuted} style={styles.emptyIcon} />
          <Text style={[styles.catchUpTitle, { color: colors.text }]}>Article failed to load</Text>
          <Text style={[styles.catchUpSubtitle, { color: colors.textSecondary }]}>
            This article may have been removed or is temporarily unavailable.
          </Text>
          {archivedArticleUrl ? (
            <TouchableOpacity
              style={[styles.catchUpButton, { backgroundColor: colors.primary, marginTop: 16 }]}
              onPress={() => Linking.openURL(archivedArticleUrl)}
            >
              <Text style={[styles.catchUpButtonText, { color: colors.background }]}>Open in Browser</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : article ? (
        useDirectUri ? (
          <View style={{ flex: 1, paddingTop: 3 }}>
            <View style={[styles.archivedHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.archivedTitle, { color: colors.text }]}>{article.title}</Text>
              <Text style={[styles.archivedAuthor, { color: colors.textMuted }]}>
                {article.publicationName} — {Math.max(1, Math.ceil((article.wordCount || 0) / currentWpm))} min read
              </Text>
            </View>
            {/* Bug #4 Fix: Show error state if WebView fails to load the archived URL */}
            {webViewLoadError ? (
              <View style={styles.catchUpContainer}>
                <AlertCircle size={48} color={colors.textMuted} style={styles.emptyIcon} />
                <Text style={[styles.catchUpTitle, { color: colors.text }]}>Page could not load</Text>
                <Text style={[styles.catchUpSubtitle, { color: colors.textSecondary }]}>
                  This article may have been moved or deleted by the publisher.
                </Text>
                {archivedArticleUrl ? (
                  <TouchableOpacity
                    style={[styles.catchUpButton, { backgroundColor: colors.primary, marginTop: 16 }]}
                    onPress={() => Linking.openURL(archivedArticleUrl)}
                  >
                    <Text style={[styles.catchUpButtonText, { color: colors.background }]}>Open in Browser</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : (
              <WebView
                ref={webViewRef}
                style={[styles.webview, { backgroundColor: colors.background }]}
                source={{ uri: archivedArticleUrl }}
                onMessage={handleWebViewMessage}
                onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
                onLoadEnd={() => { webViewInitialLoadRef.current = false; }}
                onError={(syntheticEvent) => {
                  console.error('[Reader] WebView load error:', syntheticEvent.nativeEvent);
                  setWebViewLoadError(true);
                }}
                onHttpError={(syntheticEvent) => {
                  const { statusCode } = syntheticEvent.nativeEvent;
                  console.error('[Reader] WebView HTTP error:', statusCode);
                  if (statusCode >= 400) setWebViewLoadError(true);
                }}
                injectedJavaScript={rawWebpageInjectedScript}
                javaScriptEnabled
                domStorageEnabled
                scrollEnabled
                showsVerticalScrollIndicator={false}
                scalesPageToFit={false}
              />
            )}
          </View>
        ) : (
          <WebView
            ref={webViewRef}
            style={[styles.webview, { backgroundColor: 'transparent' }]}
            originWhitelist={['*']}
            source={{ html: articleHTML }}
            onMessage={handleWebViewMessage}
            onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
            javaScriptEnabled
            domStorageEnabled
            scrollEnabled
            showsVerticalScrollIndicator={false}
            bounces={false}
            overScrollMode="never"
            scalesPageToFit={false}
          />
        )
      ) : (
        <View style={styles.errorContainer}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>Article could not be loaded.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hudContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
  },
  hudBlur: {
    paddingTop: 56,
    paddingHorizontal: 24,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(150, 150, 150, 0.2)',
  },
  hudTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hudBackButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  hudTitle: {
    flex: 1,
    fontSize: TEXT_SM,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginHorizontal: 16,
  },
  hudActions: { flexDirection: 'row', gap: 16 },
  hudIconButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  hudIcon: { fontSize: 18 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  webview: { flex: 1, marginTop: 0 },
  catchUpContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyIcon: { marginBottom: 24 },
  catchUpTitle: { fontSize: TEXT_LG, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  catchUpSubtitle: { fontSize: TEXT_BASE, textAlign: 'center', lineHeight: 24, marginBottom: 32 },
  catchUpButton: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 999,
  },
  catchUpButtonText: { fontSize: TEXT_BASE, fontWeight: '700' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  errorText: { fontSize: TEXT_BASE },
  bottomProgressBarContainer: {
    height: 3,
    width: '100%',
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 100,
    borderRadius: 3,
    backgroundColor: 'transparent',
  },
  bottomProgressBarFill: {
    height: '100%',
  },
  edgeHintLeft: {
    position: 'absolute',
    left: 0,
    top: '40%',
    bottom: '40%',
    width: EDGE_ZONE_WIDTH,
    zIndex: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  edgeHintRight: {
    position: 'absolute',
    right: 0,
    top: '40%',
    bottom: '40%',
    width: EDGE_ZONE_WIDTH,
    zIndex: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  edgeHintText: { fontSize: TEXT_SM, opacity: 0.2 },
  archivedHeader: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
    borderBottomWidth: 1,
  },
  archivedTitle: {
    fontSize: TEXT_2XL,
    fontWeight: '800',
    marginBottom: 8,
    fontFamily: 'Georgia',
    lineHeight: 34,
  },
  archivedAuthor: {
    fontSize: TEXT_SM,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});

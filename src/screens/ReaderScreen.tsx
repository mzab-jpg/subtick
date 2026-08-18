// ============================================================
// SubTick — Reader Screen (Orchestrator)
// WebView shell + PanResponder edge zones + HUD.
// Uses feature hooks from src/features/reader/ for article
// loading, queue navigation, HUD state, and progress bar.
// ============================================================

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  PanResponder,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme } from '../contexts/ThemeContext';
import { useUser } from '../contexts/UserContext';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Article, RootStackParamList } from '../types';
import { useBehaviorTracker } from '../hooks/useBehaviorTracker';
import {
  markArticleSeen,
  getSavedArticleIds,
  markArticleSaved,
  unmarkArticleSaved,
} from '../services/feedService';
import { flushBehaviorQueue } from '../services/behaviorSync';
import { removeArticleFromCachedDashboardFeed } from '../services/dashboardFeedCache';
import { Linking } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import { topInset, bottomInset } from '../utils/safeArea';
import { Platform } from 'react-native';
import { Compass, AlertCircle, Heart, Bookmark } from 'lucide-react-native';
import { TEXT_SM, TEXT_BASE, TEXT_LG, TEXT_2XL } from '../utils/constants';

// Feature hooks and components
import { useArticleLoader } from '../features/reader/useArticleLoader';
import { useNavigationQueue } from '../features/reader/useNavigationQueue';
import { useReaderHUD } from '../features/reader/useReaderHUD';
import { ReaderHUD } from '../features/reader/ReaderHUD';
import { ReaderProgressBar } from '../features/reader/ReaderProgressBar';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const EDGE_ZONE_WIDTH = 45;
const SWIPE_THRESHOLD = 40;
const SWIPE_PAUSE_THRESHOLD_MS = 200;
// Extreme edge band: a swipe starting here reveals the system bars
// (status + nav) so the user can use the native back gesture, without
// advancing to the next article or firing any weighting events.
const BACK_EDGE_WIDTH = 22;

// B3 Fix: Extract shared WebView reader script (scroll tracking, HUD toggling,
// word counting, click handling) into a single constant. Previously duplicated
// in both articleHTML and rawWebpageInjectedScript.
function makeReaderScript(frontendRules?: { removeCss?: string[]; injectCss?: string }) {
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
  `;
}

export default function ReaderScreen() {
  const { colors, webViewCSS, isDark } = useTheme();
  const route = useRoute<RouteProp<RootStackParamList, 'Reader'>>();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();

  const { articleId, queueArticleIds, recommendationContexts: initialRecommendationContexts, startIndex, userWpm, mode, mockArticle } = route.params;
  const currentWpm = userWpm || 200;
  const isHistoryMode = mode === 'history';
  const isSavedMode = mode === 'saved';
  const isMockMode = !!mockArticle;
  const isRestrictedMode = isHistoryMode || isSavedMode || isMockMode;

  const { profile: contextProfile, applyProvisionalSession } = useUser();
  const exitingReaderRef = useRef(false);
  const serverSeenIds = contextProfile?.seenArticleIds;
  // The loader is created before the queue, so use a stable ref to let a
  // failed background preparation remove only its future Reader card.
  const removeUnavailableFutureArticleRef = useRef<(articleId: string) => void>(() => {});
  const handleFutureArticleUnavailable = useCallback((unavailableArticleId: string) => {
    removeUnavailableFutureArticleRef.current(unavailableArticleId);
    // Avoid immediately re-suggesting a card whose background RSS request has
    // failed on this device/network. This is only the mounted Dashboard cache:
    // do not write History/seen state for something the person never opened.
    const userId = contextProfile?.userId;
    if (userId) removeArticleFromCachedDashboardFeed(userId, unavailableArticleId);
  }, [contextProfile?.userId]);

  // --- Feature hooks ---
  const {
    article, resolvedHtml, fetchError, unavailableFromRss, loading, slowLoading,
    articleTimingRef, rssResolvedLinkRef, cacheRef, loadArticle, prefetchArticles, cancelPrefetch,
  } = useArticleLoader({
    articleId,
    isSavedMode,
    isMockMode,
    allowArchivedFallback: contextProfile?.includeArchivedArticles === true,
    mockArticle,
    onFutureArticleUnavailable: handleFutureArticleUnavailable,
  });

  const {
    isLiked, isSaved, hudVisible, hudTimeoutRef,
    setIsLiked, setIsSaved, setHudVisible, handleHudAutoHide,
  } = useReaderHUD();

  const {
    activeQueueIds, recommendationContexts, currentIndex, hasNext, hasPrev,
    queueExhausted, preloading, setQueueExhausted, removeUnavailableFutureArticle, goToNext, goToPrev,
  } = useNavigationQueue({
    queueArticleIds: queueArticleIds || [],
    recommendationContexts: initialRecommendationContexts,
    startIndex: startIndex ?? 0,
    isRestrictedMode,
    loadArticle, setIsSaved, setIsLiked, serverSeenIds,
  });
  const activeArticleId = activeQueueIds[currentIndex] || articleId;
  removeUnavailableFutureArticleRef.current = removeUnavailableFutureArticle;

  // Skip an unavailable live-RSS item when raw webpages are disabled. It is
  // recorded as seen so Dashboard will not suggest it again, then Reader moves
  // on without surfacing a browser prompt or error card.
  useEffect(() => {
    if (!unavailableFromRss || !article || isRestrictedMode) return;
    void markArticleSeen(article.id, article).finally(() => goToNext());
  }, [unavailableFromRss, article, isRestrictedMode, goToNext]);

  // --- Scroll progress (Fabric-safe plain state) ---
  const [scrollProgress, setScrollProgress] = useState(0);
  const lastScrollProgressRef = useRef(0);
  const actualWordCountRef = useRef<number>(0);
  const webViewInitialLoadRef = useRef<boolean>(true);
  const webViewRef = useRef<WebView>(null);
  const swipeLastMoveTimeRef = useRef(0);
  const swipePanXRef = useRef(0);
  const swipeStartXRef = useRef(0);

  // Reset webview initial load guard whenever article changes
  useEffect(() => {
    webViewInitialLoadRef.current = true;
  }, [currentIndex, articleId]);

  // --- Behavior tracker hook ---
  const behaviorTracker = useBehaviorTracker({
    articleId: article?.id || articleId,
    articleCategory: article?.category || 'misc',
    lengthStyle: article?.lengthStyle || 'medium',
    publicationName: article?.publicationName,
    recommendationContext: recommendationContexts[article?.id || articleId],
    enabled: !!article && !loading && !isRestrictedMode,
  });

  // Check initial saved state
  useEffect(() => {
    if (articleId) {
      getSavedArticleIds().then((saved) => {
        setIsSaved(saved.includes(articleId));
      });
    }
  }, [articleId]);

  // Maintain a five-article upcoming buffer. Android's native module handles
  // one publisher feed at a time away from the Reader JavaScript/UI workload.
  useEffect(() => {
    const upcomingIds = activeQueueIds.slice(currentIndex + 1, currentIndex + 6);
    if (upcomingIds.length > 0) void prefetchArticles(upcomingIds);
  }, [currentIndex, activeQueueIds, prefetchArticles]);

  useEffect(() => () => {
    cancelPrefetch();
  }, [cancelPrefetch]);

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
            const rounded = Math.round(current * 100) / 100;
            if (rounded !== lastScrollProgressRef.current) {
              lastScrollProgressRef.current = rounded;
              setScrollProgress(rounded);
            }
          }
        } else if (data.type === 'wordCount' && typeof data.count === 'number') {
          actualWordCountRef.current = data.count;
          behaviorTracker.trackActualWordCount(data.count);
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
          setHudVisible((prev: boolean) => {
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
    [behaviorTracker, scrollProgress, handleHudAutoHide, setHudVisible, hudTimeoutRef]
  );

  const showSystemBars = () => {
    StatusBar.setHidden(false);
    if (Platform.OS === 'android') {
      NavigationBar.setVisibilityAsync('visible').catch(() => {});
    }
  };

  // --- PanResponder for edge swipe zones ---
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (evt) => {
          if (isHistoryMode) return false;
          const x = evt.nativeEvent.locationX;
          swipeStartXRef.current = x;
          swipePanXRef.current = 0;
          swipeLastMoveTimeRef.current = Date.now();
          return x <= EDGE_ZONE_WIDTH || x >= SCREEN_WIDTH - EDGE_ZONE_WIDTH;
        },
        onMoveShouldSetPanResponder: (evt, gestureState) => {
          return Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
        },
        onPanResponderMove: (evt, gestureState) => {
          // Use frame-to-frame movement rather than cumulative dx: cumulative
          // dx remains large after the finger stops, which would defeat the
          // deliberate pause-to-cancel gesture.
          const delta = Math.abs(gestureState.dx - swipePanXRef.current);
          swipePanXRef.current = gestureState.dx;
          if (delta > 2) {
            swipeLastMoveTimeRef.current = Date.now();
          }
        },
        onPanResponderRelease: (evt, gestureState) => {
          const dx = gestureState.dx;
          swipePanXRef.current = 0;

          // A brief hold before release is an intentional cancellation gesture.
          // It must not navigate or record Reader behaviour.
          const timeSinceLastMove = Date.now() - swipeLastMoveTimeRef.current;
          if (timeSinceLastMove > SWIPE_PAUSE_THRESHOLD_MS) return;

          // Extreme-edge swipe: show system bars so the user can use the
          // native back gesture. Don't advance the article or fire events.
          const inBackBand =
            swipeStartXRef.current <= BACK_EDGE_WIDTH ||
            swipeStartXRef.current >= SCREEN_WIDTH - BACK_EDGE_WIDTH;
          if (inBackBand && Math.abs(dx) > SWIPE_THRESHOLD) {
            showSystemBars();
            return;
          }

          if (dx < -SWIPE_THRESHOLD) {
            if (!isRestrictedMode) {
              void behaviorTracker.concludeSession(actualWordCountRef.current);
              if (article?.id) markArticleSeen(article.id, article);
            }
            goToNext();
          } else if (dx > SWIPE_THRESHOLD) {
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
    [goToNext, goToPrev, behaviorTracker, article, isRestrictedMode, isSavedMode, isHistoryMode, currentWpm]
  );

  // --- Escape RSS-controlled metadata before HTML interpolation ---
  const escapeHtml = (str: string): string => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  // --- Theme CSS injection (no full page reload) ---
  useEffect(() => {
    if (!webViewRef.current || !article) return;
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
  const articleHTML = useMemo(() => {
    if (!article) return '';
    const readMinutes = Math.max(1, Math.ceil((article.wordCount || 0) / currentWpm));
    const frontendRules = article.frontendRules;

    const safeTitle = escapeHtml(article.title);
    const safePublicationName = escapeHtml(article.publicationName);
    const safeAuthor = escapeHtml(article.author);

    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const publishDate = article.publishDate ? new Date(article.publishDate) : null;
    const formattedDate = publishDate
      ? `${publishDate.getDate()} ${MONTHS[publishDate.getMonth()]}`
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
        <script>${makeReaderScript(frontendRules)}</script>
      </body>
      </html>
    `;
  }, [article, resolvedHtml, currentWpm]);

  const logWebViewLoadStart = useCallback(() => {
    const timing = articleTimingRef.current;
    if (__DEV__ && timing && article?.id === timing.id) {
      console.log(`[Reader Timing] WebView load started ${Date.now() - timing.startedAt}ms: ${timing.id}`);
    }
  }, [article?.id, articleTimingRef]);

  const logWebViewLoadEnd = useCallback(() => {
    webViewInitialLoadRef.current = false;
    const timing = articleTimingRef.current;
    if (__DEV__ && timing && article?.id === timing.id) {
      const now = Date.now();
      const stateToVisible = timing.contentReadyAt ? now - timing.contentReadyAt : undefined;
      console.log(
        `[Reader Timing] WebView load complete ${now - timing.startedAt}ms total${stateToVisible !== undefined ? `; ${stateToVisible}ms after content state` : ''}: ${timing.id}`
      );
    }
  }, [article?.id, articleTimingRef]);

  const rawWebpageInjectedScript = useMemo(() => {
    const frontendRules = article?.frontendRules;
    return `
      (function() {
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
      })();
      true;
    ` + makeReaderScript(frontendRules);
  }, [article]);

  const useDirectUri = article && (article.rssStatus === 'archived' || (isSavedMode && !resolvedHtml));

  const archivedArticleUrl = article
    ? (rssResolvedLinkRef.current || article.publicationUrl || article.guid || '')
    : '';

  // --- Prevent WebView Escape ---
  const handleShouldStartLoadWithRequest = (request: any) => {
    if (!article) return true;
    if (request.url.startsWith('data:') || request.url.startsWith('about:')) return true;

    if (!useDirectUri) {
      if (request.url.startsWith('http')) {
        Linking.openURL(request.url);
        return false;
      }
      return true;
    } else {
      if (webViewInitialLoadRef.current) return true;

      try {
        const currentDomain = new URL(archivedArticleUrl).hostname;
        const requestDomain = new URL(request.url).hostname;
        if (currentDomain === requestDomain) return true;
      } catch {
        const currentUrlBase = archivedArticleUrl.split('?')[0];
        const reqUrlBase = request.url.split('?')[0];
        if (reqUrlBase === currentUrlBase) return true;
      }

      Linking.openURL(request.url);
      return false;
    }
  };

  // --- Immersive mode + behavior flush ---
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

  useEffect(() => {
    return () => {
      flushBehaviorQueue().catch(() => {});
    };
  }, []);

  // --- HUD toggle handlers ---
  const finishAndExitReader = useCallback(async (exit: () => void) => {
    if (exitingReaderRef.current) return;
    exitingReaderRef.current = true;
    try {
      if (!isRestrictedMode && article?.id) {
        const wordCountForSession = actualWordCountRef.current || article.wordCount || 0;
        const summary = await behaviorTracker.concludeSession(wordCountForSession);
        applyProvisionalSession(summary);
        // History represents every article opened from the live feed, no matter
        // whether the person uses the close button, Android back, or catch-up exit.
        // Local History/seen persistence finishes before leaving. The Cloud
        // Function is intentionally background work so a slow network never
        // delays the return gesture or close transition.
        await markArticleSeen(article.id, article);
        void flushBehaviorQueue();
      }
      exit();
    } finally {
      exitingReaderRef.current = false;
    }
  }, [applyProvisionalSession, article, behaviorTracker, isRestrictedMode]);

  const handleCloseReader = useCallback(() => {
    void finishAndExitReader(() => navigation.goBack());
  }, [finishAndExitReader, navigation]);

  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (isRestrictedMode || exitingReaderRef.current) return;
    event.preventDefault();
    void finishAndExitReader(() => navigation.dispatch(event.data.action));
  }), [finishAndExitReader, isRestrictedMode, navigation]);

  const handleLikeToggle = () => {
    const newVal = !isLiked;
    setIsLiked(newVal);
    if (article && !isRestrictedMode) {
      if (newVal) {
        behaviorTracker.trackEvent('like');
      } else {
        behaviorTracker.trackEvent('unlike');
      }
    }
  };

  const handleSaveToggle = () => {
    const newVal = !isSaved;
    setIsSaved(newVal);
    if (article) {
      if (newVal) {
        markArticleSaved(article.id, resolvedHtml, article);
        if (!isRestrictedMode) behaviorTracker.trackEvent('save');
      } else {
        unmarkArticleSaved(article.id);
        if (!isRestrictedMode) behaviorTracker.trackEvent('unsave');
      }
    }
  };

  // --- Render ---
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} {...panResponder.panHandlers}>
      <StatusBar hidden={true} />

      {/* HUD */}
      {hudVisible && (
        <ReaderHUD
          article={article}
          colors={colors}
          isDark={isDark}
          isLiked={isLiked}
          isSaved={isSaved}
          isRestrictedMode={isRestrictedMode}
          resolvedHtml={resolvedHtml}
          onClose={handleCloseReader}
          onLikeToggle={handleLikeToggle}
          onSaveToggle={handleSaveToggle}
        />
      )}

      {/* Progress Bar */}
      <ReaderProgressBar scrollProgress={scrollProgress} colors={colors} />

      {/* Swipe Zone Indicators */}
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
      {unavailableFromRss ? (
        <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
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
            onPress={handleCloseReader}
          >
            <Text style={[styles.catchUpButtonText, { color: colors.background }]}>Back to Dashboard</Text>
          </TouchableOpacity>
        </View>
      ) : fetchError ? (
        <View style={[styles.errorContainer, { backgroundColor: colors.background }]}>
          <AlertCircle size={48} color={colors.textMuted} style={styles.emptyIcon} />
          <Text style={[styles.catchUpTitle, { color: colors.text }]}>Article is taking longer than expected</Text>
          <Text style={[styles.catchUpSubtitle, { color: colors.textSecondary }]}>
            Check your connection and try this article again.
          </Text>
          <TouchableOpacity
            style={[styles.catchUpButton, { backgroundColor: colors.primary, marginTop: 16 }]}
            onPress={() => void loadArticle(activeArticleId)}
          >
            <Text style={[styles.catchUpButtonText, { color: colors.background }]}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : loading ? (
        // The old WebView is unmounted as soon as a new article is requested.
        // This opaque surface prevents a native publisher webpage flashing under
        // the delayed spinner during Android transition composition.
        <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
          {slowLoading && <ActivityIndicator size="small" color={colors.primary} />}
        </View>
      ) : article ? (
        <>
        {useDirectUri ? (
          <View style={{ flex: 1, paddingTop: 3 }}>
            <View style={[styles.archivedHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.archivedTitle, { color: colors.text }]}>{article.title}</Text>
              <Text style={[styles.archivedAuthor, { color: colors.textMuted }]}>
                {article.publicationName} — {Math.max(1, Math.ceil((article.wordCount || 0) / currentWpm))} min read
              </Text>
            </View>
            <WebView
              ref={webViewRef}
              style={[styles.webview, { backgroundColor: colors.background }]}
              source={{ uri: archivedArticleUrl }}
              onMessage={handleWebViewMessage}
              onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
              onLoadStart={logWebViewLoadStart}
              onLoadEnd={logWebViewLoadEnd}
              onError={(syntheticEvent) => {
                console.error('[Reader] WebView load error:', syntheticEvent.nativeEvent);
              }}
              onHttpError={(syntheticEvent) => {
                const { statusCode } = syntheticEvent.nativeEvent;
                console.error('[Reader] WebView HTTP error:', statusCode);
              }}
              injectedJavaScript={rawWebpageInjectedScript}
              javaScriptEnabled
              domStorageEnabled
              scrollEnabled
              showsVerticalScrollIndicator={false}
              scalesPageToFit={false}
            />
          </View>
        ) : (
          <WebView
            ref={webViewRef}
            style={[styles.webview, { backgroundColor: colors.background }]}
            originWhitelist={['*']}
            source={{ html: articleHTML }}
            onLoadStart={logWebViewLoadStart}
            onLoadEnd={logWebViewLoadEnd}
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
        )}
        </>
      ) : (
        <View style={[styles.errorContainer, { backgroundColor: colors.background }]}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>Article could not be loaded.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  webview: { flex: 1, marginTop: 0 },
  catchUpContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32,
  },
  emptyIcon: { marginBottom: 24 },
  catchUpTitle: { fontSize: TEXT_LG, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  catchUpSubtitle: { fontSize: TEXT_BASE, textAlign: 'center', lineHeight: 24, marginBottom: 32 },
  catchUpButton: { paddingHorizontal: 24, paddingVertical: 16, borderRadius: 999 },
  catchUpButtonText: { fontSize: TEXT_BASE, fontWeight: '700' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  errorText: { fontSize: TEXT_BASE },
  edgeHintLeft: {
    position: 'absolute', left: 0, top: '40%', bottom: '40%',
    width: EDGE_ZONE_WIDTH, zIndex: 50, justifyContent: 'center', alignItems: 'center',
  },
  edgeHintRight: {
    position: 'absolute', right: 0, top: '40%', bottom: '40%',
    width: EDGE_ZONE_WIDTH, zIndex: 50, justifyContent: 'center', alignItems: 'center',
  },
  edgeHintText: { fontSize: TEXT_SM, opacity: 0.2 },
  archivedHeader: {
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24, borderBottomWidth: 1,
  },
  archivedTitle: {
    fontSize: TEXT_2XL, fontWeight: '800', marginBottom: 8,
    fontFamily: 'Georgia', lineHeight: 34,
  },
  archivedAuthor: {
    fontSize: TEXT_SM, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5,
  },
});
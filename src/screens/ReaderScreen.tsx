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

export default function ReaderScreen() {
  const { colors, webViewCSS, isDark } = useTheme();
  const route = useRoute<RouteProp<RootStackParamList, 'Reader'>>();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();

  const { articleId, queueArticleIds, startIndex, userWpm, mode, mockArticle, mockHtml } = route.params;
  const currentWpm = userWpm || 250;
  const isHistoryMode = mode === 'history';
  const isSavedMode = mode === 'saved';
  const isMockMode = !!mockArticle;
  const isRestrictedMode = isHistoryMode || isSavedMode || isMockMode;

  // --- Feature hooks ---
  const {
    article, resolvedHtml, fetchError, loading,
    rssResolvedLinkRef, cacheRef, loadArticle, prefetchArticles,
  } = useArticleLoader({
    articleId, isSavedMode, isMockMode, mockArticle, mockHtml,
  });

  const {
    isLiked, isSaved, hudVisible, hudTimeoutRef,
    setIsLiked, setIsSaved, setHudVisible, handleHudAutoHide,
  } = useReaderHUD();

  const {
    activeQueueIds, currentIndex, hasNext, hasPrev,
    queueExhausted, preloading, setQueueExhausted, goToNext, goToPrev,
  } = useNavigationQueue({
    queueArticleIds: queueArticleIds || [], startIndex: startIndex ?? 0, isRestrictedMode,
    loadArticle, setIsSaved, setIsLiked,
  });

  // --- Scroll progress (Fabric-safe plain state) ---
  const [scrollProgress, setScrollProgress] = useState(0);
  const lastScrollProgressRef = useRef(0);
  const actualWordCountRef = useRef<number>(0);
  const webViewInitialLoadRef = useRef<boolean>(true);
  const webViewRef = useRef<WebView>(null);
  const swipeLastMoveTimeRef = useRef<number>(0);
  const SWIPE_PAUSE_THRESHOLD_MS = 200;
  const panX = useRef(0);

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

  // Prefetch upcoming articles
  useEffect(() => {
    const upcomingIds = activeQueueIds.slice(currentIndex + 1, currentIndex + 11);
    if (upcomingIds.length > 0) {
      prefetchArticles(upcomingIds);
    }
  }, [currentIndex, activeQueueIds, prefetchArticles]);

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
          panX.current = gestureState.dx;
          if (Math.abs(gestureState.dx) > 5) {
            swipeLastMoveTimeRef.current = Date.now();
          }
        },
        onPanResponderRelease: (evt, gestureState) => {
          const dx = gestureState.dx;
          panX.current = 0;

          const timeSinceLastMove = Date.now() - swipeLastMoveTimeRef.current;
          if (timeSinceLastMove > SWIPE_PAUSE_THRESHOLD_MS) {
            return;
          }

          if (dx < -SWIPE_THRESHOLD) {
            if (!isRestrictedMode) {
              const expectedReadTimeMs = article?.wordCount ? (article.wordCount / currentWpm) * 60000 : 60000;
              behaviorTracker.concludeSession(expectedReadTimeMs, actualWordCountRef.current);
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
    [goToNext, goToPrev, behaviorTracker, panX, article, isRestrictedMode, isSavedMode, isHistoryMode, currentWpm]
  );

  // --- Escape HTML helper ---
  const escapeHtml = (str: string): string => {
    return str
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
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
        </script>
      </body>
      </html>
    `;
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
          onClose={() => navigation.goBack()}
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
            <WebView
              ref={webViewRef}
              style={[styles.webview, { backgroundColor: colors.background }]}
              source={{ uri: archivedArticleUrl }}
              onMessage={handleWebViewMessage}
              onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
              onLoadEnd={() => { webViewInitialLoadRef.current = false; }}
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
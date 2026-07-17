// ============================================================
// SubTick — Reader Screen
// WebView article shell + PanResponder edge zones + HUD.
// Uses useBehaviorTracker to queue swipes/likes/scrolls for
// syncBehaviorEvents → weightUpdater pipeline.
// ============================================================

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  PanResponder,
  Dimensions,
  Animated,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme } from '../contexts/ThemeContext';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Article } from '../types';
import { db } from '../services/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { MAX_FEED_ARTICLES } from '../utils/constants';
import { useBehaviorTracker } from '../hooks/useBehaviorTracker';
import { markArticleSeen } from '../services/feedService';
import { flushBehaviorQueue } from '../services/behaviorSync';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const EDGE_ZONE_WIDTH = 30; // px — touch-intercepting margin zones
const SWIPE_THRESHOLD = 60; // px — minimum horizontal swipe to trigger action

export default function ReaderScreen() {
  const { colors, webViewCSS, isDark } = useTheme();
  const route = useRoute<any>();
  const navigation = useNavigation<any>();

  const { articleId, queueArticleIds, startIndex } = route.params;

  // --- State ---
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(startIndex ?? 0);
  const [isLiked, setIsLiked] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [queueExhausted, setQueueExhausted] = useState(false);

  // PanResponder gesture translation ref
  const panX = useRef(new Animated.Value(0)).current;

  // --- Behavior tracker hook (replaces inline console.log) ---
  const behaviorTracker = useBehaviorTracker({
    articleId: article?.id || articleId,
    articleCategory: article?.category || 'misc',
    enabled: !!article && !loading,
  });

  // --- Load article ---
  const loadArticle = useCallback(async (id: string) => {
    try {
      setLoading(true);
      const snap = await getDoc(doc(db, 'articles', id));
      if (snap.exists()) {
        setArticle(snap.data() as Article);
      } else {
        setArticle(null);
      }
    } catch (error) {
      console.error('[Reader] loadArticle error:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadArticle(articleId);
  }, [articleId]);

  // --- Queue navigation helpers ---
  const hasNext = currentIndex < queueArticleIds.length - 1;
  const hasPrev = currentIndex > 0;

  const goToNext = useCallback(() => {
    if (!hasNext) {
      setQueueExhausted(true);
      return;
    }
    const nextIdx = currentIndex + 1;
    setCurrentIndex(nextIdx);
    // Reset reader state
    setIsLiked(false);
    setIsSaved(false);
    loadArticle(queueArticleIds[nextIdx]);
  }, [hasNext, currentIndex, queueArticleIds, loadArticle]);

  const goToPrev = useCallback(() => {
    if (!hasPrev) return;
    const prevIdx = currentIndex - 1;
    setCurrentIndex(prevIdx);
    setIsLiked(false);
    setIsSaved(false);
    loadArticle(queueArticleIds[prevIdx]);
  }, [hasPrev, currentIndex, queueArticleIds, loadArticle]);

  // --- WebView scroll message handler ---
  const handleWebViewMessage = useCallback(
    (event: any) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === 'scrollDepth' && typeof data.depth === 'number') {
          const depth = Math.min(1, Math.max(0, data.depth));
          behaviorTracker.trackScrollDepth(depth);
        }
      } catch {
        // Ignore non-JSON messages
      }
    },
    [behaviorTracker]
  );

  // --- PanResponder for edge swipe zones ---
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (evt) => {
          const x = evt.nativeEvent.locationX;
          // Only intercept touches in edge zones (left 30px or right 30px)
          return x <= EDGE_ZONE_WIDTH || x >= SCREEN_WIDTH - EDGE_ZONE_WIDTH;
        },
        onMoveShouldSetPanResponder: (evt, gestureState) => {
          // Already captured — prevent vertical scrolling interference
          return Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
        },
        onPanResponderMove: (evt, gestureState) => {
          panX.setValue(gestureState.dx);
        },
        onPanResponderRelease: (evt, gestureState) => {
          const dx = gestureState.dx;
          // Animate back to 0
          Animated.spring(panX, { toValue: 0, useNativeDriver: true }).start();

          if (dx < -SWIPE_THRESHOLD) {
            // Swipe left (right edge) → Swipe Next
            behaviorTracker.trackEvent('swipe_next');
            // Mark article as seen so it won't reappear on refresh
            if (article?.id) markArticleSeen(article.id);
            goToNext();
          } else if (dx > SWIPE_THRESHOLD) {
            // Swipe right (left edge) → Swipe Not Interested
            behaviorTracker.trackEvent('swipe_not_interested');
            // Mark article as seen so it won't reappear on refresh
            if (article?.id) markArticleSeen(article.id);
            goToNext(); // Also advances (dismisses) article
          }
        },
      }),
    [goToNext, behaviorTracker, panX]
  );

  // --- Pre-compiled HTML for WebView (NO post-load style injection — prevents flashing) ---
  const articleHTML = useMemo(() => {
    if (!article) return '';
    const titleBlock = `<h1 style="color:${colors.text}; margin-bottom:16px;">${article.title}</h1>`;
    const authorBlock = `<p style="color:${colors.textMuted}; font-size:14px; margin-bottom:8px;">${article.publicationName} — ${article.author}</p>`;
    const metaBlock = `<p style="color:${colors.textMuted}; font-size:13px; margin-bottom:24px;">${article.estimatedReadMinutes} min read · ${new Date(article.publishDate).toLocaleDateString()}</p>`;

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
        ${webViewCSS}
      </head>
      <body>
        ${titleBlock}
        ${authorBlock}
        ${metaBlock}
        ${article.bodyHtml}
        <script>
          (function() {
            var maxDepth = 0;
            function reportScroll() {
              var scrollTop = window.scrollY || document.documentElement.scrollTop;
              var docHeight = document.documentElement.scrollHeight - window.innerHeight;
              if (docHeight <= 0) return;
              var depth = Math.min(1, Math.max(0, scrollTop / docHeight));
              if (depth > maxDepth) {
                maxDepth = depth;
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'scrollDepth', depth: depth }));
              }
            }
            window.addEventListener('scroll', reportScroll, { passive: true });
            // Initial report
            setTimeout(reportScroll, 100);
          })();
        </script>
      </body>
      </html>
    `;
  }, [article, colors, webViewCSS]);

  // --- Flush pending behavior events when leaving the Reader ---
  useEffect(() => {
    return () => {
      flushBehaviorQueue().catch(() => {
        // Silently fail — events stay queued for next flush
      });
    };
  }, []);

  // --- Render ---
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} {...panResponder.panHandlers}>
      {/* HUD Overlay */}
      <View style={[styles.hud, { backgroundColor: colors.hudBackground, borderBottomColor: colors.border }]}>
        {/* Top Row */}
        <View style={styles.hudTopRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.hudButton}>
            <Text style={[styles.hudButtonText, { color: colors.primary }]}>← Back</Text>
          </TouchableOpacity>

          {article && (
            <Text style={[styles.hudTitle, { color: colors.text }]} numberOfLines={1}>
              {article.publicationName}
            </Text>
          )}

          <View style={styles.hudActions}>
            <TouchableOpacity
              onPress={() => {
                const newVal = !isLiked;
                setIsLiked(newVal);
                if (newVal) behaviorTracker.trackEvent('like');
              }}
              style={styles.hudIconButton}
            >
              <Text style={styles.hudIcon}>{isLiked ? '❤️' : '🤍'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                const newVal = !isSaved;
                setIsSaved(newVal);
                if (newVal) behaviorTracker.trackEvent('save');
              }}
              style={styles.hudIconButton}
            >
              <Text style={styles.hudIcon}>{isSaved ? '🔖' : '🏷️'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Progress Bar */}
        <View style={[styles.progressBg, { backgroundColor: colors.progressBarBackground }]}>
          <View
            style={[
              styles.progressFill,
              {
                backgroundColor: colors.progressBar,
                width: `${Math.min(behaviorTracker.getMaxScrollDepth() * 100, 100)}%` as any,
              },
            ]}
          />
        </View>
      </View>

      {/* Swipe Zone Indicators (edge hints) */}
      <View style={[styles.edgeHintLeft, { backgroundColor: colors.surfaceSecondary + '20' }]}>
        <Text style={[styles.edgeHintText, { color: colors.textMuted }]}>◂</Text>
      </View>
      <View style={[styles.edgeHintRight, { backgroundColor: colors.surfaceSecondary + '20' }]}>
        <Text style={[styles.edgeHintText, { color: colors.textMuted }]}>▸</Text>
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : queueExhausted ? (
        <View style={styles.catchUpContainer}>
          <Text style={styles.catchUpEmoji}>✨</Text>
          <Text style={[styles.catchUpTitle, { color: colors.text }]}>Personalizing your next reads…</Text>
          <Text style={[styles.catchUpSubtitle, { color: colors.textSecondary }]}>
            We're finding more articles matched to your taste.
          </Text>
          <TouchableOpacity
            style={[styles.catchUpButton, { backgroundColor: colors.primary }]}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.catchUpButtonText}>Back to Dashboard</Text>
          </TouchableOpacity>
        </View>
      ) : article ? (
        <WebView
          style={styles.webview}
          originWhitelist={['*']}
          source={{ html: articleHTML }}
          onMessage={handleWebViewMessage}
          javaScriptEnabled
          domStorageEnabled
          scrollEnabled
          showsVerticalScrollIndicator={false}
          bounces={false}
          overScrollMode="never"
        />
      ) : (
        <View style={styles.errorContainer}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>Article could not be loaded.</Text>
        </View>
      )}

      {/* Queue Navigation Indicator */}
      {!loading && !queueExhausted && (
        <View style={styles.queueIndicator}>
          <Text style={[styles.queueText, { color: colors.textMuted }]}>
            {currentIndex + 1} / {queueArticleIds.length}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hud: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    paddingTop: 48, // Safe area
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
  },
  hudTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  hudButton: { paddingVertical: 4, paddingRight: 12 },
  hudButtonText: { fontSize: 15, fontWeight: '600' },
  hudTitle: { flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '600' },
  hudActions: { flexDirection: 'row', gap: 8 },
  hudIconButton: { padding: 4 },
  hudIcon: { fontSize: 20 },
  progressBg: { height: 3, borderRadius: 1.5, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 1.5 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 100 },
  webview: { flex: 1, marginTop: 3 },
  catchUpContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    marginTop: 100,
  },
  catchUpEmoji: { fontSize: 48, marginBottom: 16 },
  catchUpTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  catchUpSubtitle: { fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  catchUpButton: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  catchUpButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 100 },
  errorText: { fontSize: 16 },
  queueIndicator: {
    position: 'absolute',
    bottom: 36,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  queueText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  edgeHintLeft: {
    position: 'absolute',
    left: 0,
    top: '30%',
    bottom: '30%',
    width: EDGE_ZONE_WIDTH,
    zIndex: 50,
    justifyContent: 'center',
    alignItems: 'center',
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
  },
  edgeHintRight: {
    position: 'absolute',
    right: 0,
    top: '30%',
    bottom: '30%',
    width: EDGE_ZONE_WIDTH,
    zIndex: 50,
    justifyContent: 'center',
    alignItems: 'center',
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
  },
  edgeHintText: { fontSize: 11, opacity: 0.4 },
});
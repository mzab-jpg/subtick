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
import { MAX_FEED_ARTICLES } from '../utils/constants';
import { useBehaviorTracker } from '../hooks/useBehaviorTracker';
import { markArticleSeen, getRankedFeed, getSeenArticleIds, markArticleSaved, unmarkArticleSaved, getSavedArticleIds, fetchAndExtractArticle, getSavedArticleHtml, pruneFeedSessionCache } from '../services/feedService';
import { flushBehaviorQueue } from '../services/behaviorSync';
import { Linking } from 'react-native';
import { BlurView } from 'expo-blur';
<<<<<<< Updated upstream
=======
import { X, Bookmark, Compass, AlertCircle } from 'lucide-react-native';
>>>>>>> Stashed changes

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
  const [hudVisible, setHudVisible] = useState(true);

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
    // Start auto-hide timer immediately on component mount with 1.5 seconds
    handleHudAutoHide(true, 1500);
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
  const scrollProgress = useRef(new Animated.Value(0)).current;
  const actualWordCountRef = useRef<number>(0);
  const webViewInitialLoadRef = useRef<boolean>(true);
  const webViewRef = useRef<WebView>(null);

  // Reset webview initial load guard whenever article changes
  useEffect(() => {
    webViewInitialLoadRef.current = true;
  }, [currentIndex, articleId]);

  // --- Behavior tracker hook (replaces inline console.log) ---
  const behaviorTracker = useBehaviorTracker({
    articleId: article?.id || articleId,
    articleCategory: article?.category || 'misc',
    lengthStyle: article?.lengthStyle || 'medium',
    publicationName: article?.publicationName,
    enabled: !!article && !loading && !isRestrictedMode,
  });

  // --- Load article ---
  const loadArticle = useCallback(async (id: string) => {
    try {
      setLoading(true);
      setFetchError(false);

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
          try {
            contentHtml = await fetchAndExtractArticle(data.feedUrl, data.guid);
          } catch (rssError) {
            console.warn(`[Reader] RSS fetch failed for ${data.guid}, falling back to raw URI.`);
            needsFallback = true;
          }
        } else {
          contentHtml = data.bodyHtml || '';
        }
        
        // If the RSS fetch fails (e.g. 4-hour gap before article is officially tagged archived), 
        // silently fallback to rendering the raw Substack URI so the user never hits a dead-end screen.
        if (needsFallback) {
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
      console.error('[Reader] loadArticle error:', error);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [isSavedMode]);

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

      // We only fetch RSS feeds for 'current' articles.
      const currentArticles = activeArticles.filter(a => !a.rssStatus || a.rssStatus === 'current');

      // 2. Extract unique feedUrls for the upcoming window
      const uniqueFeedUrls = Array.from(
        new Set(currentArticles.map(a => a.feedUrl).filter((url): url is string => !!url))
      );

      // 3. Prune our local in-memory feed cache to only keep feeds that show up in the look-ahead window.
      // This is the "keep what's active, delete what's old" sliding window rule.
      pruneFeedSessionCache(uniqueFeedUrls);

      // 4. Concurrently fetch the unique RSS feeds (completely safe from duplication because feedService caches the active Promise)
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
      // 1. Instantly trigger a background behavior events flush
      // This forces the weights to update in the database in real-time
      await flushBehaviorQueue();
      console.log('[Preloader] Local behavior events successfully flushed to cloud.');

      // 2. Query the next batch of articles from the Cloud.
      // We pass combined historical seen IDs + currently active queue IDs 
      // so the filter avoids both previously read articles and ones currently in the queue.
      const historicalSeen = await getSeenArticleIds();
      const combinedSeenIds = Array.from(new Set([...historicalSeen, ...activeQueueIds]));
      const result = await getRankedFeed(combinedSeenIds);

      if (result.articles && result.articles.length > 0) {
        // Grab the new recommendations (highly tailored to their fresh swipes!)
        const newIds = result.articles.map(a => a.id);
        
        // 3. Append them cleanly to our active queue
        setQueueIds(prev => [...prev, ...newIds]);
        console.log(`[Preloader] Preloaded and appended ${newIds.length} fresh, highly-tailored articles to the queue.`);
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
    setIsSaved(false);
    loadArticle(activeQueueIds[nextIdx]);

    // TRIGGER ZONE CHECK: If 5 articles or less are left in the active queue,
    // preload the next batch of fresh articles in the background.
    if (!isRestrictedMode && activeQueueIds.length - nextIdx <= 5 && !preloadingRef.current) {
      preloadNextArticles();
    }
    
    // Refresh saved state for next article
    getSavedArticleIds().then(saved => setIsSaved(saved.includes(activeQueueIds[nextIdx])));
  }, [hasNext, currentIndex, activeQueueIds, loadArticle, preloadNextArticles, isRestrictedMode]);

  const goToPrev = useCallback(() => {
    if (!hasPrev) return;
    const prevIdx = currentIndex - 1;
    setCurrentIndex(prevIdx);
    setIsLiked(false);
    
    // Refresh saved state for prev article
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
            scrollProgress.setValue(current);
          }
        } else if (data.type === 'wordCount' && typeof data.count === 'number') {
          actualWordCountRef.current = data.count;
        } else if (data.type === 'hud') {
          setHudVisible(data.visible);
          if (data.visible) {
            handleHudAutoHide(true, 2500); // Scrolling up shows HUD for 2.5s
          } else {
            // Scrolling down hides HUD instantly (smoothly animated by transition)
            if (hudTimeoutRef.current) {
              clearTimeout(hudTimeoutRef.current);
              hudTimeoutRef.current = null;
            }
          }
        } else if (data.type === 'hudToggle') {
          setHudVisible((prev) => {
            const next = !prev;
            if (next) {
              handleHudAutoHide(true, 2500); // Tap to show HUD displays it for 2.5s
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
          if (isHistoryMode) return false; // disable swiping in history mode
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
            if (!isRestrictedMode) {
              const expectedReadTimeMs = article?.wordCount ? (article.wordCount / currentWpm) * 60000 : 60000;
              behaviorTracker.concludeSession(expectedReadTimeMs, actualWordCountRef.current);
              if (article?.id) markArticleSeen(article.id);
            }
            goToNext();
          } else if (dx > SWIPE_THRESHOLD) {
            // Swipe right (left edge) → Swipe Prev if saved mode, or Not Interested if feed mode
            if (isSavedMode) {
              goToPrev();
            } else if (!isRestrictedMode) {
              behaviorTracker.trackEvent('swipe_not_interested');
              if (article?.id) markArticleSeen(article.id);
              goToNext(); // advances (dismisses) article
            }
          }
        },
      }),
    [goToNext, goToPrev, behaviorTracker, panX, article, isRestrictedMode, isSavedMode, isHistoryMode]
  );

  // --- HUD Fade Animation ---
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

  // --- Pre-compiled HTML for WebView (NO post-load style injection — prevents flashing) ---
  const articleHTML = useMemo(() => {
    if (!article) return '';
    const readMinutes = Math.max(1, Math.ceil((article.wordCount || 0) / currentWpm));
    
    // Using elegant editorial typography styling
    const titleBlock = `<h1 style="color:${colors.text}; margin-bottom:16px;">${article.title}</h1>`;
    const authorBlock = `<p style="color:${colors.textSecondary}; font-size:16px; font-weight:600; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px; border-bottom:1px solid ${colors.border}; display:inline-block; padding-bottom:4px;">${article.publicationName}</p>`;
    const metaBlock = `<p style="color:${colors.textMuted}; font-size:14px; margin-bottom:32px;">By ${article.author} · ${readMinutes} min read</p>`;

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
        ${webViewCSS}
      </head>
      <body>
        ${authorBlock}
        ${titleBlock}
        ${metaBlock}
        ${resolvedHtml}
        <script>
          (function() {
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
              if (depth > maxDepth) {
                maxDepth = depth;
              }
              
              if (scrollTop > lastScrollTop + 15) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'hud', visible: false, autoHide: false }));
                lastScrollTop = scrollTop;
              } else if (scrollTop < lastScrollTop - 15) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'hud', visible: true, autoHide: scrollTop > 50 }));
                lastScrollTop = scrollTop;
              } else if (scrollTop <= 0) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'hud', visible: true, autoHide: false }));
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

            // Initial report
            setTimeout(reportScroll, 100);
          })();
        </script>
      </body>
      </html>
    `;
  }, [article, resolvedHtml, colors, webViewCSS]);

  const rawWebpageInjectedScript = `
    (function() {
      var meta = document.createElement('meta');
      meta.name = 'viewport';
      meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
      document.getElementsByTagName('head')[0].appendChild(meta);

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
        if (depth > maxDepth) {
          maxDepth = depth;
        }
        
        if (scrollTop > lastScrollTop + 15) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'hud', visible: false, autoHide: false }));
          lastScrollTop = scrollTop;
        } else if (scrollTop < lastScrollTop - 15) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'hud', visible: true, autoHide: scrollTop > 50 }));
          lastScrollTop = scrollTop;
        } else if (scrollTop <= 0) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'hud', visible: true, autoHide: false }));
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

  // Determine if we should load the raw URL instead of sanitized HTML
  const useDirectUri = article && (article.rssStatus === 'archived' || (isSavedMode && !resolvedHtml));

  // --- Prevent WebView Escape (Lock Navigation) ---
  const handleShouldStartLoadWithRequest = (request: any) => {
    if (!article) return true;
    
    // Always allow internal about:blank or data: URIs (used by the WebView to load raw HTML)
    if (request.url.startsWith('data:') || request.url.startsWith('about:')) return true;

    if (!useDirectUri) {
      // In the clean sanitized HTML view, ANY external link click is blocked
      if (request.url.startsWith('http')) {
        Linking.openURL(request.url);
        return false;
      }
      return true;
    } else {
      // In the raw Substack URI view:
      // Substack heavily relies on server redirects (custom domains, slug changes, etc).
      // We allow all navigations during the initial load phase. Once the page is loaded,
      // the lock engages and intercepts any further user clicks.
      if (webViewInitialLoadRef.current) return true;

      const currentUrlBase = article.publicationUrl.split('?')[0];
      const reqUrlBase = request.url.split('?')[0];
      
      if (reqUrlBase === currentUrlBase) return true; // Just a query param change or anchor jump
      
      // User clicked a link to another page. Intercept and open in external browser.
      Linking.openURL(request.url);
      return false;
    }
  };

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
      // Automatically advance to the newly arrived article
      goToNext();
    }
  }, [queueExhausted, currentIndex, activeQueueIds.length, goToNext]);

  // --- Render ---
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} {...panResponder.panHandlers}>
<<<<<<< Updated upstream
      
      {/* HUD Overlay (Frosted Glass Panel Actions via expo-blur) */}
      <View style={styles.hudContainer}>
=======
        
      {/* HUD Overlay (Frosted Glass Panel Actions via expo-blur) */}
      <Animated.View style={[styles.hudContainer, { opacity: hudOpacity, transform: [{ translateY: hudTranslateY }] }]}>
>>>>>>> Stashed changes
        <BlurView 
          intensity={isDark ? 40 : 80} 
          tint={isDark ? 'dark' : 'light'} 
          style={styles.hudBlur}
        >
          <View style={styles.hudTopRow}>
            {/* Back/Close Button */}
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.hudBackButton}>
<<<<<<< Updated upstream
              <Text style={[styles.hudBackText, { color: colors.text }]}>✕</Text>
=======
              <X size={24} color={colors.text} />
>>>>>>> Stashed changes
            </TouchableOpacity>

            <Text style={[styles.hudTitle, { color: colors.text }]} numberOfLines={1}>
              {article?.publicationName || 'Reading'}
            </Text>

            <View style={styles.hudActions}>
              <TouchableOpacity
                onPress={() => {
<<<<<<< Updated upstream
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
=======
>>>>>>> Stashed changes
                  const newVal = !isSaved;
                  setIsSaved(newVal);
                  if (article) {
                    if (newVal) {
                      markArticleSaved(article.id, resolvedHtml);
                      if (!isRestrictedMode) behaviorTracker.trackEvent('save');
                    } else {
                      unmarkArticleSaved(article.id);
                    }
                  }
                }}
                style={styles.hudIconButton}
              >
<<<<<<< Updated upstream
                <Text style={styles.hudIcon}>{isSaved ? '🔖' : '🏷️'}</Text>
=======
                <Bookmark 
                  size={24} 
                  color={isSaved ? colors.accent : colors.text} 
                  fill={isSaved ? colors.accent : 'transparent'} 
                />
>>>>>>> Stashed changes
              </TouchableOpacity>
            </View>
          </View>
        </BlurView>
<<<<<<< Updated upstream
      </View>

      {/* Glowing Neon Laser Progress Bar at Bottom */}
=======
      </Animated.View>

      {/* Progress Bar at Bottom */}
>>>>>>> Stashed changes
      <View style={styles.bottomProgressBarContainer}>
        <Animated.View
          style={[
            styles.bottomProgressBarFill,
            {
<<<<<<< Updated upstream
              backgroundColor: colors.primary,
              shadowColor: colors.primary,
              shadowOffset: { width: 0, height: -2 },
              shadowOpacity: 0.5,
              shadowRadius: 8,
=======
              backgroundColor: colors.accent, // Red progress bar
>>>>>>> Stashed changes
              width: scrollProgress.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%']
              }),
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
          {article?.publicationUrl && (
            <TouchableOpacity
              style={[styles.catchUpButton, { backgroundColor: colors.primary, marginTop: 16 }]}
              onPress={() => Linking.openURL(article.publicationUrl)}
            >
              <Text style={[styles.catchUpButtonText, { color: colors.background }]}>Open in Browser</Text>
            </TouchableOpacity>
          )}
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
              source={{ uri: article.publicationUrl }}
              onMessage={handleWebViewMessage}
              onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
              onLoadEnd={() => { webViewInitialLoadRef.current = false; }}
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
  hudContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
  },
  hudBlur: {
<<<<<<< Updated upstream
    paddingTop: 54, // Safe area
    paddingHorizontal: 20,
=======
    paddingTop: 56, // Safe area
    paddingHorizontal: 24,
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(150,150,150,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hudBackText: {
    fontSize: 16,
    fontWeight: '800',
  },
  hudTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginHorizontal: 10,
    opacity: 0.9,
  },
  hudActions: { flexDirection: 'row', gap: 12 },
  hudIconButton: { 
    width: 36, 
    height: 36, 
    justifyContent: 'center', 
    alignItems: 'center', 
    borderRadius: 18,
    backgroundColor: 'rgba(150,150,150,0.15)',
  },
  hudIcon: { fontSize: 18 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 100 },
=======
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  hudTitle: {
    flex: 1,
    fontSize: 14,
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
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
>>>>>>> Stashed changes
  webview: { flex: 1, marginTop: 0 },
  catchUpContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyIcon: { marginBottom: 24 },
  catchUpTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  catchUpSubtitle: { fontSize: 16, textAlign: 'center', lineHeight: 24, marginBottom: 32 },
  catchUpButton: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 999,
  },
  catchUpButtonText: { fontSize: 16, fontWeight: '700' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  errorText: { fontSize: 16 },
  bottomProgressBarContainer: {
    height: 3,
    width: '100%',
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    backgroundColor: 'transparent',
  },
  bottomProgressBarFill: {
    height: '100%',
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
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
  edgeHintText: { fontSize: 14, opacity: 0.2 },
  archivedHeader: {
    paddingHorizontal: 24,
<<<<<<< Updated upstream
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  archivedTitle: {
    fontSize: 24,
=======
    paddingTop: 16,
    paddingBottom: 24,
    borderBottomWidth: 1,
  },
  archivedTitle: {
    fontSize: 28,
>>>>>>> Stashed changes
    fontWeight: '800',
    marginBottom: 8,
    fontFamily: 'Georgia',
    lineHeight: 34,
  },
  archivedAuthor: {
    fontSize: 14,
<<<<<<< Updated upstream
    fontWeight: '600',
    textTransform: 'uppercase',
=======
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
>>>>>>> Stashed changes
  },
});

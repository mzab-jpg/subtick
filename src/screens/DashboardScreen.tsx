// ============================================================
// SubTick — Dashboard Screen
// Full-screen flex layout inside a pull-to-refresh scroll view:
//   Header → Stats → Articles (flex:1) → Discover/Shuffle pill
// ============================================================

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useUser } from '../contexts/UserContext';
import { topInset } from '../utils/safeArea';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Article, UserProfile, RootStackParamList } from '../types';
import { User, Settings, Inbox, AlertTriangle } from 'lucide-react-native';
import { SURPRISE_ME_MIN_INDEX, MAX_FEED_ARTICLES, monoLabel } from '../utils/constants';
import { auth } from '../services/firebase';
import { getRankedFeed, getSeenArticleIdsLocally, markArticleSaved, getSavedArticleIds } from '../services/feedService';
import {
  getInitialDashboardFeedRequest,
  takeInitialDashboardFeedResult,
} from '../services/initialDashboardFeed';
import { flushBehaviorQueue, queueBehaviorEvent } from '../services/behaviorSync';
import { HomeLoadingState } from '../components/HomeLoadingState';
import { ScreenEntrance } from '../components/ScreenEntrance';
import { FeedHeroCard } from '../components/feed/FeedHeroCard';
import { SaveToStackSheet } from '../components/feed/SaveToStackSheet';
import {
  getCachedDashboardFeed,
  restoreCachedDashboardFeed,
  setCachedDashboardFeed,
  subscribeToCachedDashboardFeed,
} from '../services/dashboardFeedCache';

const PRELOAD_THRESHOLD = 5;

export default function DashboardScreen() {
  const { colors, fonts } = useTheme();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const { profile: contextProfile, weeklyReadCount, loading: contextLoading } = useUser();

  // App.tsx may prepare this UID's cards before Dashboard mounts. Read that
  // synchronous memory cache during state creation, not in a later effect, so
  // Home's first rendered frame already contains cards instead of Loading|.
  const initialCachedFeedRef = useRef(getCachedDashboardFeed(auth.currentUser?.uid || ''));
  const [feedArticles, setFeedArticles] = useState<Article[]>(() => initialCachedFeedRef.current?.articles ?? []);
  const [loading, setLoading] = useState(() => !initialCachedFeedRef.current?.articles.length);
  const [feedError, setFeedError] = useState<string | null>(null);
  // Accumulates every article ID shown this session (fetched OR shuffled away).
  // Passed to getRankedFeed as exclusions so we never recycle cards within a session.
  // In-memory only — resets on Dashboard unmount; articles reappear freely in future sessions.
  const sessionShownIds = useRef<Set<string>>(new Set(initialCachedFeedRef.current?.shownIds ?? []));
  const replenishingRef = useRef(false);
  const startupLoadHandledRef = useRef(false);


  // UserContext owns the one live profile subscription for every screen.
  const effectiveProfile = contextProfile;

  // Keep Dashboard current while it remains mounted behind Reader. Only opened
  // articles are removed; unread cards keep their exact order.
  useEffect(() => {
    const userId = auth.currentUser?.uid;
    if (!userId) return;
    return subscribeToCachedDashboardFeed(userId, (cached) => {
      if (!cached) return;
      sessionShownIds.current = new Set(cached.shownIds);
      setFeedArticles(cached.articles);
      if (cached.articles.length < MAX_FEED_ARTICLES) {
        void appendFeedArticles(effectiveProfile, cached.articles.map((article) => article.id));
      }
    });
  }, [effectiveProfile]);

  // --- Restore local cards first; Firebase profile/feed verification continues behind them. ---
  useEffect(() => {
    let active = true;
    const userId = auth.currentUser?.uid;

    const restoreOrLoad = async () => {
      if (!userId || startupLoadHandledRef.current) return;
      const cached = getCachedDashboardFeed(userId)
        ?? await restoreCachedDashboardFeed(userId, await getSeenArticleIdsLocally());
      if (!active) return;

      if (cached?.articles.length) {
        startupLoadHandledRef.current = true;
        sessionShownIds.current = new Set(cached.shownIds);
        setFeedArticles(cached.articles);
        setLoading(false);
        // H4 Fix: cached cards ARE the launch feed — no background re-fetch on a
        // healthy cache. When the cache is missing or below MAX_FEED_ARTICLES,
        // the subscriber effect makes exactly ONE ranked-feed request, and its
        // merged result is saved as next launch's cache via setCachedDashboardFeed.
        return;
      }

      // First launch/cache miss: wait for the verified profile before normal feed work.
      if (contextLoading) return;
      startupLoadHandledRef.current = true;
      void loadData(false);
    };

    void restoreOrLoad();
    return () => { active = false; };
  }, [contextLoading]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      // Keep visible cards stable after Reader closes; sync never blocks navigation.
      flushBehaviorQueue().catch(() => { });
    });
    return unsubscribe;
  }, [navigation]);


  const loadData = async (silent = false, forceFresh = false) => {
    try {
      if (!silent) setLoading(true);
      setFeedError(null);

      const user = auth.currentUser;
      if (!user) { if (!silent) setLoading(false); return; }

      // Use the shared profile from UserContext — no fetchUserProfile call needed.
      const profile = contextProfile;

      if (!profile) {
        // Brand-new user with no profile, or a profile still being created.
        navigation.replace('Onboarding');
        return;
      }
      if (!profile.isOnboarded) {
        navigation.replace('Onboarding');
        return;
      }
      await loadFeedArticles(profile, { forceFresh });
    } catch (error) {
      console.error('[Dashboard] loadData error:', error);
      setFeedError('Something went wrong loading your feed. Please try again.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadFeedArticles = async (profile: UserProfile | null, opts?: { forceFresh?: boolean }) => {
    try {
      // Use the shared live profile's server-side seen IDs to avoid the
      // getDoc inside getSeenArticleIdsLocally().
      const serverSeenIds = profile?.seenArticleIds;
      const seenIds = await getSeenArticleIdsLocally(serverSeenIds);
      const allExcluded = Array.from(new Set([...seenIds, ...sessionShownIds.current]));
      const startedAt = Date.now();
      if (__DEV__) console.log('[Startup Timing] first ranked feed requested');
      let result;
      if (opts?.forceFresh) {
        // Explicit user refresh/retry: hit the backend directly and exclude
        // everything currently on screen so the pull visibly swaps the whole
        // card set (unread-but-displayed cards would otherwise rank right
        // back in and keep the hero persistent).
        const visibleIds = feedArticles.map((article) => article.id);
        result = await getRankedFeed(Array.from(new Set([...allExcluded, ...visibleIds])));
      } else {
        const initialResult = auth.currentUser
          ? takeInitialDashboardFeedResult(auth.currentUser.uid)
          : null;
        const initialRequest = auth.currentUser
          ? getInitialDashboardFeedRequest(auth.currentUser.uid)
          : null;
        result = initialResult ?? await (initialRequest ?? getRankedFeed(allExcluded));
      }
      if (__DEV__) console.log(`[Startup Timing] ranked feed returned in ${Date.now() - startedAt}ms (${result.articles.length} articles)`);
      const articles = result.articles.slice(0, MAX_FEED_ARTICLES);
      setFeedArticles(articles);
      if (auth.currentUser) setCachedDashboardFeed(auth.currentUser.uid, articles, sessionShownIds.current);
      setFeedError(null);
    } catch (error) {
      console.error('[Dashboard] loadFeedArticles error:', error);
      // A failed load must never wipe visible cards (they remain useful).
      // The full error state appears only when there is nothing to show.
      if (feedArticles.length === 0) {
        setFeedError('Could not fetch articles. Check your connection and try again.');
      }
    }
  };

  const appendFeedArticles = async (profile: UserProfile | null, existingIds: string[]) => {
    if (replenishingRef.current) return;
    replenishingRef.current = true;
    try {
      const serverSeenIds = profile?.seenArticleIds;
      const seenIds = await getSeenArticleIdsLocally(serverSeenIds);
      const excludedIds = Array.from(new Set([...seenIds, ...sessionShownIds.current, ...existingIds]));
      const result = await getRankedFeed(excludedIds);
      const additions = result.articles.filter((article) => !excludedIds.includes(article.id));
      if (additions.length === 0) return;

      setFeedArticles((previous) => {
        const currentIds = new Set(previous.map((article) => article.id));
        const merged = [...previous, ...additions.filter((article) => !currentIds.has(article.id))];
        if (auth.currentUser) setCachedDashboardFeed(auth.currentUser.uid, merged, sessionShownIds.current);
        return merged;
      });
    } catch (error) {
      // Replenishment is optional. Keep the visible cards intact if it fails.
      console.warn('[Dashboard] appendFeedArticles failed:', error);
    } finally {
      replenishingRef.current = false;
    }
  };

  // ── Hero advance (B1) ──────────────────────────────────────────
  // Removes the current hero card (swipe-up / NEXT teaser / not-interested),
  // marks it shown, queues the matching behavior event and replenishes behind
  // the remaining cards. `swipe_not_interested` carries the algorithm's
  // strongest negative signal; `swipe_next` is neutral.
  const advanceHero = (eventType: 'swipe_next' | 'swipe_not_interested') => {
    if (feedArticles.length === 0) return;
    const [current, ...rest] = feedArticles;
    sessionShownIds.current.add(current.id);
    setFeedArticles(rest);
    if (auth.currentUser) setCachedDashboardFeed(auth.currentUser.uid, rest, sessionShownIds.current);
    void queueBehaviorEvent(
      current.id,
      eventType,
      current.category,
      current.lengthStyle,
      current.publicationName,
      0,
      0,
      undefined,
      current.recommendationContext
    );
    if (rest.length <= PRELOAD_THRESHOLD) {
      // Replenish behind the remaining cards; never replace them.
      void appendFeedArticles(effectiveProfile, rest.map((article) => article.id));
    }
  };

  // ── Save-to-stack (v1: single Saved vault destination) ─────────
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [saveSheetOpen, setSaveSheetOpen] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTextRef = useRef('');

  const refreshSavedIds = async () => {
    try {
      setSavedIds(new Set(await getSavedArticleIds()));
    } catch {
      // Saved-state decoration only — never block the hero.
    }
  };

  useEffect(() => {
    void refreshSavedIds();
  }, []);

  const showToast = (text: string) => {
    toastTextRef.current = text;
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(1900),
      Animated.timing(toastOpacity, { toValue: 0, duration: 260, useNativeDriver: true }),
    ]).start();
  };

  const handleSaveConfirmed = async () => {
    const hero = feedArticles[0];
    if (!hero) return;
    try {
      await markArticleSaved(hero.id, '', hero);
      void queueBehaviorEvent(
        hero.id,
        'save',
        hero.category,
        hero.lengthStyle,
        hero.publicationName,
        0,
        0,
        undefined,
        hero.recommendationContext
      );
      setSavedIds((prev) => new Set(prev).add(hero.id));
      showToast(`SAVED TO VAULT · ${hero.publicationName.toUpperCase()}`);
    } catch (error) {
      console.warn('[Dashboard] save failed:', error);
      showToast('SAVE FAILED — TRY AGAIN');
    }
  };

  const handleSurpriseMe = () => {
    if (feedArticles.length <= SURPRISE_ME_MIN_INDEX) {
      if (feedArticles.length > 0) navigateToReader(feedArticles[feedArticles.length - 1].id, feedArticles.length - 1);
      return;
    }
    const randomIndex = SURPRISE_ME_MIN_INDEX + Math.floor(Math.random() * (feedArticles.length - SURPRISE_ME_MIN_INDEX));
    navigateToReader(feedArticles[randomIndex].id, randomIndex);
  };

  const navigateToReader = (articleId: string, index: number) => {
    if (index < 0 || index >= feedArticles.length) return;

    // The backend has already randomized and then repaired this feed's order
    // for category and publisher variety. Preserve it in Reader. The tapped
    // card opens at its actual position instead of being reordered away.
    const orderedQueue = feedArticles.map((article) => article.id);
    const recommendationContexts = Object.fromEntries(
      feedArticles
        .filter((article) => !!article.recommendationContext)
        .map((article) => [article.id, article.recommendationContext!])
    );

    // Mark the tapped article as consumed so it is filtered out on the next
    // Dashboard focus after Reader is dismissed. We do NOT call
    // setFeedArticles here — that would cause a
    // visible re-render while the Reader modal is sliding up.
    sessionShownIds.current.add(articleId);
    if (auth.currentUser) setCachedDashboardFeed(auth.currentUser.uid, feedArticles, sessionShownIds.current);

    navigation.navigate('Reader', {
      articleId,
      queueArticleIds: orderedQueue,
      recommendationContexts,
      startIndex: index,
      userWpm: effectiveProfile?.averageWpm || 200,
      mode: 'feed',
    });
  };

  // Profile/stat verification must not hide already-prepared Dashboard cards.
  // A returning user can read immediately; the small stats row fills in once
  // UserContext's live profile arrives.
  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <HomeLoadingState />
      </View>
    );
  }

  const heroArticle = feedArticles.length > 0 ? feedArticles[0] : null;
  const nextArticle = feedArticles.length > 1 ? feedArticles[1] : null;
  const showEmptyState = !feedError && feedArticles.length === 0;

  return (
    <ScreenEntrance style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* ── Header: wordmark + account + gear (shared pattern) ── */}
      <View style={[styles.headerRow, { paddingTop: topInset + 10 }]}>
        <Text style={[styles.headerTitle, { color: colors.text, fontFamily: fonts.title }]}>
          TANGENT
        </Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => navigation.navigate('Account')}
            style={styles.iconButton}
            accessibilityLabel="Account"
          >
            <User size={22} color={colors.textSecondary} strokeWidth={1.8} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation.navigate('Settings')}
            style={styles.iconButton}
            accessibilityLabel="Settings"
          >
            <Settings size={22} color={colors.textSecondary} strokeWidth={1.8} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── One essay owns the screen ── */}
      {feedError && feedArticles.length === 0 ? (
        <View style={styles.centerState}>
          <AlertTriangle size={48} color={colors.error} style={{ marginBottom: 16 }} />
          <Text style={[styles.stateTitle, { color: colors.text, fontFamily: fonts.headline }]}>
            Something went wrong
          </Text>
          <Text style={[styles.stateSubtitle, { color: colors.textSecondary, fontFamily: fonts.body }]}>
            {feedError}
          </Text>
          <TouchableOpacity
            style={[styles.retryButton, { borderColor: colors.borderStrong }]}
            onPress={() => loadData(false, true)}
            activeOpacity={0.8}
          >
            <Text style={[monoLabel(fonts), { color: colors.text, letterSpacing: 1.2 }]}>
              TRY AGAIN
            </Text>
          </TouchableOpacity>
        </View>
      ) : heroArticle ? (
        <View style={styles.heroWrap}>
          <FeedHeroCard
            article={heroArticle}
            userWpm={effectiveProfile?.averageWpm || 200}
            nextTitle={nextArticle?.title || null}
            onRead={() => navigateToReader(heroArticle.id, 0)}
            onBookmark={() => setSaveSheetOpen(true)}
            onAdvance={() => advanceHero('swipe_next')}
            onSurprise={handleSurpriseMe}
          />
        </View>
      ) : showEmptyState ? (
        <View style={styles.centerState}>
          <Inbox size={48} color={colors.textMuted} style={{ marginBottom: 16 }} />
          <Text style={[styles.stateTitle, { color: colors.text, fontFamily: fonts.headline }]}>
            No articles yet
          </Text>
          <Text style={[styles.stateSubtitle, { color: colors.textSecondary, fontFamily: fonts.body }]}>
            Articles from your favorite Substacks will appear here once they&apos;re fetched.
          </Text>
        </View>
      ) : null}

      {/* ── Save sheet + toast ── */}
      <SaveToStackSheet
        visible={saveSheetOpen}
        alreadySaved={!!heroArticle && savedIds.has(heroArticle.id)}
        article={
          heroArticle
            ? {
                id: heroArticle.id,
                title: heroArticle.title,
                publicationName: heroArticle.publicationName,
                minutes:
                  heroArticle.estimatedReadMinutes ||
                  Math.ceil((heroArticle.wordCount || 0) / Math.max(120, effectiveProfile?.averageWpm || 200)),
              }
            : null
        }
        onClose={() => setSaveSheetOpen(false)}
        onFiled={(label) => showToast(label)}
        onSaveVault={handleSaveConfirmed}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.toast,
          {
            backgroundColor: colors.surfaceRaised,
            borderColor: colors.border,
            opacity: toastOpacity,
          },
        ]}
      >
        <Text style={[monoLabel(fonts), { color: colors.text }]} numberOfLines={1}>
          {toastTextRef.current}
        </Text>
      </Animated.View>
    </ScreenEntrance>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 10,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: 2.4,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroWrap: {
    flex: 1,
    paddingBottom: 10,
  },
  centerState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingBottom: 80,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  stateSubtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryButton: {
    marginTop: 24,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 4,
    borderWidth: 1,
  },
  toast: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 10,
    maxWidth: '88%',
  },
});
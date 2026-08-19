// ============================================================
// SubTick — Dashboard Screen
// Non-scrollable full-screen flex layout:
//   Header → Stats → Articles (flex:1) → Discover/Shuffle pill
// ============================================================

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useUser } from '../contexts/UserContext';
import { topInset } from '../utils/safeArea';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Article, UserProfile, DashboardMetric, RootStackParamList } from '../types';
import { User, Inbox, Shuffle, AlertTriangle } from 'lucide-react-native';
import { DASHBOARD_METRIC_DEFS, DEFAULT_DASHBOARD_METRIC_IDS, SURPRISE_ME_MIN_INDEX, MAX_FEED_ARTICLES, TEXT_XS, TEXT_SM, TEXT_BASE, TEXT_LG, TEXT_XL, TEXT_2XL } from '../utils/constants';
import { auth } from '../services/firebase';
import { getRankedFeed, getSeenArticleIdsLocally } from '../services/feedService';
import {
  getInitialDashboardFeedRequest,
  takeInitialDashboardFeedResult,
} from '../services/initialDashboardFeed';
import { flushBehaviorQueue } from '../services/behaviorSync';
import { HomeLoadingState } from '../components/HomeLoadingState';
import { getMetricIcon, getTopCategory, normalizeDashboardMetricIds } from '../utils/dashboardMetrics';
import {
  getCachedDashboardFeed,
  restoreCachedDashboardFeed,
  setCachedDashboardFeed,
  stageDashboardFeedForNextLaunch,
  subscribeToCachedDashboardFeed,
} from '../services/dashboardFeedCache';

const PRELOAD_THRESHOLD = 5;

export default function DashboardScreen() {
  const { colors } = useTheme();
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
        // Fresh recommendations are saved for the next launch. They never replace
        // cards already visible on this Dashboard.
        void refreshNextLaunchFeed(userId, cached.articles.map((article) => article.id));
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
      flushBehaviorQueue().catch(() => {});
    });
    return unsubscribe;
  }, [navigation]);


  const loadData = async (silent = false) => {
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
      await loadFeedArticles(profile);
    } catch (error) {
      console.error('[Dashboard] loadData error:', error);
      setFeedError('Something went wrong loading your feed. Please try again.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadFeedArticles = async (profile: UserProfile | null) => {
    try {
      // Use the shared live profile's server-side seen IDs to avoid the
      // getDoc inside getSeenArticleIdsLocally().
      const serverSeenIds = profile?.seenArticleIds;
      const seenIds = await getSeenArticleIdsLocally(serverSeenIds);
      const allExcluded = Array.from(new Set([...seenIds, ...sessionShownIds.current]));
      const startedAt = Date.now();
      if (__DEV__) console.log('[Startup Timing] first ranked feed requested');
      const initialResult = auth.currentUser
        ? takeInitialDashboardFeedResult(auth.currentUser.uid)
        : null;
      const initialRequest = auth.currentUser
        ? getInitialDashboardFeedRequest(auth.currentUser.uid)
        : null;
      const result = initialResult ?? await (initialRequest ?? getRankedFeed(allExcluded));
      if (__DEV__) console.log(`[Startup Timing] ranked feed returned in ${Date.now() - startedAt}ms (${result.articles.length} articles)`);
      const articles = result.articles.slice(0, MAX_FEED_ARTICLES);
      setFeedArticles(articles);
      if (auth.currentUser) setCachedDashboardFeed(auth.currentUser.uid, articles, sessionShownIds.current);
      setFeedError(null);
    } catch (error) {
      console.error('[Dashboard] loadFeedArticles error:', error);
      setFeedArticles([]);
      setFeedError('Could not fetch articles. Check your connection and try again.');
    }
  };

  const refreshNextLaunchFeed = async (userId: string, visibleIds: string[]) => {
    try {
      const seenIds = await getSeenArticleIdsLocally(effectiveProfile?.seenArticleIds);
      const excludedIds = Array.from(new Set([...seenIds, ...sessionShownIds.current, ...visibleIds]));
      const result = await getRankedFeed(excludedIds);
      const articles = result.articles.filter((article) => !excludedIds.includes(article.id)).slice(0, MAX_FEED_ARTICLES);
      if (articles.length > 0) stageDashboardFeedForNextLaunch(userId, articles, []);
    } catch {
      // Visible cached cards remain useful if background freshness fails.
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

  const getMetrics = (): DashboardMetric[] => {
    const profile = effectiveProfile;
    if (!profile) return [];
    const metricIds = normalizeDashboardMetricIds(profile.dashboardMetricIds || DEFAULT_DASHBOARD_METRIC_IDS);
    const values: Record<string, string | number> = {
      streak: profile.currentStreakDays || 0,
      weeklyReads: weeklyReadCount,
      topCategory: getTopCategory(profile),
      totalRead: profile.totalArticlesRead || 0,
      avgWpm: profile.averageWpm || 200,
      totalReadTime: profile.totalReadTimeMs
        ? Math.max(0.1, parseFloat((profile.totalReadTimeMs / 3_600_000).toFixed(1)))
        : 0,
    };
    return metricIds.map(id => {
      const def = DASHBOARD_METRIC_DEFS.find(d => d.id === id);
      return { id, label: def?.label || id, emoji: def?.emoji || '📊', value: values[id] || 0 };
    });
  };


  const handleShuffle = () => {
    const shown = feedArticles.slice(0, 3);
    const next = feedArticles.slice(3);
    shown.forEach((article) => sessionShownIds.current.add(article.id));
    setFeedArticles(next);
    if (auth.currentUser) setCachedDashboardFeed(auth.currentUser.uid, next, sessionShownIds.current);
    if (next.length <= PRELOAD_THRESHOLD) {
      // Replenish behind the remaining cards; never replace them.
      void appendFeedArticles(effectiveProfile, next.map((article) => article.id));
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

  const metrics = getMetrics();
  const heroArticle = feedArticles.length > 0 ? feedArticles[0] : null;
  const rowArticles = feedArticles.length > 1 ? feedArticles.slice(1, 3) : [];
  const showEmptyState = !feedError && feedArticles.length === 0;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.inner, { paddingTop: topInset + 16 }]}>

        {/* ── Header ── */}
        <View style={styles.headerRow}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>TANGENT</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={styles.iconButton}>
            <User size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* ── Stats Pill ── */}
        {metrics.length > 0 && (
          <View style={[styles.statsPill, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
            {metrics.map((metric, i) => (
              <React.Fragment key={metric.id}>
                <View style={styles.statItem}>
                  {getMetricIcon(metric.id, colors.textMuted)}
                  <Text style={[styles.statValue, { color: colors.text }]}>{metric.value}</Text>
                </View>
                {i < metrics.length - 1 && <View style={[styles.statDivider, { backgroundColor: colors.border }]} />}
              </React.Fragment>
            ))}
          </View>
        )}

        {/* ── Articles (flex:1 — fills all space between stats and button) ── */}
        <View style={styles.articles}>
          {feedError ? (
            <View style={styles.emptyState}>
              <AlertTriangle size={48} color={colors.error} style={{ marginBottom: 16 }} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Something went wrong</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                {feedError}
              </Text>
              <TouchableOpacity
                style={[styles.retryButton, { borderColor: colors.primary }]}
                onPress={() => loadData(false)}
                activeOpacity={0.7}
              >
                <Text style={[styles.retryText, { color: colors.primary }]}>Try Again</Text>
              </TouchableOpacity>
            </View>
          ) : feedArticles.length > 0 ? (
            <>
              {/* Hero */}
              {heroArticle && (
                <TouchableOpacity
                  style={styles.heroCard}
                  onPress={() => navigateToReader(heroArticle.id, 0)}
                  activeOpacity={0.9}
                >
                  <Text style={[styles.heroPublisher, { color: colors.accent }]}>
                    {heroArticle.publicationName.toUpperCase()}
                  </Text>
                  <Text style={[styles.heroTitle, { color: colors.text }]} numberOfLines={3}>
                    {heroArticle.title}
                  </Text>
                  {heroArticle.description ? (
                    <Text style={[styles.heroDesc, { color: colors.textSecondary }]} numberOfLines={2}>
                      {heroArticle.description}
                    </Text>
                  ) : null}
                  <View style={styles.cardMeta}>
                    <Text style={[styles.cardMetaText, { color: colors.textMuted }]}>
                      {heroArticle.category.charAt(0).toUpperCase() + heroArticle.category.slice(1)}
                    </Text>
                    <Text style={[styles.cardMetaText, { color: colors.textMuted }]}>
                      {Math.max(1, Math.ceil((heroArticle.wordCount || 0) / (effectiveProfile?.averageWpm || 200)))} min read
                    </Text>
                  </View>
                </TouchableOpacity>
              )}

              {/* Two row articles */}
              {rowArticles.map((article, index) => (
                <TouchableOpacity
                  key={article.id}
                  style={[styles.rowCard, { borderTopColor: colors.border }]}
                  onPress={() => navigateToReader(article.id, index + 1)}
                  activeOpacity={0.8}
                >
                  <View style={styles.rowCardContent}>
                    <Text style={[styles.rowPublisher, { color: colors.textSecondary }]}>
                      {article.publicationName}
                    </Text>
                    <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={2}>
                      {article.title}
                    </Text>
                  </View>
                  <Text style={[styles.rowTime, { color: colors.textMuted }]}>
                    {Math.max(1, Math.ceil((article.wordCount || 0) / (effectiveProfile?.averageWpm || 200)))}m
                  </Text>
                </TouchableOpacity>
              ))}
            </>
          ) : showEmptyState ? (
            <View style={styles.emptyState}>
              <Inbox size={48} color={colors.textMuted} style={{ marginBottom: 16 }} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No articles yet</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                Articles from your favorite Substacks will appear here once they're fetched.
              </Text>
            </View>
          ) : null}
        </View>

        {/* ── Discover / Shuffle pill (always at bottom) ── */}
        {feedArticles.length > 0 && !feedError && (
          <View style={[styles.pillRow, { backgroundColor: colors.text }]}>
            <View style={styles.pillSpacer} />
            <TouchableOpacity style={styles.pillDiscover} onPress={handleSurpriseMe} activeOpacity={0.85}>
              <Text style={[styles.pillDiscoverText, { color: colors.background }]}>Discover</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pillShuffle, { backgroundColor: colors.background, borderColor: colors.text }]}
              onPress={handleShuffle}
              activeOpacity={0.85}
            >
              <View style={{ transform: [{ rotate: '-90deg' }] }}>
                <Shuffle size={18} color={colors.accent} />
              </View>
            </TouchableOpacity>
          </View>
        )}

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  inner: { flex: 1, paddingHorizontal: 28, paddingBottom: 120 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 },
  headerTitle: { fontSize: TEXT_XL, fontWeight: '800', letterSpacing: -1 },
  iconButton: { padding: 4 },
  statsPill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingVertical: 16, borderRadius: 16,
    marginBottom: 42, borderWidth: 1,
  },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statValue: { fontSize: TEXT_BASE, fontWeight: '600', letterSpacing: -0.5 },
  statDivider: { width: 1, height: 16 },
  articles: { flex: 1, justifyContent: 'flex-start' },
  heroCard: { marginBottom: 24 },
  heroPublisher: { fontSize: TEXT_XS, fontWeight: '800', letterSpacing: 0.5, marginBottom: 8, textTransform: 'uppercase' },
  heroTitle: { fontSize: TEXT_2XL, fontWeight: '800', lineHeight: 34, letterSpacing: -0.8, marginBottom: 12, fontFamily: 'Georgia' },
  heroDesc: { fontSize: TEXT_BASE, lineHeight: 22, marginBottom: 12 },
  cardMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  cardMetaText: { fontSize: TEXT_SM, fontWeight: '500' },
  rowCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 20, borderTopWidth: 1 },
  rowCardContent: { flex: 1, paddingRight: 12 },
  rowPublisher: { fontSize: TEXT_XS, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase' },
  rowTitle: { fontSize: TEXT_LG, fontWeight: '700', lineHeight: 22, letterSpacing: -0.4 },
  rowTime: { fontSize: TEXT_SM, fontWeight: '500' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyTitle: { fontSize: TEXT_LG, fontWeight: '700', marginBottom: 8 },
  emptySubtitle: { fontSize: TEXT_SM, textAlign: 'center', lineHeight: 20 },
  retryButton: { marginTop: 24, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5 },
  retryText: { fontSize: TEXT_BASE, fontWeight: '700' },
  pillRow: { flexDirection: 'row', alignItems: 'stretch', borderRadius: 16, marginTop: 32 },
  pillSpacer: { width: 72 },
  pillDiscover: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 16 },
  pillDiscoverText: { fontSize: 18, fontWeight: '700' },
  pillShuffle: {
    width: 72, paddingVertical: 16, alignItems: 'center', justifyContent: 'center',
    borderTopRightRadius: 16, borderBottomRightRadius: 16,
    borderTopLeftRadius: 0, borderBottomLeftRadius: 0,
    borderWidth: 2, borderLeftWidth: 0,
  },
});
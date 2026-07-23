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
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Article, UserProfile, DashboardMetric, RootStackParamList } from '../types';
import { User, BarChart3, Clock, Flame, BookOpen, CalendarDays, Gauge, BookCheck, BookHeart, Inbox, Shuffle } from 'lucide-react-native';
import { DASHBOARD_METRIC_DEFS, DEFAULT_DASHBOARD_METRIC_IDS, SURPRISE_ME_MIN_INDEX, MAX_FEED_ARTICLES, TEXT_XS, TEXT_SM, TEXT_BASE, TEXT_LG, TEXT_XL, TEXT_2XL } from '../utils/constants';
import { auth, db } from '../services/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { fetchUserProfile, completeOnboarding } from '../services/auth';
import { getRankedFeed, getSeenArticleIds } from '../services/feedService';
import { flushBehaviorQueue } from '../services/behaviorSync';

const PRELOAD_THRESHOLD = 5;

export default function DashboardScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Dashboard'>>();

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [feedArticles, setFeedArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);

  // Accumulates every article ID shown this session (fetched OR shuffled away).
  // Passed to getRankedFeed as exclusions so we never recycle cards within a session.
  // In-memory only — resets on Dashboard unmount; articles reappear freely in future sessions.
  const sessionShownIds = useRef<Set<string>>(new Set());

  // --- Real-time profile listener — stats update instantly when Cloud Function writes back ---
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    const userRef = doc(db, 'users', user.uid);
    const unsubscribeSnapshot = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        const updated = snap.data() as import('../types').UserProfile;
        setUserProfile((prev) => {
          // Preserve local state — only update stats fields
          if (!prev) return updated;
          return {
            ...prev,
            currentStreakDays: updated.currentStreakDays,
            weeklyReadCount: updated.weeklyReadCount,
            totalArticlesRead: updated.totalArticlesRead,
            averageWpm: updated.averageWpm,
            totalReadTimeMs: updated.totalReadTimeMs,
            dashboardMetricIds: updated.dashboardMetricIds,
          };
        });
      }
    }, (error) => {
      console.error('[Dashboard] onSnapshot error:', error);
    });
    return () => unsubscribeSnapshot();
  }, []);

  // --- Load on mount; refresh profile silently on focus ---
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      // Instantly remove any seen articles from the displayed list (local AsyncStorage)
      getSeenArticleIds().then(seenIds => {
        if (seenIds.length > 0) {
          setFeedArticles(prev => prev.filter(a => !seenIds.includes(a.id)));
        }
      }).catch(() => {});

      // Perf fix: removed 800ms artificial delay. Flush in background then refresh profile.
      flushBehaviorQueue().catch(() => {}).finally(() => loadData(true));
    });

    loadData(false);
    return unsubscribe;
  }, [navigation]);

  // Onboarding race fix: await completeOnboarding before re-fetching the profile.
  useEffect(() => {
    if (route.params?.onboardingSelections) {
      const { selectedCategoryIds, notInterestedCategoryIds } = route.params.onboardingSelections;
      const userId = auth.currentUser?.uid;
      if (userId) {
        (async () => {
          try {
            await completeOnboarding(userId, selectedCategoryIds, notInterestedCategoryIds);
          } catch (err) {
            console.error('[Dashboard] completeOnboarding error:', err);
          }
          loadData(false);
        })();
      }
    }
  }, [route.params?.onboardingSelections]);

  const loadData = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const user = auth.currentUser;
      if (!user) { if (!silent) setLoading(false); return; }

      // Perf fix: removed redundant flushBehaviorQueue() — the focus listener
      // already flushes before calling loadData(true). On initial mount there
      // is nothing in the queue yet.

      const profile = await fetchUserProfile(user.uid);
      if (profile) {
        setUserProfile(profile);
        if (!profile.isOnboarded) { navigation.replace('Onboarding'); return; }
      }
      await loadFeedArticles(profile);
    } catch (error) {
      console.error('[Dashboard] loadData error:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadFeedArticles = async (profile: UserProfile | null) => {
    try {
      const seenIds = await getSeenArticleIds();
      // Merge persisted seen history with the full session accumulator.
      // sessionShownIds grows across every shuffle round so the cloud function
      // never returns any card already shown or discarded this session.
      // These IDs are NOT written to AsyncStorage — they reset on unmount and
      // articles will reappear naturally in future sessions.
      const allExcluded = Array.from(new Set([...seenIds, ...sessionShownIds.current]));
      const result = await getRankedFeed(allExcluded);
      const articles = result.articles.slice(0, MAX_FEED_ARTICLES);
      // Register every returned article so subsequent fetches exclude them too.
      articles.forEach(a => sessionShownIds.current.add(a.id));
      setFeedArticles(articles);
    } catch (error) {
      console.error('[Dashboard] loadFeedArticles error:', error);
      setFeedArticles([]);
    }
  };

  const getMetrics = (): DashboardMetric[] => {
    if (!userProfile) return [];
    const metricIds = userProfile.dashboardMetricIds || DEFAULT_DASHBOARD_METRIC_IDS;
    const values: Record<string, string | number> = {
      streak: userProfile.currentStreakDays || 0,
      weeklyReads: userProfile.weeklyReadCount || 0,
      topCategory: getTopCategory(),
      totalRead: userProfile.totalArticlesRead || 0,
      avgWpm: userProfile.averageWpm || 250,
      totalReadTime: userProfile.totalReadTimeMs
        ? Math.max(0.1, parseFloat((userProfile.totalReadTimeMs / 3_600_000).toFixed(1)))
        : 0,
    };
    return metricIds.slice(0, 3).map(id => {
      const def = DASHBOARD_METRIC_DEFS.find(d => d.id === id);
      return { id, label: def?.label || id, emoji: def?.emoji || '📊', value: values[id] || 0 };
    });
  };

  const getMetricIcon = (id: string, color: string) => {
    switch (id) {
      case 'streak': return <Flame size={16} color={color} />;
      case 'weeklyReads': return <CalendarDays size={16} color={color} />;
      case 'totalReadTime': return <Clock size={16} color={color} />;
      case 'avgWpm': return <Gauge size={16} color={color} />;
      case 'totalRead': return <BookCheck size={16} color={color} />;
      case 'topCategory': return <BookHeart size={16} color={color} />;
      default: return <BarChart3 size={16} color={color} />;
    }
  };

  const getTopCategory = (): string => {
    if (!userProfile) return '—';
    const weights = userProfile.categoryWeights;
    let topCat = '—'; let topWeight = 0;
    Object.entries(weights).forEach(([cat, w]) => {
      if (!cat.includes('::') && !cat.startsWith('pub::') && w > topWeight) {
        topWeight = w; topCat = cat;
      }
    });
    return topCat.charAt(0).toUpperCase() + topCat.slice(1)
      .replace('Philosophy & Human Behavior', 'Philosophy & Human');
  };

  // Shuffle: discard the top 3 cards, accumulate their IDs into the session exclusion set,
  // then refetch if the pool is running low. The new batch will never include any card
  // shown or discarded earlier this session.
  const handleShuffle = () => {
    setFeedArticles(prev => {
      // Register the discarded cards so refetches exclude them.
      prev.slice(0, 3).forEach(a => sessionShownIds.current.add(a.id));
      const next = prev.slice(3);
      if (next.length <= PRELOAD_THRESHOLD) {
        loadFeedArticles(userProfile).catch(() => {});
      }
      return next;
    });
  };

  const handleSurpriseMe = () => {
    if (feedArticles.length <= SURPRISE_ME_MIN_INDEX) {
      if (feedArticles.length > 0) navigateToReader(feedArticles[feedArticles.length - 1].id, feedArticles.length - 1);
      return;
    }
    const randomIndex = SURPRISE_ME_MIN_INDEX + Math.floor(Math.random() * (feedArticles.length - SURPRISE_ME_MIN_INDEX));
    navigateToReader(feedArticles[randomIndex].id, randomIndex);
  };

  // Instantly remove tapped card before navigating — no focus listener lag
  const navigateToReader = (articleId: string, index: number) => {
    if (index < 0 || index >= feedArticles.length) return;
    setFeedArticles(prev => prev.filter(a => a.id !== articleId));
    navigation.navigate('Reader', {
      articleId,
      queueArticleIds: feedArticles.map(a => a.id),
      startIndex: index,
      userWpm: userProfile?.averageWpm || 250,
      mode: 'feed',
    });
  };

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.text} />
      </View>
    );
  }

  const metrics = getMetrics();
  const heroArticle = feedArticles.length > 0 ? feedArticles[0] : null;
  const rowArticles = feedArticles.length > 1 ? feedArticles.slice(1, 3) : [];

  return (
    // Full-screen flex column — no ScrollView, never scrollable
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.inner}>

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
          {feedArticles.length > 0 ? (
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
                      {Math.max(1, Math.ceil((heroArticle.wordCount || 0) / (userProfile?.averageWpm || 250)))} min read
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
                    {Math.max(1, Math.ceil((article.wordCount || 0) / (userProfile?.averageWpm || 200)))}m
                  </Text>
                </TouchableOpacity>
              ))}
            </>
          ) : (
            <View style={styles.emptyState}>
              <Inbox size={48} color={colors.textMuted} style={{ marginBottom: 16 }} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No articles yet</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                Articles from your favorite Substacks will appear here once they're fetched.
              </Text>
            </View>
          )}
        </View>

        {/* ── Discover / Shuffle pill (always at bottom) ──
            Layout: [56px spacer] [flex:1 Discover] [56px Shuffle]
            Spacer mirrors shuffle width → "Discover" is optically centred.
            No absolute positioning, no overflow clipping. */}
        {feedArticles.length > 0 && (
          <View style={[styles.pillRow, { backgroundColor: colors.text }]}>
            {/* Invisible left spacer = width of shuffle button */}
            <View style={styles.pillSpacer} />

            {/* Discover */}
            <TouchableOpacity style={styles.pillDiscover} onPress={handleSurpriseMe} activeOpacity={0.85}>
              <Text style={[styles.pillDiscoverText, { color: colors.background }]}>Discover</Text>
            </TouchableOpacity>

            {/* Shuffle — bg is contrast colour, border ring is main pill colour (colors.text),
                icon is red accent. Icon wrapped in View for the rotation transform because
                Lucide SVG components ignore the style prop in React Native. */}
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
  // Full-screen container — never scrolls
  screen: {
    flex: 1,
  },
  // Inner flex column — fills the screen, stacks sections vertically
  inner: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 64,
    paddingBottom: 120,
  },

  // Header
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 32,
  },
  headerTitle: { fontSize: TEXT_XL, fontWeight: '800', letterSpacing: -1 },
  iconButton: { padding: 4 },

  // Stats pill
  statsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 16,
    marginBottom: 42,
    borderWidth: 1,
  },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statValue: { fontSize: TEXT_BASE, fontWeight: '600', letterSpacing: -0.5 },
  statDivider: { width: 1, height: 16 },

  // Articles area — flex:1 anchors the Discover bar at paddingBottom position.
  // flex-start stacks cards naturally without spreading them to fill the space.
  articles: {
    flex: 1,
    justifyContent: 'flex-start',
  },

  // Hero card
  heroCard: { marginBottom: 24 },
  heroPublisher: {
    fontSize: TEXT_XS, fontWeight: '800', letterSpacing: 0.5,
    marginBottom: 8, textTransform: 'uppercase',
  },
  heroTitle: {
    fontSize: TEXT_2XL, fontWeight: '800', lineHeight: 34,
    letterSpacing: -0.8, marginBottom: 12, fontFamily: 'Georgia',
  },
  heroDesc: { fontSize: TEXT_BASE, lineHeight: 22, marginBottom: 12 },
  cardMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  cardMetaText: { fontSize: TEXT_SM, fontWeight: '500' },

  // Row cards
  rowCard: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingVertical: 20, borderTopWidth: 1,
  },
  rowCardContent: { flex: 1, paddingRight: 12 },
  rowPublisher: {
    fontSize: TEXT_XS, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase',
  },
  rowTitle: { fontSize: TEXT_LG, fontWeight: '700', lineHeight: 22, letterSpacing: -0.4 },
  rowTime: { fontSize: TEXT_SM, fontWeight: '500' },

  // Empty state
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyTitle: { fontSize: TEXT_LG, fontWeight: '700', marginBottom: 8 },
  emptySubtitle: { fontSize: TEXT_SM, textAlign: 'center', lineHeight: 20 },

  // ── Discover / Shuffle pill ──
  // NO overflow:'hidden' — that clips the rightmost child in RN
  pillRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: 16,
    marginTop: 32,
  },
  // Invisible spacer mirrors shuffle width to optically centre "Discover"
  pillSpacer: { width: 72 },
  // Discover section: flex:1 so text is centred in the remaining space
  pillDiscover: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  pillDiscoverText: { fontSize: 18, fontWeight: '700' },
  // Shuffle section: wider, flat left edge (straight where it meets Discover),
  // rounded right edge only. Has a visible border ring in colors.text.
  pillShuffle: {
    width: 72,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    borderWidth: 2,
    borderLeftWidth: 0,
  },
});
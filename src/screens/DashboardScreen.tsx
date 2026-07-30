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
import { useUser } from '../contexts/UserContext';
import { topInset } from '../utils/safeArea';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Article, UserProfile, DashboardMetric, RootStackParamList } from '../types';
import { User, BarChart3, Clock, Flame, BookOpen, CalendarDays, Gauge, BookCheck, BookHeart, Inbox, Shuffle, AlertTriangle } from 'lucide-react-native';
import { DASHBOARD_METRIC_DEFS, DEFAULT_DASHBOARD_METRIC_IDS, SURPRISE_ME_MIN_INDEX, MAX_FEED_ARTICLES, TEXT_XS, TEXT_SM, TEXT_BASE, TEXT_LG, TEXT_XL, TEXT_2XL } from '../utils/constants';
import { auth, db } from '../services/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { completeOnboarding } from '../services/auth';
import { getRankedFeed, getSeenArticleIdsLocally } from '../services/feedService';
import { flushBehaviorQueue } from '../services/behaviorSync';

const PRELOAD_THRESHOLD = 5;

export default function DashboardScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Dashboard'>>();
  const { profile: contextProfile, loading: contextLoading, refreshProfile } = useUser();

  const [feedArticles, setFeedArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedError, setFeedError] = useState<string | null>(null);

  // Accumulates every article ID shown this session (fetched OR shuffled away).
  // Passed to getRankedFeed as exclusions so we never recycle cards within a session.
  // In-memory only — resets on Dashboard unmount; articles reappear freely in future sessions.
  const sessionShownIds = useRef<Set<string>>(new Set());

  // Hold the most recent profile data from the real-time listener.
  // We merge contextProfile with live stat deltas so the Dashboard always
  // shows the freshest stats without maintaining a full separate copy.
  const [liveProfile, setLiveProfile] = useState<UserProfile | null>(null);

  // The "effective" profile: contextProfile from UserContext, overlaid with
  // live stat updates from onSnapshot. This is the single source of truth
  // the Dashboard renders from.
  const effectiveProfile = liveProfile || contextProfile;

  // --- Real-time profile listener — stats update instantly when Cloud Function writes back ---
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    const userRef = doc(db, 'users', user.uid);
    const unsubscribeSnapshot = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        const updated = snap.data() as UserProfile;
        setLiveProfile((prev) => {
          // Merge: start from context or previous live state, overlay fresh stat fields
          const base = prev || contextProfile;
          if (!base) return updated;
          return {
            ...base,
            currentStreakDays: updated.currentStreakDays,
            weeklyReadCount: updated.weeklyReadCount,
            totalArticlesRead: updated.totalArticlesRead,
            averageWpm: updated.averageWpm,
            totalReadTimeMs: updated.totalReadTimeMs,
            dashboardMetricIds: updated.dashboardMetricIds,
            seenArticleIds: updated.seenArticleIds,
          };
        });
      }
    }, (error) => {
      console.error('[Dashboard] onSnapshot error:', error);
    });
    return () => unsubscribeSnapshot();
  }, [contextProfile]);

  // --- Load on mount; refresh seen filter silently on focus ---
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      // Use the server-side seen IDs from the live profile to avoid a
      // redundant Firestore getDoc inside getSeenArticleIds(). This removes
      // one of the three duplicate document reads that happened on every focus.
      const serverSeenIds = liveProfile?.seenArticleIds || effectiveProfile?.seenArticleIds;
      getSeenArticleIdsLocally(serverSeenIds).then(seenIds => {
        if (seenIds.length > 0) {
          setFeedArticles(prev => {
            const filtered = prev.filter(a => !seenIds.includes(a.id));
            if (filtered.length === 0 && prev.length > 0) {
              loadData(true);
            }
            return filtered;
          });
        }
      }).catch(() => {});

      // Flush behavior events in background
      flushBehaviorQueue().catch(() => {});
      // Refresh the shared context profile (replaces the old fetchUserProfile call)
      refreshProfile().catch(() => {});
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
      setFeedError(null);

      const user = auth.currentUser;
      if (!user) { if (!silent) setLoading(false); return; }

      // Use the shared profile from UserContext — no fetchUserProfile call needed.
      const profile = contextProfile;
      if (!profile) {
        // Brand-new user with no Firestore profile (e.g. fresh anonymous
        // sign-in after a sign-out). Redirect to onboarding.
        navigation.replace('Onboarding');
        return;
      }
      if (!profile.isOnboarded) { navigation.replace('Onboarding'); return; }
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
      // Use the server-side seen IDs from the live profile to avoid the
      // getDoc inside getSeenArticleIds. This eliminates the second Firestore read.
      const serverSeenIds = liveProfile?.seenArticleIds || profile?.seenArticleIds;
      const seenIds = await getSeenArticleIdsLocally(serverSeenIds);
      const allExcluded = Array.from(new Set([...seenIds, ...sessionShownIds.current]));
      const result = await getRankedFeed(allExcluded);
      const articles = result.articles.slice(0, MAX_FEED_ARTICLES);
      setFeedArticles(articles);
      setFeedError(null);
    } catch (error) {
      console.error('[Dashboard] loadFeedArticles error:', error);
      setFeedArticles([]);
      setFeedError('Could not fetch articles. Check your connection and try again.');
    }
  };

  const getMetrics = (): DashboardMetric[] => {
    const profile = effectiveProfile;
    if (!profile) return [];
    const metricIds = profile.dashboardMetricIds || DEFAULT_DASHBOARD_METRIC_IDS;
    const values: Record<string, string | number> = {
      streak: profile.currentStreakDays || 0,
      weeklyReads: profile.weeklyReadCount || 0,
      topCategory: getTopCategory(),
      totalRead: profile.totalArticlesRead || 0,
      avgWpm: profile.averageWpm || 250,
      totalReadTime: profile.totalReadTimeMs
        ? Math.max(0.1, parseFloat((profile.totalReadTimeMs / 3_600_000).toFixed(1)))
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
    const profile = effectiveProfile;
    if (!profile) return '—';
    const weights = profile.categoryWeights || {};
    let topCat = '—'; let topWeight = 0;
    Object.entries(weights).forEach(([cat, w]) => {
      if (!cat.includes('::') && !cat.startsWith('pub::') && w > topWeight) {
        topWeight = w; topCat = cat;
      }
    });
    return topCat;
  };

  const handleShuffle = () => {
    setFeedArticles(prev => {
      prev.slice(0, 3).forEach(a => sessionShownIds.current.add(a.id));
      const next = prev.slice(3);
      if (next.length <= PRELOAD_THRESHOLD) {
        loadFeedArticles(effectiveProfile).catch(() => {});
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

  const navigateToReader = (articleId: string, index: number) => {
    if (index < 0 || index >= feedArticles.length) return;
    const remainingArticles = feedArticles.filter(a => a.id !== articleId);
    setFeedArticles(remainingArticles);
    const shuffledQueue = [...remainingArticles]
      .sort(() => Math.random() - 0.5)
      .map(a => a.id);
    navigation.navigate('Reader', {
      articleId,
      queueArticleIds: shuffledQueue,
      startIndex: 0,
      userWpm: effectiveProfile?.averageWpm || 250,
      mode: 'feed',
    });
  };

  if (loading || contextLoading) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.text} />
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
                      {Math.max(1, Math.ceil((heroArticle.wordCount || 0) / (effectiveProfile?.averageWpm || 250)))} min read
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
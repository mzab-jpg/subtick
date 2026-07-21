// ============================================================
// SubTick — Dashboard Screen (Editorial Redesign)
// Hero layout, sleek pill stats, clean list rows.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Article, UserProfile, DashboardMetric, RootStackParamList } from '../types';
import { User, BarChart3, Clock, Zap, BookOpen, Inbox, Shuffle } from 'lucide-react-native';
import { DASHBOARD_METRIC_DEFS, DEFAULT_DASHBOARD_METRIC_IDS, SURPRISE_ME_MIN_INDEX, MAX_FEED_ARTICLES } from '../utils/constants';
import { auth } from '../services/firebase';
import { fetchUserProfile, completeOnboarding } from '../services/auth';
import { getRankedFeed, getSeenArticleIds } from '../services/feedService';
import { flushBehaviorQueue } from '../services/behaviorSync';

// Minimum remaining articles before a background refetch is triggered
const PRELOAD_THRESHOLD = 5;

export default function DashboardScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Dashboard'>>();

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [feedArticles, setFeedArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);

  // --- Load user profile & feed on mount and focus ---
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', async () => {
      // FIX #1: Filter seen articles INSTANTLY from local AsyncStorage before any
      // network work begins. This removes the just-read card from the display
      // within ~50ms of returning to the dashboard, with no loading state.
      try {
        const seenIds = await getSeenArticleIds();
        if (seenIds.length > 0) {
          setFeedArticles((prev) => prev.filter((a) => !seenIds.includes(a.id)));
        }
      } catch (err) {
        // ignore
      }

      // Then flush + refresh profile in the background (non-blocking).
      // This updates the stats bar after the server processes the session.
      // The article list is already visually correct by the time this completes.
      (async () => {
        try {
          await flushBehaviorQueue();
          // Give the server ~800ms to process the events before reading back updated stats
          await new Promise(resolve => setTimeout(resolve, 800));
        } catch (err) {
          // Silent fail — proceed to refresh anyway
        }
        loadData(true);
      })();
    });

    loadData(false);

    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    if (route.params?.onboardingSelections) {
      const { selectedCategoryIds, notInterestedCategoryIds } = route.params.onboardingSelections;
      const userId = auth.currentUser?.uid;
      if (userId) {
        completeOnboarding(userId, selectedCategoryIds, notInterestedCategoryIds)
          .then(() => loadData(false));
      }
    }
  }, [route.params?.onboardingSelections]);

  const loadData = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const user = auth.currentUser;
      if (!user) {
        if (!silent) setLoading(false);
        return;
      }

      try {
        await flushBehaviorQueue();
      } catch (err) {
        // silent fail
      }

      const profile = await fetchUserProfile(user.uid);
      if (profile) {
        setUserProfile(profile);
        if (!profile.isOnboarded) {
          navigation.replace('Onboarding');
          return;
        }
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
      const result = await getRankedFeed(seenIds);
      setFeedArticles(result.articles.slice(0, MAX_FEED_ARTICLES));
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
        ? Math.max(0.1, parseFloat((userProfile.totalReadTimeMs / (1000 * 60 * 60)).toFixed(1)))
        : 0,
    };

    return metricIds.slice(0, 3).map((id) => {
      const def = DASHBOARD_METRIC_DEFS.find((d) => d.id === id);
      return {
        id,
        label: def?.label || id,
        emoji: def?.emoji || '📊',
        value: values[id] || 0,
      };
    });
  };

  const getMetricIcon = (id: string, color: string) => {
    switch (id) {
      case 'streak': return <Zap size={16} color={color} />;
      case 'weeklyReads': return <BookOpen size={16} color={color} />;
      case 'totalReadTime': return <Clock size={16} color={color} />;
      default: return <BarChart3 size={16} color={color} />;
    }
  };

  const getTopCategory = (): string => {
    if (!userProfile) return '—';
    const weights = userProfile.categoryWeights;
    let topCat = '—';
    let topWeight = 0;
    // Only consider plain category keys (not composite length/publisher keys)
    Object.entries(weights).forEach(([cat, w]) => {
      if (!cat.includes('::') && !cat.startsWith('pub::') && w > topWeight) {
        topWeight = w;
        topCat = cat;
      }
    });
    const name = topCat.charAt(0).toUpperCase() + topCat.slice(1);
    // Shorten long category names so they fit in the stats bar
    return name.replace('Philosophy & Human Behavior', 'Philosophy & Human');
  };

  const handleSurpriseMe = () => {
    if (feedArticles.length <= SURPRISE_ME_MIN_INDEX) {
      if (feedArticles.length > 0) {
        navigateToReader(feedArticles[feedArticles.length - 1].id, feedArticles.length - 1);
      }
      return;
    }
    const randomIndex = SURPRISE_ME_MIN_INDEX + Math.floor(Math.random() * (feedArticles.length - SURPRISE_ME_MIN_INDEX));
    navigateToReader(feedArticles[randomIndex].id, randomIndex);
  };

  // FIX #2: Shuffle removes the top 3 displayed articles entirely.
  // They are sliced off the front of feedArticles so neither the dashboard
  // nor the Reader queue can reach them. If ≤ PRELOAD_THRESHOLD articles
  // remain, a silent background refetch is triggered automatically.
  const handleShuffle = () => {
    setFeedArticles((prev) => {
      const next = prev.slice(3);
      if (next.length <= PRELOAD_THRESHOLD) {
        // Fire background refetch — don't await, don't show loading state
        loadFeedArticles(userProfile).catch(() => {});
      }
      return next;
    });
  };

  const navigateToReader = (articleId: string, index: number) => {
    if (index < 0 || index >= feedArticles.length) return;
    // Immediately remove the tapped article from the displayed list so the
    // card is already gone when the user swipes back — no focus listener needed.
    setFeedArticles((prev) => prev.filter((a) => a.id !== articleId));
    navigation.navigate('Reader', {
      articleId,
      queueArticleIds: feedArticles.map((a) => a.id),
      startIndex: index,
      userWpm: userProfile?.averageWpm || 250,
      mode: 'feed',
    });
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.text} />
      </View>
    );
  }

  const metrics = getMetrics();
  const heroArticle = feedArticles.length > 0 ? feedArticles[0] : null;
  const rowArticles = feedArticles.length > 1 ? feedArticles.slice(1, 3) : [];

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} showsVerticalScrollIndicator={false}>
      <View style={styles.content}>
        {/* Header Row */}
        <View style={styles.headerRow}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>SUBTICK</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={styles.iconButton}>
              <User size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Stats Pill Bar */}
        {metrics.length > 0 && (
          <View style={[styles.statsPillContainer, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
            {metrics.map((metric, index) => (
              <React.Fragment key={metric.id}>
                <View style={styles.statPillItem}>
                  {getMetricIcon(metric.id, colors.textMuted)}
                  <Text style={[styles.statValue, { color: colors.text }]}>{metric.value}</Text>
                </View>
                {index < metrics.length - 1 && (
                  <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                )}
              </React.Fragment>
            ))}
          </View>
        )}

        {feedArticles.length > 0 ? (
          <View style={styles.editorialContainer}>

            {/* 1. Hero Article */}
            {heroArticle && (
              <TouchableOpacity
                style={styles.heroCard}
                onPress={() => navigateToReader(heroArticle.id, 0)}
                activeOpacity={0.9}
              >
                <Text style={[styles.heroPublisher, { color: colors.accent }]}>
                  {heroArticle.publicationName.toUpperCase()}
                </Text>
                <Text style={[styles.heroTitle, { color: colors.text }]} numberOfLines={4}>
                  {heroArticle.title}
                </Text>
                {heroArticle.description ? (
                  <Text style={[styles.heroDescription, { color: colors.textSecondary }]} numberOfLines={2}>
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

            {/* 2. Sub-Row Articles */}
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
                <View style={styles.rowMetaContent}>
                  <Text style={[styles.rowTime, { color: colors.textMuted }]}>
                    {Math.max(1, Math.ceil((article.wordCount || 0) / (userProfile?.averageWpm || 250)))}m
                  </Text>
                </View>
              </TouchableOpacity>
            ))}

          </View>
        ) : (
          <View style={styles.emptyState}>
            <Inbox size={48} color={colors.textMuted} style={styles.emptyIcon} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No articles yet</Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              Articles from your favorite Substacks will appear here once they're fetched.
            </Text>
          </View>
        )}

        {/* Split Discover / Shuffle pill.
            Uses a symmetric spacer layout to true-centre "Discover" across
            the full pill width without any absolute positioning or overflow
            clipping conflicts:
              [56px spacer] [flex:1 Discover] [56px Shuffle button]
            The spacer mirrors the shuffle button width exactly. */}
        {feedArticles.length > 0 && (
          <View style={[styles.discoverRow, { backgroundColor: colors.text, marginTop: 40 }]}>
            {/* Left spacer — mirrors shuffle button width to centre text */}
            <View style={styles.discoverSpacer} />

            {/* Discover — flex:1 centres text across the full remaining space */}
            <TouchableOpacity
              style={styles.discoverLeft}
              onPress={handleSurpriseMe}
              activeOpacity={0.85}
            >
              <Text style={[styles.discoverText, { color: colors.background }]}>Discover</Text>
            </TouchableOpacity>

            {/* Shuffle — same width as spacer; bg is contrast colour, icon is accent */}
            <TouchableOpacity
              style={[styles.discoverRight, { backgroundColor: colors.background, borderLeftColor: colors.border }]}
              onPress={handleShuffle}
              activeOpacity={0.85}
            >
              <Shuffle size={18} color={colors.accent} style={{ transform: [{ rotate: '-90deg' }] }} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 28, paddingTop: 80, paddingBottom: 64 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 36,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  iconButton: {
    padding: 4,
  },
  statsPillContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 18,
    borderRadius: 16,
    marginBottom: 52,
    borderWidth: 1,
  },
  statPillItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statValue: { fontSize: 16, fontWeight: '600', letterSpacing: -0.5 },
  statDivider: {
    width: 1,
    height: 16,
  },
  editorialContainer: {
    gap: 0,
    // Fixed height reserves exactly enough space for all 3 cards at all times.
    // The button below is therefore always at the same Y position regardless
    // of how many cards are currently shown.
    height: 560,
  },
  heroCard: {
    marginBottom: 40,
  },
  heroPublisher: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  heroTitle: {
    fontSize: 32,
    fontWeight: '800',
    lineHeight: 38,
    letterSpacing: -1,
    marginBottom: 16,
    fontFamily: 'Georgia',
  },
  heroDescription: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 16,
  },
  cardMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardMetaText: {
    fontSize: 14,
    fontWeight: '500',
  },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 24,
    borderTopWidth: 1,
  },
  rowCardContent: {
    flex: 1,
    paddingRight: 16,
  },
  rowPublisher: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  rowTitle: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
    letterSpacing: -0.5,
  },
  rowMetaContent: {
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  rowTime: {
    fontSize: 14,
    fontWeight: '500',
  },
  emptyState: {
    padding: 32,
    alignItems: 'center',
    marginTop: 24,
  },
  emptyIcon: { marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20 },

  // --- Split Discover / Shuffle pill ---
  // Layout: [56px spacer] [flex:1 Discover] [56px Shuffle]
  // The left spacer mirrors the shuffle button width so the "Discover"
  // label is optically centred across the entire pill. No absolute
  // positioning — avoids the overflow:hidden clipping issue.
  discoverRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: 999,
    overflow: 'hidden',
  },
  discoverSpacer: {
    width: 56,
  },
  discoverLeft: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  discoverText: {
    fontSize: 16,
    fontWeight: '700',
  },
  discoverRight: {
    width: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
});

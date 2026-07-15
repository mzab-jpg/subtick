// ============================================================
// SubTick — Dashboard Screen
// Stats bar, top 3 feed stack, Surprise Me, hamburger menu.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Article, UserProfile, DashboardMetric } from '../types';
import { DASHBOARD_METRIC_DEFS, DEFAULT_DASHBOARD_METRIC_IDS, SURPRISE_ME_MIN_INDEX, MAX_FEED_ARTICLES } from '../utils/constants';
import { calculateArticleScore } from '../utils/scoring';
import { auth } from '../services/firebase';
import { fetchUserProfile, completeOnboarding } from '../services/auth';
import { getRankedFeed, getSeenArticleIds } from '../services/feedService';

export default function DashboardScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [feedArticles, setFeedArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [surpriseArticle, setSurpriseArticle] = useState<Article | null>(null);

  // --- Load user profile & feed on mount ---
  useEffect(() => {
    loadData();
  }, []);

  // --- Process onboarding selections if coming from Onboarding ---
  useEffect(() => {
    if (route.params?.onboardingSelections) {
      const { selectedCategoryIds, notInterestedCategoryIds } = route.params.onboardingSelections;
      const userId = auth.currentUser?.uid;
      if (userId) {
        completeOnboarding(userId, selectedCategoryIds, notInterestedCategoryIds)
          .then(() => loadData());
      }
    }
  }, [route.params?.onboardingSelections]);

  const loadData = async () => {
    try {
      setLoading(true);
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        return;
      }

      // Fetch user profile
      const profile = await fetchUserProfile(user.uid);
      if (profile) {
        setUserProfile(profile);

        // If not onboarded, redirect
        if (!profile.isOnboarded) {
          navigation.replace('Onboarding');
          return;
        }
      }

      // Fetch top articles (simple client-side query; Cloud Function getRankedFeed preferred in production)
      await loadFeedArticles(profile);
    } catch (error) {
      console.error('[Dashboard] loadData error:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadFeedArticles = async (profile: UserProfile | null) => {
    try {
      // Call the deployed getRankedFeed Cloud Function — scores articles
      // using the 5-component formula with user's category weights
      const seenIds = await getSeenArticleIds();
      const result = await getRankedFeed(seenIds);

      // Already ranked server-side by the scoring formula
      setFeedArticles(result.articles.slice(0, MAX_FEED_ARTICLES));
    } catch (error) {
      console.error('[Dashboard] loadFeedArticles error:', error);
      // Show empty state gracefully — user can pull to refresh
      setFeedArticles([]);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, []);

  // --- Build Dashboard Metrics ---
  const getMetrics = (): DashboardMetric[] => {
    if (!userProfile) return [];
    const metricIds = userProfile.dashboardMetricIds || DEFAULT_DASHBOARD_METRIC_IDS;

    const values: Record<string, string | number> = {
      streak: userProfile.currentStreakDays,
      weeklyReads: userProfile.weeklyReadCount,
      topCategory: getTopCategory(),
      totalRead: userProfile.totalArticlesRead,
      totalSaved: userProfile.totalArticlesSaved,
      totalLiked: userProfile.totalArticlesLiked,
      avgWpm: userProfile.averageWpm,
      weeklyStreak: `${userProfile.weeklyReadCount} this week`,
      exploreScore: feedArticles.length,
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

  const getTopCategory = (): string => {
    if (!userProfile) return '—';
    const weights = userProfile.categoryWeights;
    let topCat = '—';
    let topWeight = 0;
    Object.entries(weights).forEach(([cat, w]) => {
      if (w > topWeight) {
        topWeight = w;
        topCat = cat;
      }
    });
    const def = DASHBOARD_METRIC_DEFS.find((d) => d.id === 'topCategory');
    return topCat.charAt(0).toUpperCase() + topCat.slice(1);
  };

  // --- Surprise Me ---
  const handleSurpriseMe = () => {
    if (feedArticles.length <= SURPRISE_ME_MIN_INDEX) {
      // Not enough articles — pick the last one or do nothing
      if (feedArticles.length > 0) {
        navigateToReader(feedArticles[feedArticles.length - 1].id, feedArticles.length - 1);
      }
      return;
    }
    const randomIndex = SURPRISE_ME_MIN_INDEX + Math.floor(Math.random() * (feedArticles.length - SURPRISE_ME_MIN_INDEX));
    navigateToReader(feedArticles[randomIndex].id, randomIndex);
  };

  // --- Navigate to Reader ---
  const navigateToReader = (articleId: string, index: number) => {
    // Guard against out-of-bounds
    if (index < 0 || index >= feedArticles.length) return;
    navigation.navigate('Reader', {
      articleId,
      queueArticleIds: feedArticles.map((a) => a.id),
      startIndex: index,
    });
  };

  // --- Loading / Empty States ---
  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading your feed...</Text>
      </View>
    );
  }

  const metrics = getMetrics();

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
    >
      {/* Header Row */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={styles.menuButton}>
          <Text style={[styles.menuIcon, { color: colors.text }]}>☰</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>SubTick</Text>
        <View style={styles.menuButton} />
      </View>

      {/* Stats Bar */}
      {metrics.length > 0 && (
        <View style={styles.statsRow}>
          {metrics.map((metric) => (
            <View
              key={metric.id}
              style={[styles.statCard, { backgroundColor: colors.surface, shadowColor: colors.cardShadow }]}
            >
              <Text style={styles.statEmoji}>{metric.emoji}</Text>
              <Text style={[styles.statValue, { color: colors.text }]}>{metric.value}</Text>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>{metric.label}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Section Title */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Your Feed</Text>
        <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>
          Top {Math.min(3, feedArticles.length)} recommended reads
        </Text>
      </View>

      {/* Feed Stack (Top 3) */}
      {feedArticles.length > 0 ? (
        feedArticles.slice(0, 3).map((article, index) => (
          <TouchableOpacity
            key={article.id}
            style={[styles.feedCard, { backgroundColor: colors.surface, shadowColor: colors.cardShadow }]}
            onPress={() => navigateToReader(article.id, index)}
            activeOpacity={0.85}
          >
            {/* Category Badge */}
            <View style={[styles.categoryBadge, { backgroundColor: colors.primaryLight }]}>
              <Text style={[styles.categoryText, { color: colors.primary }]}>
                {article.category.charAt(0).toUpperCase() + article.category.slice(1)}
              </Text>
            </View>

            <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={3}>
              {article.title}
            </Text>

            {article.description ? (
              <Text style={[styles.cardDescription, { color: colors.textSecondary }]} numberOfLines={2}>
                {article.description}
              </Text>
            ) : null}

            <View style={styles.cardMeta}>
              <Text style={[styles.cardMetaText, { color: colors.textMuted }]}>
                {article.publicationName}
              </Text>
              <Text style={[styles.cardMetaText, { color: colors.textMuted }]}>
                {article.estimatedReadMinutes} min read
              </Text>
            </View>
          </TouchableOpacity>
        ))
      ) : (
        <View style={[styles.emptyState, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <Text style={styles.emptyEmoji}>📭</Text>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No articles yet</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Articles from your favorite Substacks will appear here once they're fetched.
          </Text>
        </View>
      )}

      {/* Surprise Me Button */}
      {feedArticles.length > 0 && (
        <TouchableOpacity
          style={[styles.surpriseButton, { borderColor: colors.accent }]}
          onPress={handleSurpriseMe}
          activeOpacity={0.75}
        >
          <Text style={styles.surpriseEmoji}>🎲</Text>
          <Text style={[styles.surpriseText, { color: colors.accent }]}>Surprise Me</Text>
        </TouchableOpacity>
      )}

      {/* See All Link */}
      {feedArticles.length > 3 && (
        <TouchableOpacity
          style={styles.seeAllButton}
          onPress={() => {
            if (feedArticles.length > 0) navigateToReader(feedArticles[0].id, 0);
          }}
        >
          <Text style={[styles.seeAllText, { color: colors.primary }]}>
            See all {feedArticles.length} articles →
          </Text>
        </TouchableOpacity>
      )}

      <View style={{ height: 48 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 15 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 48,
    marginBottom: 24,
  },
  menuButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  menuIcon: { fontSize: 26 },
  headerTitle: { fontSize: 22, fontWeight: '800' },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 28 },
  statCard: {
    flex: 1,
    padding: 14,
    borderRadius: 14,
    alignItems: 'center',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  statEmoji: { fontSize: 22, marginBottom: 4 },
  statValue: { fontSize: 20, fontWeight: '800' },
  statLabel: { fontSize: 11, fontWeight: '600', marginTop: 2, textAlign: 'center' },
  sectionHeader: { marginBottom: 16 },
  sectionTitle: { fontSize: 22, fontWeight: '700' },
  sectionSubtitle: { fontSize: 14, marginTop: 4 },
  feedCard: {
    padding: 18,
    borderRadius: 16,
    marginBottom: 12,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 12,
  },
  categoryText: { fontSize: 12, fontWeight: '700' },
  cardTitle: { fontSize: 18, fontWeight: '700', lineHeight: 24, marginBottom: 8 },
  cardDescription: { fontSize: 14, lineHeight: 20, marginBottom: 12 },
  cardMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  cardMetaText: { fontSize: 12, fontWeight: '500' },
  emptyState: {
    padding: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyEmoji: { fontSize: 40, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  surpriseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 2,
    marginTop: 4,
    marginBottom: 12,
  },
  surpriseEmoji: { fontSize: 22, marginRight: 10 },
  surpriseText: { fontSize: 17, fontWeight: '700' },
  seeAllButton: { alignItems: 'center', padding: 12 },
  seeAllText: { fontSize: 15, fontWeight: '600' },
});
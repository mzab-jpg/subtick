// ============================================================
// SubTick — Dashboard Screen
// Stats bar, top 2 feed stack, Surprise Me, hamburger menu.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
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
import { DASHBOARD_METRIC_DEFS, DEFAULT_DASHBOARD_METRIC_IDS, SURPRISE_ME_MIN_INDEX, MAX_FEED_ARTICLES } from '../utils/constants';
import { auth } from '../services/firebase';
import { fetchUserProfile, completeOnboarding } from '../services/auth';
import { getRankedFeed, getSeenArticleIds } from '../services/feedService';
import { flushBehaviorQueue } from '../services/behaviorSync';

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
      // 1. Optimistically filter out seen articles instantly for snappy UI
      try {
        const seenIds = await getSeenArticleIds();
        if (seenIds.length > 0) {
          setFeedArticles((prev) => prev.filter((a) => !seenIds.includes(a.id)));
        }
      } catch (err) {
        // ignore
      }

      // 2. Re-fetch silently when returning to this screen (this will flush and get new recommendations)
      loadData(true);
    });
    
    // Initial loud fetch
    loadData(false);
    
    return unsubscribe;
  }, [navigation]);

  // --- Process onboarding selections if coming from Onboarding ---
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

      // Flush any pending behaviors from ReaderScreen before fetching new feed
      // so that recommendations and seen history are completely up-to-date.
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
    return topCat.charAt(0).toUpperCase() + topCat.slice(1);
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

  const navigateToReader = (articleId: string, index: number) => {
    if (index < 0 || index >= feedArticles.length) return;
    navigation.navigate('Reader', {
      articleId,
      queueArticleIds: feedArticles.map((a) => a.id),
      startIndex: index,
      userWpm: userProfile?.averageWpm || 250,
    });
  };

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
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        {/* Header Row */}
        <View style={styles.headerRow}>
          <View style={styles.menuButton} />
          <Text style={[styles.headerTitle, { color: colors.text }]}>SubTick</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={styles.menuButton}>
            <Text style={[styles.menuIcon, { color: colors.text }]}>☰</Text>
          </TouchableOpacity>
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

        {/* Feed Stack (Top 3 Overlapping Physics-based Deck) */}
        {feedArticles.length > 0 ? (
          <View style={styles.deckContainer}>
            {feedArticles.slice(0, 3).map((article, index) => {
              // Create physical-looking overlapping stack indices
              // 0 is top (closest), 1 is middle, 2 is bottom
              const scale = 1 - index * 0.04;
              const translateY = index * 12; // downward cascading stack overlap
              const zIndex = 10 - index;
              const opacity = 1 - index * 0.15;

              return (
                <TouchableOpacity
                  key={article.id}
                  style={[
                    styles.feedCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      shadowColor: colors.cardShadow,
                      zIndex,
                      opacity,
                      transform: [
                        { scale },
                        { translateY }
                      ],
                    }
                  ]}
                  onPress={() => navigateToReader(article.id, index)}
                  activeOpacity={0.9}
                >
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
                      {Math.max(1, Math.ceil((article.wordCount || 0) / (userProfile?.averageWpm || 250)))} min read
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, padding: 16, paddingBottom: 16, paddingTop: 32 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 15 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  menuButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  menuIcon: { fontSize: 26 },
  headerTitle: { fontSize: 22, fontWeight: '800' },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statCard: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  statEmoji: { fontSize: 20, marginBottom: 4 },
  statValue: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  statLabel: { fontSize: 10, fontWeight: '700', marginTop: 4, opacity: 0.8, textTransform: 'uppercase', textAlign: 'center' },
  sectionHeader: { marginBottom: 14 },
  sectionTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  sectionSubtitle: { fontSize: 13, marginTop: 2, opacity: 0.8 },
  deckContainer: {
    height: 380, // Set height to contain absolute stacked items safely
    position: 'relative',
    marginVertical: 10,
  },
  feedCard: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    padding: 20,
    borderRadius: 24,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 5,
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginBottom: 10,
  },
  categoryText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.2 },
  cardTitle: { fontSize: 18, fontWeight: '800', lineHeight: 24, letterSpacing: -0.4, marginBottom: 8 },
  cardDescription: { fontSize: 13, lineHeight: 18, marginBottom: 12 },
  cardMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.04)' },
  cardMetaText: { fontSize: 12, fontWeight: '600', opacity: 0.8 },
  emptyState: {
    flex: 1,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: 8,
  },
  emptyEmoji: { fontSize: 36, marginBottom: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  emptySubtitle: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
  surpriseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 2,
    marginTop: 2,
  },
  surpriseEmoji: { fontSize: 20, marginRight: 8 },
  surpriseText: { fontSize: 15, fontWeight: '700' },
});

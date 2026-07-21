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
<<<<<<< Updated upstream
=======
  Image,
>>>>>>> Stashed changes
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Article, UserProfile, DashboardMetric, RootStackParamList } from '../types';
import { User, Search, BarChart3, Clock, Zap, BookOpen, Inbox } from 'lucide-react-native';
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
      try {
        const seenIds = await getSeenArticleIds();
        if (seenIds.length > 0) {
          setFeedArticles((prev) => prev.filter((a) => !seenIds.includes(a.id)));
        }
      } catch (err) {
        // ignore
      }

      loadData(true);
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
<<<<<<< Updated upstream
          <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={styles.menuButton}>
            <View style={[styles.menuLine, { backgroundColor: colors.text }]} />
            <View style={[styles.menuLine, { backgroundColor: colors.text, width: 14 }]} />
          </TouchableOpacity>
=======
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={() => {}} style={styles.iconButton}>
              <Search size={24} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={styles.iconButton}>
              <User size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
>>>>>>> Stashed changes
        </View>

        {/* Stats Pill Bar */}
        {metrics.length > 0 && (
          <View style={[styles.statsPillContainer, { backgroundColor: colors.surfaceSecondary }]}>
            {metrics.map((metric, index) => (
              <React.Fragment key={metric.id}>
                <View style={styles.statPillItem}>
<<<<<<< Updated upstream
                  <Text style={styles.statEmoji}>{metric.emoji}</Text>
=======
                  {getMetricIcon(metric.id, colors.textMuted)}
>>>>>>> Stashed changes
                  <Text style={[styles.statValue, { color: colors.text }]}>{metric.value}</Text>
                </View>
                {index < metrics.length - 1 && (
                  <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                )}
              </React.Fragment>
            ))}
          </View>
        )}

        {/* Editorial Feed */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>EDITION</Text>
        </View>

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
<<<<<<< Updated upstream
            <Text style={styles.emptyEmoji}>📭</Text>
=======
            <Inbox size={48} color={colors.textMuted} style={styles.emptyIcon} />
>>>>>>> Stashed changes
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No articles yet</Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              Articles from your favorite Substacks will appear here once they're fetched.
            </Text>
          </View>
        )}

        {/* Surprise Me Button */}
        {feedArticles.length > 0 && (
          <TouchableOpacity
            style={[styles.surpriseButton, { backgroundColor: colors.text }]}
            onPress={handleSurpriseMe}
            activeOpacity={0.85}
          >
            <Text style={[styles.surpriseText, { color: colors.background }]}>Discover</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
<<<<<<< Updated upstream
  content: { padding: 24, paddingTop: 60, paddingBottom: 40 },
=======
  content: { padding: 24, paddingTop: 64, paddingBottom: 48 },
>>>>>>> Stashed changes
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
<<<<<<< Updated upstream
    marginBottom: 24,
  },
  headerTitle: { 
    fontSize: 24, 
    fontWeight: '900', 
    letterSpacing: -1,
    fontFamily: 'System'
  },
  menuButton: { 
    width: 32, 
    height: 32, 
    justifyContent: 'center', 
    alignItems: 'flex-end',
    gap: 4
  },
  menuLine: {
    height: 2,
    width: 20,
    borderRadius: 1,
  },
  statsPillContainer: { 
    flexDirection: 'row', 
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 100, // perfect pill
    marginBottom: 32,
  },
  statPillItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statEmoji: { fontSize: 16 },
  statValue: { fontSize: 16, fontWeight: '700', letterSpacing: -0.5 },
=======
    marginBottom: 32,
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
    paddingVertical: 16,
    borderRadius: 16,
    marginBottom: 40,
    borderWidth: 1,
  },
  statPillItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statValue: { fontSize: 16, fontWeight: '600', letterSpacing: -0.5 },
>>>>>>> Stashed changes
  statDivider: {
    width: 1,
    height: 16,
  },
  sectionHeader: { marginBottom: 16 },
<<<<<<< Updated upstream
  sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 1 },
=======
  sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
>>>>>>> Stashed changes
  editorialContainer: {
    gap: 0,
  },
  heroCard: {
<<<<<<< Updated upstream
    marginBottom: 24,
=======
    marginBottom: 32,
>>>>>>> Stashed changes
  },
  heroPublisher: { 
    fontSize: 12, 
    fontWeight: '800', 
    letterSpacing: 0.5, 
<<<<<<< Updated upstream
    marginBottom: 8 
=======
    marginBottom: 8,
    textTransform: 'uppercase'
>>>>>>> Stashed changes
  },
  heroTitle: { 
    fontSize: 32, 
    fontWeight: '800', 
    lineHeight: 38, 
    letterSpacing: -1, 
<<<<<<< Updated upstream
    marginBottom: 12 
=======
    marginBottom: 16,
    fontFamily: 'Georgia',
>>>>>>> Stashed changes
  },
  heroDescription: { 
    fontSize: 16, 
    lineHeight: 24, 
<<<<<<< Updated upstream
    marginBottom: 16 
=======
    marginBottom: 16,
  },
  heroImage: {
    width: '100%',
    height: 200,
    borderRadius: 16,
    marginBottom: 16,
>>>>>>> Stashed changes
  },
  cardMeta: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center'
  },
  cardMetaText: { 
<<<<<<< Updated upstream
    fontSize: 13, 
    fontWeight: '600' 
=======
    fontSize: 14, 
    fontWeight: '500' 
>>>>>>> Stashed changes
  },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
<<<<<<< Updated upstream
    paddingVertical: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
=======
    paddingVertical: 24,
    borderTopWidth: 1,
>>>>>>> Stashed changes
  },
  rowCardContent: {
    flex: 1,
    paddingRight: 16,
  },
  rowPublisher: {
    fontSize: 12,
    fontWeight: '600',
<<<<<<< Updated upstream
    marginBottom: 4,
=======
    marginBottom: 8,
    textTransform: 'uppercase'
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
    fontSize: 13,
    fontWeight: '600',
=======
    fontSize: 14,
    fontWeight: '500',
>>>>>>> Stashed changes
  },
  emptyState: {
    padding: 32,
    alignItems: 'center',
<<<<<<< Updated upstream
    marginTop: 20,
  },
  emptyEmoji: { fontSize: 40, marginBottom: 12 },
=======
    marginTop: 24,
  },
  emptyIcon: { marginBottom: 16 },
>>>>>>> Stashed changes
  emptyTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  surpriseButton: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
<<<<<<< Updated upstream
    borderRadius: 100,
    marginTop: 32,
  },
  surpriseText: { fontSize: 16, fontWeight: '800', letterSpacing: -0.5 },
=======
    borderRadius: 999,
    marginTop: 40,
  },
  surpriseText: { fontSize: 16, fontWeight: '700' },
>>>>>>> Stashed changes
});

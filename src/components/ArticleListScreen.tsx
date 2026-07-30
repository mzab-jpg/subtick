// ============================================================
// SubTick — Article List Screen (shared)
// Reusable offline-first article list used by HistoryScreen
// and SavedReadsScreen. Renders FlatList with publication name,
// title, and read time. Includes empty and error states.
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { topInset } from '../utils/safeArea';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types';
import { ScreenHeader } from './ScreenHeader';
import { AlertTriangle } from 'lucide-react-native';
import { LucideIcon } from 'lucide-react-native';
import { TEXT_XS, TEXT_SM, TEXT_LG } from '../utils/constants';

interface ArticleMeta {
  id: string;
  title: string;
  publicationName: string;
  category: string;
  estimatedReadMinutes: number;
}

interface ArticleListScreenProps {
  title: string;
  loadFunction: () => Promise<ArticleMeta[]>;
  emptyIcon: LucideIcon;
  emptyTitle: string;
  emptySubtitle: string;
  readerMode: 'history' | 'saved';
  /** If true, also load on initial mount (not just focus). Default true. */
  loadOnMount?: boolean;
}

export function ArticleListScreen({
  title,
  loadFunction,
  emptyIcon: EmptyIcon,
  emptyTitle,
  emptySubtitle,
  readerMode,
  loadOnMount = true,
}: ArticleListScreenProps) {
  const { colors } = useTheme();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();

  const [articles, setArticles] = useState<ArticleMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const metas = await loadFunction();
      setArticles(metas);
    } catch (error) {
      console.error(`[ArticleListScreen:${title}] load error:`, error);
      setLoadError('Could not load your articles. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Load on focus (fires on mount AND every subsequent focus)
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      load();
    });
    return unsubscribe;
  }, [navigation]);

  // Also load on initial mount if requested (SavedReads needs this)
  useEffect(() => {
    if (loadOnMount) {
      load();
    }
  }, []);

  const navigateToReader = (articleId: string, index: number) => {
    navigation.navigate('Reader', {
      articleId,
      queueArticleIds: articles.map((a) => a.id),
      startIndex: index,
      mode: readerMode,
    });
  };

  if (loading && articles.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title={title} onBack={() => navigation.goBack()} />

      {loadError ? (
        <View style={styles.emptyState}>
          <AlertTriangle size={48} color={colors.error} style={styles.emptyIcon} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Something went wrong</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            {loadError}
          </Text>
          <TouchableOpacity
            style={[styles.retryButton, { borderColor: colors.primary }]}
            onPress={() => load()}
            activeOpacity={0.7}
          >
            <Text style={[styles.retryText, { color: colors.primary }]}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : articles.length === 0 ? (
        <View style={styles.emptyState}>
          <EmptyIcon size={48} color={colors.textMuted} style={styles.emptyIcon} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>{emptyTitle}</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            {emptySubtitle}
          </Text>
        </View>
      ) : (
        <FlatList
          data={articles}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => (
            <TouchableOpacity
              style={[styles.rowCard, { borderBottomColor: colors.border }]}
              onPress={() => navigateToReader(item.id, index)}
              activeOpacity={0.8}
            >
              <View style={styles.rowCardContent}>
                <Text style={[styles.rowPublisher, { color: colors.textSecondary }]}>
                  {item.publicationName}
                </Text>
                <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={2}>
                  {item.title}
                </Text>
              </View>
              <Text style={[styles.rowTime, { color: colors.textMuted }]}>
                {item.estimatedReadMinutes}m
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingHorizontal: 24, paddingBottom: 48 },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 24,
    borderBottomWidth: 1,
  },
  rowCardContent: {
    flex: 1,
    paddingRight: 16,
  },
  rowPublisher: {
    fontSize: TEXT_XS,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  rowTitle: {
    fontSize: TEXT_LG,
    fontWeight: '700',
    lineHeight: 24,
    letterSpacing: -0.5,
  },
  rowTime: {
    fontSize: TEXT_SM,
    fontWeight: '500',
  },
  emptyState: {
    flex: 1,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  emptyIcon: { marginBottom: 16 },
  emptyTitle: { fontSize: TEXT_LG, fontWeight: '700', marginBottom: 8 },
  emptySubtitle: { fontSize: TEXT_SM, textAlign: 'center', lineHeight: 20 },
  retryButton: { marginTop: 24, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5 },
  retryText: { fontSize: TEXT_SM, fontWeight: '700' },
});
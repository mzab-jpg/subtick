// ============================================================
// SubTick — History Screen
// Shows the user's reading history using locally cached metadata.
// No Firestore reads — loads instantly from device storage.
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
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types';
import { getSeenArticleMetas } from '../services/feedService';
import { ChevronLeft, Inbox } from 'lucide-react-native';
import { TEXT_XS, TEXT_SM, TEXT_LG } from '../utils/constants';

interface ArticleMeta {
  id: string;
  title: string;
  publicationName: string;
  category: string;
  estimatedReadMinutes: number;
}

export default function HistoryScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();

  const [articles, setArticles] = useState<ArticleMeta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      setLoading(true);
      // Load from local device storage — no network needed
      const metas = await getSeenArticleMetas(30);
      setArticles(metas);
    } catch (error) {
      console.error('[History] loadHistory error:', error);
    } finally {
      setLoading(false);
    }
  };

  const navigateToReader = (articleId: string) => {
    // Mode 'history' prevents swiping and weight tracking
    navigation.navigate('Reader', {
      articleId,
      queueArticleIds: [articleId],
      startIndex: 0,
      mode: 'history',
    });
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ChevronLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>History</Text>
        <View style={styles.backButton} />
      </View>

      {articles.length === 0 ? (
        <View style={styles.emptyState}>
          <Inbox size={48} color={colors.textMuted} style={styles.emptyIcon} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No history yet</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Articles you've read will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={articles}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.rowCard, { borderBottomColor: colors.border }]}
              onPress={() => navigateToReader(item.id)}
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 64,
    paddingBottom: 24,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
  },
  backButton: { width: 40, alignItems: 'flex-start' },
  headerTitle: { fontSize: TEXT_LG, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
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
});

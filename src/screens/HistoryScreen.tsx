// ============================================================
// SubTick — History Screen
// Shows the user's reading history (seen articles).
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
import { Article } from '../types';
import { getSeenArticleIds, getArticleById } from '../services/feedService';

export default function HistoryScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();

  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      setLoading(true);
      const seenIds = await getSeenArticleIds();
      // Only fetch the last 30 for performance reasons
      const recentIds = seenIds.slice(-30).reverse();
      
      const fetchedArticles: Article[] = [];
      for (const id of recentIds) {
        const article = await getArticleById(id);
        if (article) {
          fetchedArticles.push(article);
        }
      }
      setArticles(fetchedArticles);
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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={[styles.closeText, { color: colors.primary }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Reading History</Text>
        <View style={{ width: 60 }} />
      </View>

      {articles.length === 0 ? (
        <View style={styles.centered}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No history yet. Start reading!
          </Text>
        </View>
      ) : (
        <FlatList
          data={articles}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.articleCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => navigateToReader(item.id)}
            >
              <Text style={[styles.articleTitle, { color: colors.text }]} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={[styles.articleMeta, { color: colors.textMuted }]}>
                {item.publicationName} · {item.category}
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
    marginTop: 48,
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  closeText: { fontSize: 16, fontWeight: '600' },
  headerTitle: { fontSize: 20, fontWeight: '800' },
  listContent: { padding: 20, paddingBottom: 48 },
  articleCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  articleTitle: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  articleMeta: { fontSize: 13 },
  emptyText: { fontSize: 16 },
});

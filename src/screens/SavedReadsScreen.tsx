// ============================================================
// SubTick — Saved Reads Screen
// Shows the user's saved articles.
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
import { getSavedArticleIds, getArticleById } from '../services/feedService';
import { ChevronLeft, Bookmark } from 'lucide-react-native';

export default function SavedReadsScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();

  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);

  // We add a listener to re-fetch when returning from Reader
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadSaved();
    });
    loadSaved();
    return unsubscribe;
  }, [navigation]);

  const loadSaved = async () => {
    try {
      setLoading(true);
      const savedIds = await getSavedArticleIds();
      const recentIds = savedIds.slice(-50).reverse(); // limit to 50 for performance
      
      const fetchedArticles: Article[] = [];
      for (const id of recentIds) {
        const article = await getArticleById(id);
        if (article) {
          fetchedArticles.push(article);
        }
      }
      setArticles(fetchedArticles);
    } catch (error) {
      console.error('[SavedReads] loadSaved error:', error);
    } finally {
      setLoading(false);
    }
  };

  const navigateToReader = (articleId: string, index: number) => {
    // Mode 'saved' allows swiping chronologically without weight tracking
    navigation.navigate('Reader', {
      articleId,
      queueArticleIds: articles.map(a => a.id),
      startIndex: index,
      mode: 'saved',
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
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ChevronLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Saved</Text>
        <View style={styles.backButton} />
      </View>

      {articles.length === 0 ? (
        <View style={styles.emptyState}>
          <Bookmark size={48} color={colors.textMuted} style={styles.emptyIcon} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No saved articles</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Articles you save will appear here.
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
  headerTitle: { fontSize: 18, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
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
  },
  rowPublisher: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase'
  },
  rowTitle: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
    letterSpacing: -0.5,
  },
  emptyState: {
    flex: 1,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  emptyIcon: { marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});

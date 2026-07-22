// ============================================================
// SubTick — Developer Options Screen
// Sandbox reader + local data reset. Debug builds only.
// ============================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useNavigation } from '@react-navigation/native';
import { Article } from '../types';
import {
  TEXT_XS,
  TEXT_SM,
  TEXT_BASE,
  TEXT_LG,
} from '../utils/constants';
import { ChevronLeft, TerminalSquare, Trash2 } from 'lucide-react-native';

export default function DeveloperOptionsScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();

  const [devSandboxUrl, setDevSandboxUrl] = useState('');
  const [testingDevSandbox, setTestingDevSandbox] = useState(false);

  const handleDevSandboxTest = () => {
    const url = devSandboxUrl.trim();
    if (!url) {
      Alert.alert('Empty URL', 'Please enter a URL to test.');
      return;
    }

    const mockArticle: Article = {
      id: 'test_sandbox_123',
      title: 'Developer Sandbox Test',
      author: 'Tester',
      publicationName: 'Sandbox',
      publicationUrl: url,
      feedUrl: '',
      guid: url,
      category: 'Technology & Innovation',
      lengthStyle: 'medium',
      publishDate: Date.now(),
      cacheTimestamp: Date.now(),
      isPaywalled: false,
      estimatedReadMinutes: 5,
      trendingScore: 0,
      qualityScore: 1,
      isSeed: false,
      rssStatus: 'archived',
    };

    navigation.navigate('Reader', { articleId: 'test_sandbox_123', mockArticle });
  };

  const handleClearLocalData = () => {
    Alert.alert(
      'Reset Local Data',
      'This will permanently wipe your reading history, saved articles, and behavior queue from this device. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Wipe Data',
          style: 'destructive',
          onPress: async () => {
            try {
              const AsyncStorage = require('@react-native-async-storage/async-storage').default;
              await AsyncStorage.clear();
              Alert.alert('Cleared', 'Local storage has been completely wiped.');
            } catch (e) {
              Alert.alert('Error', 'Failed to clear local storage.');
            }
          },
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <ChevronLeft size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Developer Options</Text>
          <View style={styles.backButton} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Warning banner */}
          <View style={[styles.warningBanner, { backgroundColor: colors.warning + '22', borderColor: colors.warning }]}>
            <Text style={[styles.warningText, { color: colors.warning }]}>
              ⚠️  These tools are for development and testing only. Actions here may affect your real data.
            </Text>
          </View>

          {/* Section: Sandbox Reader */}
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>SANDBOX READER</Text>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardDescription, { color: colors.textMuted }]}>
              Test how any Substack URL renders in the Reader — exactly as a user would see it.
            </Text>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, color: colors.text },
              ]}
              placeholder="https://kyla.substack.com/p/..."
              placeholderTextColor={colors.textMuted}
              value={devSandboxUrl}
              onChangeText={setDevSandboxUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <TouchableOpacity
              style={[
                styles.actionButton,
                { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
              ]}
              onPress={handleDevSandboxTest}
              disabled={testingDevSandbox}
              activeOpacity={0.7}
            >
              {testingDevSandbox ? (
                <ActivityIndicator color={colors.text} style={{ marginRight: 8 }} />
              ) : (
                <TerminalSquare size={18} color={colors.text} style={{ marginRight: 8 }} />
              )}
              <Text style={[styles.actionButtonText, { color: colors.text }]}>Test URL in Reader</Text>
            </TouchableOpacity>
          </View>

          {/* Section: Danger Zone */}
          <Text style={[styles.sectionLabel, { color: colors.textMuted, marginTop: 32 }]}>DANGER ZONE</Text>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.error + '44' }]}>
            <Text style={[styles.cardDescription, { color: colors.textMuted }]}>
              Permanently removes all locally cached data including reading history, saved articles, and the offline behavior queue.
            </Text>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.error + '18', borderColor: colors.error, borderWidth: 1 }]}
              onPress={handleClearLocalData}
              activeOpacity={0.7}
            >
              <Trash2 size={18} color={colors.error} style={{ marginRight: 8 }} />
              <Text style={[styles.actionButtonText, { color: colors.error }]}>Clear Local Data</Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 48 }} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 64,
    paddingBottom: 20,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
  },
  backButton: { width: 40, alignItems: 'flex-start' },
  headerTitle: { fontSize: TEXT_LG, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  scrollContent: { paddingHorizontal: 28, paddingTop: 28 },
  warningBanner: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 28,
  },
  warningText: { fontSize: TEXT_SM, lineHeight: 20, fontWeight: '500' },
  sectionLabel: {
    fontSize: TEXT_XS,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  card: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  cardDescription: { fontSize: TEXT_SM, lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: TEXT_BASE,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 12,
  },
  actionButtonText: { fontSize: TEXT_BASE, fontWeight: '600' },
});

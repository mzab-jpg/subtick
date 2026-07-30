// ============================================================
// SubTick — Feed Request Screen (modal)
// ============================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { topInset } from '../utils/safeArea';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { auth, db } from '../services/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { FeedRequest, RootStackParamList } from '../types';
import { validateFeedRequest } from '../utils/validation';
import { TEXT_SM, TEXT_BASE, TEXT_LG } from '../utils/constants';
import { ScreenHeader } from '../components/ScreenHeader';
import { Rss } from 'lucide-react-native';

export default function FeedRequestScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();

  const [feedUrl, setFeedUrl] = useState('');
  const [feedDescription, setFeedDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const validation = validateFeedRequest(feedUrl, feedDescription);
    if (!validation.isValid) {
      Alert.alert('Invalid', validation.errorMessage);
      return;
    }
    if (!auth.currentUser) return;

    setSubmitting(true);
    try {
      const request: Omit<FeedRequest, 'id'> = {
        userId: auth.currentUser.uid,
        url: feedUrl.trim(),
        description: feedDescription.trim() || '',
        timestamp: Date.now(),
        status: 'pending',
      };
      await addDoc(collection(db, 'feed_requests'), request);
      Alert.alert('Submitted!', 'Your feed request has been submitted for review.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
      setFeedUrl('');
      setFeedDescription('');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to submit request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScreenHeader title="Request a Feed" onBack={() => navigation.goBack()} />

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            Submit a Substack publication you'd like us to add to the feed directory.
          </Text>

          <Text style={[styles.fieldLabel, { color: colors.text }]}>Publication URL</Text>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
            ]}
            placeholder="https://example.substack.com/feed"
            placeholderTextColor={colors.textMuted}
            value={feedUrl}
            onChangeText={setFeedUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            autoFocus
          />

          <Text style={[styles.fieldLabel, { color: colors.text }]}>Why do you recommend this?</Text>
          <TextInput
            style={[
              styles.input,
              styles.textArea,
              { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
            ]}
            placeholder="Optional — tell us why this publication would be a great addition."
            placeholderTextColor={colors.textMuted}
            value={feedDescription}
            onChangeText={setFeedDescription}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />

          <TouchableOpacity
            style={[styles.submitButton, { backgroundColor: colors.primary, opacity: submitting ? 0.6 : 1 }]}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.8}
          >
            {submitting ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <>
                <Rss size={18} color={colors.background} style={{ marginRight: 8 }} />
                <Text style={[styles.submitButtonText, { color: colors.background }]}>Submit Request</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={{ height: 48 }} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 28, paddingTop: 28 },
  subtitle: { fontSize: TEXT_SM, lineHeight: 20, marginBottom: 24 },
  fieldLabel: { fontSize: TEXT_SM, fontWeight: '600', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    fontSize: TEXT_BASE,
    marginBottom: 20,
  },
  textArea: { minHeight: 100 },
  submitButton: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonText: { fontSize: TEXT_BASE, fontWeight: '700' },
});
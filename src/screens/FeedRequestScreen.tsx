// ============================================================
// SubTick — Feed Request Screen (modal)
// ============================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Alert,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { auth, db } from '../services/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { FeedRequest } from '../types';
import { validateFeedRequest } from '../utils/validation';
import { TEXT_SM, TEXT_BASE } from '../utils/constants';
import { FormScreen } from '../components/FormScreen';
import { Rss } from 'lucide-react-native';

export default function FeedRequestScreen() {
  const { colors } = useTheme();

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
      Alert.alert('Submitted!', 'Your feed request has been submitted for review.');
      setFeedUrl('');
      setFeedDescription('');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to submit request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormScreen
      title="Request a Feed"
      subtitle="Submit a Substack publication you'd like us to add to the feed directory."
      submitLabel="Submit Request"
      IconComponent={Rss}
      onSubmit={handleSubmit}
      submitting={submitting}
    >
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
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  fieldLabel: { fontSize: TEXT_SM, fontWeight: '600', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    fontSize: TEXT_BASE,
    marginBottom: 20,
  },
  textArea: { minHeight: 100 },
});
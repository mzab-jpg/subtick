// ============================================================
// SubTick — Feedback Screen (modal)
// ============================================================

import React, { useState } from 'react';
import {
  TextInput,
  Alert,
  StyleSheet,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { auth, db } from '../services/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { TEXT_BASE } from '../utils/constants';
import { FormScreen } from '../components/FormScreen';
import { Send } from 'lucide-react-native';

export default function FeedbackScreen() {
  const { colors } = useTheme();

  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmed = message.trim();
    if (!trimmed) {
      Alert.alert('Empty', 'Please write something before submitting.');
      return;
    }
    if (!auth.currentUser) return;

    setSubmitting(true);
    try {
      await addDoc(collection(db, 'feedback'), {
        userId: auth.currentUser.uid,
        message: trimmed,
        timestamp: Date.now(),
      });
      Alert.alert('Thank you!', 'Your feedback has been received.');
      setMessage('');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to submit feedback.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormScreen
      title="Send Feedback"
      subtitle="Bugs, ideas, or anything on your mind — we read everything."
      submitLabel="Send Feedback"
      IconComponent={Send}
      onSubmit={handleSubmit}
      submitting={submitting}
    >
      <TextInput
        style={[
          styles.textArea,
          { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
        ]}
        placeholder="What's on your mind?"
        placeholderTextColor={colors.textMuted}
        value={message}
        onChangeText={setMessage}
        multiline
        numberOfLines={6}
        textAlignVertical="top"
        autoFocus
      />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  textArea: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    fontSize: TEXT_BASE,
    minHeight: 140,
    marginBottom: 20,
  },
});
// ============================================================
// SubTick — Feedback Screen (modal)
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
import { useNavigation } from '@react-navigation/native';
import { auth, db } from '../services/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { TEXT_SM, TEXT_BASE, TEXT_LG } from '../utils/constants';
import { ChevronLeft, Send } from 'lucide-react-native';

export default function FeedbackScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();

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
        status: 'pending',
      });
      Alert.alert('Thank you!', 'Your feedback has been received.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
      setMessage('');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to submit feedback.');
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
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <ChevronLeft size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Send Feedback</Text>
          <View style={styles.backButton} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            Bugs, ideas, or anything on your mind — we read everything.
          </Text>

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
                <Send size={18} color={colors.background} style={{ marginRight: 8 }} />
                <Text style={[styles.submitButtonText, { color: colors.background }]}>Send Feedback</Text>
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
  subtitle: { fontSize: TEXT_SM, lineHeight: 20, marginBottom: 20 },
  textArea: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    fontSize: TEXT_BASE,
    minHeight: 140,
    marginBottom: 20,
  },
  submitButton: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonText: { fontSize: TEXT_BASE, fontWeight: '700' },
});

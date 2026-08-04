// ============================================================
// SubTick — Shared Form Screen Component
// Wraps the common submit-form pattern used by FeedbackScreen
// and FeedRequestScreen: KeyboardAvoidingView, header, subtitle,
// children (form fields), pill-shaped submit button with spinner.
// ============================================================

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types';
import { TEXT_SM, TEXT_BASE } from '../utils/constants';
import { ScreenHeader } from './ScreenHeader';
import type { LucideIcon } from 'lucide-react-native';

interface FormScreenProps {
  title: string;
  subtitle: string;
  submitLabel: string;
  IconComponent: LucideIcon;
  onSubmit: () => Promise<void>;
  submitting: boolean;
  children: React.ReactNode;
}

export function FormScreen({
  title,
  subtitle,
  submitLabel,
  IconComponent,
  onSubmit,
  submitting,
  children,
}: FormScreenProps) {
  const { colors } = useTheme();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScreenHeader title={title} onBack={() => navigation.goBack()} />

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            {subtitle}
          </Text>

          {children}

          <TouchableOpacity
            style={[styles.submitButton, { backgroundColor: colors.primary, opacity: submitting ? 0.6 : 1 }]}
            onPress={onSubmit}
            disabled={submitting}
            activeOpacity={0.8}
          >
            {submitting ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <>
                <IconComponent size={18} color={colors.background} style={{ marginRight: 8 }} />
                <Text style={[styles.submitButtonText, { color: colors.background }]}>{submitLabel}</Text>
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
  submitButton: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonText: { fontSize: TEXT_BASE, fontWeight: '700' },
});
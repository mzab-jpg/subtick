// ============================================================
// SubTick — Account Screen
// Shows Google account linkage status and provides
// Link/Unlink, Sign Out, Reset Data, Delete Account.
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { topInset } from '../utils/safeArea';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types';
import { auth } from '../services/firebase';
import { ScreenHeader } from '../components/ScreenHeader';
import {
  linkGoogleAccount,
  unlinkGoogleAccount,
  signOutUser,
  resetAccount,
  deleteAccount,
} from '../services/auth';
import { useUser } from '../contexts/UserContext';
import { beginAccountTransition, endAccountTransition } from '../services/accountTransition';
import { clearCachedDashboardFeed } from '../services/dashboardFeedCache';
import {
  TEXT_XS,
  TEXT_SM,
  TEXT_BASE,
  TEXT_LG,
  TEXT_XL,
} from '../utils/constants';
import {
  Link,
  Unlink,
  LogOut,
  RotateCcw,
  Trash2,
  Mail,
  UserCircle,
} from 'lucide-react-native';

export default function AccountScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const { profile, loading, refreshProfile } = useUser();

  // ── Google Link / Unlink ──────────────────────────────────
  const handleGoogleLink = async () => {
    try {
      await linkGoogleAccount();
      Alert.alert('Linked', 'Google account linked successfully!');
      await refreshProfile();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Could not link Google account.');
    }
  };

  const handleGoogleUnlink = () => {
    Alert.alert(
      'Unlink Google Account',
      'This will remove the Google link from your account. You will still be signed in anonymously.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlink',
          style: 'destructive',
          onPress: async () => {
            try {
              await unlinkGoogleAccount();
              Alert.alert('Unlinked', 'Google account has been removed.');
              await refreshProfile();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Could not unlink.');
            }
          },
        },
      ]
    );
  };

  // ── Sign Out ──────────────────────────────────────────────
  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'You will be signed in anonymously.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            beginAccountTransition();
            clearCachedDashboardFeed(auth.currentUser?.uid);
            try {
              await signOutUser();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to sign out.');
            } finally {
              endAccountTransition();
            }
          },
        },
      ]
    );
  };

  // ── Reset Account Data ────────────────────────────────────
  const handleResetData = () => {
    Alert.alert(
      'Reset Account Data',
      'This resets your account to a fresh state:\n\n' +
        '• All behavior events and reading history\n' +
        '• All saved articles\n' +
        '• All seen articles\n' +
        '• Category preferences and learned personalization\n' +
        '• Reading stats (streak, WPM, etc.)\n\n' +
        'You will need to go through onboarding again.\n' +
        'Your account ID stays the same.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            beginAccountTransition();
            clearCachedDashboardFeed(auth.currentUser?.uid);
            try {
              await resetAccount();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to reset account.');
            } finally {
              endAccountTransition();
            }
          },
        },
      ]
    );
  };

  // ── Delete Account ────────────────────────────────────────
  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account and all associated data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            beginAccountTransition();
            clearCachedDashboardFeed(auth.currentUser?.uid);
            try {
              await deleteAccount();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to delete account.');
            } finally {
              endAccountTransition();
            }
          },
        },
      ]
    );
  };

  // ── Render ────────────────────────────────────────────────
  const isLinked = !!profile?.linkedGoogleAccount;
  const userEmail = profile?.userEmail || '';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Account" onBack={() => navigation.goBack()} />

      {loading ? (
        <View style={styles.inlineLoading}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : (
      <ScrollView style={styles.scrollContent} contentContainerStyle={styles.scrollInner} showsVerticalScrollIndicator={false}>

        {/* ═══════ ACCOUNT STATUS ═══════ */}
        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>ACCOUNT STATUS</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.statusRow, { borderBottomColor: colors.border }]}>
            <View style={[styles.statusIconWrap, { backgroundColor: isLinked ? colors.primaryLight : colors.surfaceSecondary }]}>
              {isLinked ? <Mail size={24} color={colors.primary} /> : <UserCircle size={24} color={colors.textMuted} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.statusTitle, { color: colors.text }]}>
                {isLinked ? userEmail || 'Connected' : 'Anonymous Account'}
              </Text>
              <Text style={[styles.statusSubtitle, { color: colors.textMuted }]}>
                {isLinked ? 'Signed in with Google' : 'Not linked to Google'}
              </Text>
            </View>
          </View>

          {/* Link / Unlink button */}
          <TouchableOpacity
            style={[styles.row, styles.rowNoBorder]}
            onPress={isLinked ? handleGoogleUnlink : handleGoogleLink}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <View style={[styles.iconWrap, { backgroundColor: colors.surfaceSecondary }]}>
                {isLinked ? <Unlink size={16} color={colors.text} /> : <Link size={16} color={colors.text} />}
              </View>
              <Text style={[styles.rowLabel, { color: colors.text }]}>
                {isLinked ? 'Unlink Google Account' : 'Link Google Account'}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* ═══════ ACTIONS ═══════ */}
        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>ACTIONS</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TouchableOpacity
            style={styles.row}
            onPress={handleSignOut}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <View style={[styles.iconWrap, { backgroundColor: colors.surfaceSecondary }]}>
                <LogOut size={16} color={colors.text} />
              </View>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Sign Out</Text>
            </View>
          </TouchableOpacity>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <TouchableOpacity
            style={styles.row}
            onPress={handleResetData}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <View style={[styles.iconWrap, { backgroundColor: colors.surfaceSecondary }]}>
                <RotateCcw size={16} color={colors.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowLabel, { color: colors.text }]}>Reset Account Data</Text>
                <Text style={[styles.rowHint, { color: colors.textMuted }]}>
                  Clear all data and restart onboarding
                </Text>
              </View>
            </View>
          </TouchableOpacity>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <TouchableOpacity
            style={[styles.row, styles.rowNoBorder]}
            onPress={handleDeleteAccount}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <View style={[styles.iconWrap, { backgroundColor: colors.surfaceSecondary }]}>
                <Trash2 size={16} color={colors.error} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowLabel, { color: colors.error }]}>Delete Account</Text>
                <Text style={[styles.rowHint, { color: colors.textMuted }]}>
                  Permanently delete your account and all data
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>

        <View style={{ height: 48 }} />
      </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flex: 1 },
  scrollInner: { paddingHorizontal: 28 },
  inlineLoading: { flex: 1, alignItems: 'center', paddingTop: 40 },


  sectionLabel: {
    fontSize: TEXT_XS,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 10,
    marginLeft: 4,
  },

  // Status card
  card: {
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 28,
    overflow: 'hidden',
  },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
    gap: 14,
    borderBottomWidth: 1,
  },
  statusIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTitle: {
    fontSize: TEXT_BASE,
    fontWeight: '600',
    marginBottom: 2,
  },
  statusSubtitle: {
    fontSize: TEXT_SM,
  },

  // Action rows
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowNoBorder: {},
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  iconWrap: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { fontSize: TEXT_BASE, fontWeight: '500' },
  rowHint: { fontSize: TEXT_XS, marginTop: 2, lineHeight: 16 },

  divider: { height: 1, marginLeft: 36 },
});
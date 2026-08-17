// ============================================================
// SubTick — Dashboard Stats Screen
// Configure which metrics appear on the Dashboard stats pill.
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useUser } from '../contexts/UserContext';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types';
import { auth, db } from '../services/firebase';
import { doc, setDoc } from 'firebase/firestore';
import {
  DASHBOARD_METRIC_DEFS,
  TEXT_XS,
  TEXT_SM,
  TEXT_BASE,
  TEXT_LG,
} from '../utils/constants';
import { ScreenHeader } from '../components/ScreenHeader';
import { getMetricIcon, getTopCategory, normalizeDashboardMetricIds } from '../utils/dashboardMetrics';


export default function DashboardStatsScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const { profile, weeklyReadCount, loading } = useUser();

  const [selectedMetricIds, setSelectedMetricIds] = useState<string[]>([]);

  useEffect(() => {
    if (profile) {
      setSelectedMetricIds(normalizeDashboardMetricIds(profile.dashboardMetricIds || []));
    }
  }, [profile]);

  const getMetricValue = (metricId: string): string | number => {
    if (!profile) return 0;
    switch (metricId) {
      case 'streak': return profile.currentStreakDays;
      case 'weeklyReads': return weeklyReadCount;
      case 'topCategory': {
        return getTopCategory(profile).charAt(0).toUpperCase() + getTopCategory(profile).slice(1);
      }
      case 'totalRead': return profile.totalArticlesRead;
      case 'totalReadTime': return profile.totalReadTimeMs
        ? Math.max(0.1, parseFloat((profile.totalReadTimeMs / 3_600_000).toFixed(1)))
        : 0;
      case 'avgWpm': return profile.averageWpm;
      default: return 0;
    }
  };

  const toggleMetric = async (metricId: string) => {
    const current = [...selectedMetricIds];
    const idx = current.indexOf(metricId);
    if (idx > -1) {
      current.splice(idx, 1);
    } else {
      // The dashboard has room for three values. Keep the rule in this UI,
      // where it belongs, rather than treating it as a backend restriction.
      if (current.length >= 3) return;
      current.push(metricId);
    }
    setSelectedMetricIds(current);

    try {
      if (auth.currentUser) {
        const userRef = doc(db, 'users', auth.currentUser.uid);
        await setDoc(
          userRef,
          { dashboardMetricIds: current, lastUpdated: Date.now() },
          { merge: true }
        );
      }
    } catch (error) {
      console.error('[DashboardStats] Failed to save metric selection:', error);
      setSelectedMetricIds(selectedMetricIds);
    }
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
      <ScreenHeader title="Dashboard Stats" onBack={() => navigation.goBack()} />

      <ScrollView style={styles.scrollContent} contentContainerStyle={styles.scrollInner}>
        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
          Choose up to 3 metrics to display on your dashboard.
        </Text>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {DASHBOARD_METRIC_DEFS.map((metric, index) => {
            const isSelected = selectedMetricIds.includes(metric.id);
            const isLast = index === DASHBOARD_METRIC_DEFS.length - 1;
            const selectionFull = selectedMetricIds.length >= 3;
            const stateLabel = isSelected ? 'Shown on Dashboard' : selectionFull ? '3 selected' : 'Not shown';
            const rowBackground = isSelected ? colors.chipSelectedBg : colors.background;
            const textColor = isSelected ? colors.chipSelectedText : colors.text;
            const mutedColor = isSelected ? colors.chipSelectedText : colors.textMuted;
            return (
              <TouchableOpacity
                key={metric.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected, disabled: !isSelected && selectionFull }}
                disabled={!isSelected && selectionFull}
                style={[
                  styles.row,
                  { backgroundColor: rowBackground },
                  !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border },
                  !isSelected && selectionFull && styles.rowDisabled,
                ]}
                onPress={() => toggleMetric(metric.id)}
                activeOpacity={0.7}
              >
                <View style={styles.rowLeft}>
                  <View style={styles.iconWrap}>
                    {getMetricIcon(metric.id, mutedColor, 20)}
                  </View>
                  <View style={styles.metricInfo}>
                    <Text style={[styles.metricLabel, { color: textColor }]}>
                      {metric.label}
                    </Text>
                    <Text style={[styles.metricValue, { color: mutedColor }]}>
                      {stateLabel} · {getMetricValue(metric.id)}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scrollContent: { flex: 1 },
  scrollInner: { paddingHorizontal: 28, paddingTop: 24, paddingBottom: 48 },
  sectionLabel: { fontSize: TEXT_SM, marginBottom: 14, lineHeight: 20 },

  // Single joined card (matching Settings layout)
  card: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },

  // Matches the category preference rows: state is communicated by the
  // whole row plus explicit supporting text, not a separate checkbox.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  rowDisabled: { opacity: 0.45 },
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
  metricInfo: { flex: 1 },
  metricLabel: { fontSize: TEXT_BASE, fontWeight: '500', marginBottom: 2 },
  metricValue: { fontSize: TEXT_SM, marginTop: 3 },
});
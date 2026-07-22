// ============================================================
// SubTick — Dashboard Stats Screen
// Select up to 3 stats to display on the dashboard.
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useNavigation } from '@react-navigation/native';
import { UserProfile } from '../types';
import { auth, db } from '../services/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { fetchUserProfile } from '../services/auth';
import {
  DASHBOARD_METRIC_DEFS,
  TEXT_XS,
  TEXT_SM,
  TEXT_BASE,
  TEXT_LG,
} from '../utils/constants';
import { ChevronLeft, Flame, CalendarDays, Clock, Gauge, BookCheck, BookHeart, BarChart3 } from 'lucide-react-native';

const getMetricIcon = (id: string, color: string) => {
  switch (id) {
    case 'streak': return <Flame size={18} color={color} />;
    case 'weeklyReads': return <CalendarDays size={18} color={color} />;
    case 'totalReadTime': return <Clock size={18} color={color} />;
    case 'avgWpm': return <Gauge size={18} color={color} />;
    case 'totalRead': return <BookCheck size={18} color={color} />;
    case 'topCategory': return <BookHeart size={18} color={color} />;
    default: return <BarChart3 size={18} color={color} />;
  }
};

export default function DashboardStatsScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMetricIds, setSelectedMetricIds] = useState<string[]>([]);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      const p = await fetchUserProfile(user.uid);
      setProfile(p);
      if (p) {
        setSelectedMetricIds(p.dashboardMetricIds || []);
      }
    } catch (error) {
      console.error('[DashboardStats] loadProfile error:', error);
    } finally {
      setLoading(false);
    }
  };

  const getMetricValue = (metricId: string): string | number => {
    if (!profile) return 0;
    switch (metricId) {
      case 'streak': return profile.currentStreakDays;
      case 'weeklyReads': return profile.weeklyReadCount;
      case 'topCategory': {
        let topCat = '—';
        let topWeight = 0;
        Object.entries(profile.categoryWeights).forEach(([cat, w]) => {
          if (!cat.includes('::') && !cat.startsWith('pub::') && w > topWeight) {
            topWeight = w;
            topCat = cat;
          }
        });
        return topCat.charAt(0).toUpperCase() + topCat.slice(1);
      }
      case 'totalRead': return profile.totalArticlesRead;
      case 'avgWpm': return profile.averageWpm;
      case 'weeklyStreak': return `${profile.weeklyReadCount} this week`;
      case 'exploreScore': return 'Active';
      default: return 0;
    }
  };

  const handleToggle = async (metricId: string) => {
    if (!auth.currentUser) return;
    const isSelected = selectedMetricIds.includes(metricId);

    let updated: string[];
    if (isSelected) {
      updated = selectedMetricIds.filter((id) => id !== metricId);
    } else {
      if (selectedMetricIds.length >= 3) {
        Alert.alert('Limit Reached', 'You can display up to 3 stats. Disable one before adding another.');
        return;
      }
      updated = [...selectedMetricIds, metricId];
    }

    // Optimistic update
    setSelectedMetricIds(updated);

    try {
      const userRef = doc(db, 'users', auth.currentUser.uid);
      await setDoc(userRef, { dashboardMetricIds: updated, lastUpdated: Date.now() }, { merge: true });
    } catch (error) {
      console.error('[DashboardStats] toggle save error:', error);
      // Revert
      setSelectedMetricIds(selectedMetricIds);
      Alert.alert('Save Failed', 'Could not save your selection. Please try again.');
    }
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const selectedCount = selectedMetricIds.length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ChevronLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Dashboard Stats</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          Select up to 3 stats to display on your dashboard.
        </Text>

        {/* Counter pill */}
        <View style={[styles.counterPill, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[styles.counterText, { color: selectedCount >= 3 ? colors.primary : colors.textMuted }]}>
            {selectedCount} / 3 selected
          </Text>
        </View>

        {/* Metrics list */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {DASHBOARD_METRIC_DEFS.map((metric, index) => {
            const isSelected = selectedMetricIds.includes(metric.id);
            const isDisabled = !isSelected && selectedCount >= 3;
            const value = getMetricValue(metric.id);

            return (
              <View
                key={metric.id}
                style={[
                  styles.metricRow,
                  {
                    borderBottomColor: colors.border,
                    borderBottomWidth: index < DASHBOARD_METRIC_DEFS.length - 1 ? 1 : 0,
                    opacity: isDisabled ? 0.4 : 1,
                  },
                ]}
              >
                <View style={styles.metricLeft}>
                  <View style={[styles.iconWrap, { backgroundColor: colors.surfaceSecondary }]}>
                    {getMetricIcon(metric.id, isSelected ? colors.primary : colors.textMuted)}
                  </View>
                  <View style={styles.metricInfo}>
                    <Text style={[styles.metricLabel, { color: colors.text }]}>{metric.label}</Text>
                    <Text style={[styles.metricValue, { color: colors.textMuted }]}>
                      Current: {String(value)}
                    </Text>
                  </View>
                </View>
                <Switch
                  value={isSelected}
                  onValueChange={() => handleToggle(metric.id)}
                  disabled={isDisabled}
                  trackColor={{ false: colors.surfaceSecondary, true: colors.primaryLight }}
                  thumbColor={isSelected ? colors.primary : colors.textMuted}
                />
              </View>
            );
          })}
        </View>

        <Text style={[styles.hint, { color: colors.textMuted }]}>
          Changes save automatically. Stats will refresh next time you open the dashboard.
        </Text>

        <View style={{ height: 48 }} />
      </ScrollView>
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
    paddingBottom: 20,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
  },
  backButton: { width: 40, alignItems: 'flex-start' },
  headerTitle: { fontSize: TEXT_LG, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  scrollContent: { paddingHorizontal: 28, paddingTop: 28 },
  subtitle: { fontSize: TEXT_SM, lineHeight: 20, marginBottom: 16 },
  counterPill: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    marginBottom: 24,
  },
  counterText: { fontSize: TEXT_XS, fontWeight: '700' },
  card: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  metricLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  iconWrap: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  metricInfo: { flex: 1 },
  metricLabel: { fontSize: TEXT_BASE, fontWeight: '600' },
  metricValue: { fontSize: TEXT_XS, marginTop: 2 },
  hint: { fontSize: TEXT_XS, textAlign: 'center', marginTop: 20, lineHeight: 18 },
});

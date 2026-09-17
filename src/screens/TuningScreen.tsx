// ============================================================
// Tangent — Tuning Screen (B3 — Tuning & Control Room)
// Two halves of one room: TASTE TUNING (adjust the algorithm) and
// STATS & INSIGHTS (observe it). Changes auto-save after a short
// settle (no save button — owner amendment #2).
// ============================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import Slider from '@react-native-community/slider';
import { User, Settings } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useTheme } from '../contexts/ThemeContext';
import { useUser } from '../contexts/UserContext';
import { auth, db } from '../services/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { UserProfile, RootStackParamList } from '../types';
import { CATEGORIES, monoLabel } from '../utils/constants';
import { getSeenArticleMetas, getSavedArticleIds } from '../services/feedService';
import { ArticleMeta } from '../services/feed/articleMeta';

// ── Discovery injection presets (wired server-side in the stacks phase) ──
const INJECTION_SLOTS = [
  { key: 'CONSERVATIVE', detail: 'EVERY 10TH (10%)', rate: 0.1 },
  { key: 'BALANCED DEFAULT', detail: 'EVERY 5TH (20%)', rate: 0.2 },
  { key: 'SERENDIPITY', detail: 'EVERY 3RD (33%)', rate: 0.33 },
] as const;

// Latent weight per chip state (double-sided sigmoid scale, 0 = neutral).
const BOOST_STEP = 0.7;
const clampLatent = (x: number) => Math.max(-3, Math.min(3, x));
const stateFromLatent = (x: number): 'BOOST' | 'NORMAL' | 'MUTE' =>
  x > 0.3 ? 'BOOST' : x < -0.3 ? 'MUTE' : 'NORMAL';

function hours(ms?: number): string {
  if (!ms) return '0H';
  return `${Math.floor(ms / 3_600_000)}H ${Math.round((ms % 3_600_000) / 60_000)}M`;
}

interface DietSlice { label: string; minutes: number; count: number; }

function computeDiet(metas: ArticleMeta[]): DietSlice[] {
  const map = new Map<string, DietSlice>();
  for (const meta of metas) {
    const entry = map.get(meta.category) || { label: meta.category, minutes: 0, count: 0 };
    entry.minutes += meta.estimatedReadMinutes || 0;
    entry.count += 1;
    map.set(meta.category, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.minutes - a.minutes);
}

function computeLoyalty(metas: ArticleMeta[]): DietSlice[] {
  const map = new Map<string, DietSlice>();
  for (const meta of metas) {
    const key = meta.publicationName || 'Unknown';
    const entry = map.get(key) || { label: key, minutes: 0, count: 0 };
    entry.minutes += meta.estimatedReadMinutes || 0;
    entry.count += 1;
    map.set(key, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.minutes - a.minutes);
}

function formatMinutes(min: number): string {
  if (min >= 60) return `${Math.floor(min / 60)}H ${Math.round(min % 60)}M`;
  return `${min}M`;
}

type Mode = 'stats' | 'taste';

export default function TuningScreen() {
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const { profile, weeklyReadCount } = useUser();

  const [mode, setMode] = useState<Mode>('stats');
  const [metas, setMetas] = useState<ArticleMeta[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveStateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const noteSaving = () => {
    setSaveState('saving');
    if (saveStateTimer.current) clearTimeout(saveStateTimer.current);
  };
  const noteSaved = () => {
    setSaveState('saved');
    saveStateTimer.current = setTimeout(() => setSaveState('idle'), 1500);
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [seen, saved] = await Promise.all([
          getSeenArticleMetas(200),
          getSavedArticleIds(),
        ]);
        if (!active) return;
        setMetas(seen);
        setSavedCount(saved.length);
      } catch {
        // Stats are decorative on failure; the room still renders.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // ── Derived stats ──
  const diet = useMemo(() => computeDiet(metas), [metas]);
  const loyalty = useMemo(() => computeLoyalty(metas).slice(0, 3), [metas]);
  const dietTotalMinutes = diet.reduce((sum, slice) => sum + slice.minutes, 0) || 1;
  const radarTop = diet.slice(0, 5);

  // ── Taste weights — auto-save (amendment #2: no save button) ──
  const [weights, setWeights] = useState<Record<string, number>>(
    () => profile?.categoryWeights ?? {}
  );
  const weightsSyncedRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    // Adopt server weights only when the local pending edits have settled.
    if (profile && weightsSyncedRef.current === undefined) {
      setWeights(profile.categoryWeights ?? {});
      weightsSyncedRef.current = String(profile.lastUpdated ?? '');
    }
  }, [profile]);

  const weightsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistWeights = (next: Record<string, number>) => {
    noteSaving();
    if (weightsSaveTimer.current) clearTimeout(weightsSaveTimer.current);
    weightsSaveTimer.current = setTimeout(async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      try {
        await setDoc(
          doc(db, 'users', uid),
          { categoryWeights: next, lastUpdated: Date.now() },
          { merge: true }
        );
        noteSaved();
      } catch {
        // Offline — the next change retries; weights are also mirrored by the queue.
      }
    }, 800);
  };

  const cycleCategory = (categoryId: string) => {
    const current = stateFromLatent(weights[categoryId] ?? 0);
    const nextLatent =
      current === 'BOOST' ? -BOOST_STEP : current === 'MUTE' ? 0 : BOOST_STEP;
    const next = { ...weights, [categoryId]: clampLatent(nextLatent) };
    setWeights(next);
    weightsSyncedRef.current = 'local';
    persistWeights(next);
  };

  // Publisher-level taste (mock: BOOST/BLOCK rows) — latent publisherWeights.
  const [publisherWeights, setPublisherWeights] = useState<Record<string, number>>(
    () => profile?.publisherWeights ?? {}
  );
  const pubSyncedRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (profile && pubSyncedRef.current === undefined) {
      setPublisherWeights(profile.publisherWeights ?? {});
      pubSyncedRef.current = String(profile.lastUpdated ?? '');
    }
  }, [profile]);

  const persistPublisherWeights = (next: Record<string, number>) => {
    noteSaving();
    if (weightsSaveTimer.current) clearTimeout(weightsSaveTimer.current);
    weightsSaveTimer.current = setTimeout(async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      try {
        await setDoc(doc(db, 'users', uid), { publisherWeights: next, lastUpdated: Date.now() }, { merge: true });
        noteSaved();
      } catch {
        // Offline — retried on the next change.
      }
    }, 800);
  };

  const cyclePublisher = (name: string) => {
    const current = stateFromLatent(publisherWeights[name] ?? 0);
    const nextLatent =
      current === 'BOOST' ? -BOOST_STEP : current === 'MUTE' ? 0 : BOOST_STEP;
    const next = { ...publisherWeights, [name]: clampLatent(nextLatent) };
    setPublisherWeights(next);
    pubSyncedRef.current = 'local';
    persistPublisherWeights(next);
  };

  // Length slider (mock: BRIEF ↔ LONG OPUS) — persisted target minutes.
  const [lengthMin, setLengthMin] = useState<number>(profile?.lengthTargetMinutes ?? 25);
  const lengthSyncedRef = useRef(false);
  useEffect(() => {
    if (profile && !lengthSyncedRef.current) {
      setLengthMin(profile.lengthTargetMinutes ?? 25);
      lengthSyncedRef.current = true;
    }
  }, [profile]);
  const lengthSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLengthChange = (minutes: number) => {
    setLengthMin(minutes);
    noteSaving();
    if (lengthSaveTimer.current) clearTimeout(lengthSaveTimer.current);
    lengthSaveTimer.current = setTimeout(async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      try {
        await setDoc(doc(db, 'users', uid), { lengthTargetMinutes: minutes, lastUpdated: Date.now() }, { merge: true });
        noteSaved();
      } catch {
        // Offline — retried on the next change.
      }
    }, 700);
  };
  const lengthReadout =
    lengthMin <= 12 ? 'BRIEF' : lengthMin <= 25 ? 'STANDARD' : lengthMin <= 40 ? 'DEEP DIVE' : 'LONG OPUS';

  const publishers5 = useMemo(() => computeLoyalty(metas).slice(0, 5), [metas]);

  const persistInjection = async (rate: number) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      await setDoc(
        doc(db, 'users', uid),
        { discoveryInjectionRate: rate, lastUpdated: Date.now() },
        { merge: true }
      );
      noteSaved();
    } catch {
      // Offline — preference retried on next change.
    }
  };

  // ── Intent vs. Reality Gap ──
  const boostedTop = useMemo(() => {
    let best: { label: string; x: number } | null = null;
    for (const cat of CATEGORIES) {
      const x = weights[cat.id] ?? 0;
      if (x > 0.3 && (!best || x > best.x)) best = { label: cat.name, x };
    }
    return best;
  }, [weights]);
  const timeTop = diet[0] || null;
  const gapExists = !!boostedTop && !!timeTop && boostedTop.label !== timeTop.label;
  const timeTopShare = timeTop
    ? Math.round((timeTop.minutes / dietTotalMinutes) * 100)
    : 0;

  const velocityCards = [
    { label: 'DEEP FOCUS TIME', value: hours(profile?.totalReadTimeMs), note: 'ALL-TIME ACTIVE READING' },
    { label: 'ESSAYS COMPLETED', value: `${profile?.totalArticlesRead ?? 0}`, note: `${profile?.currentStreakDays ?? 0} DAY STREAK` },
    { label: 'AVERAGE PACE', value: `${profile?.averageWpm ?? 0} WPM`, note: 'FOCUSED CADENCE' },
    { label: 'THIS WEEK', value: `${weeklyReadCount}`, note: 'ESSAYS READ LAST 7 DAYS' },
  ];

  const radarPoints = useMemo(() => {
    const n = radarTop.length;
    if (n < 3) return null;
    const size = 200;
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 26;
    const total = radarTop.reduce((s, slice) => s + slice.minutes, 0) || 1;
    return radarTop.map((slice, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const share = Math.max(0.18, slice.minutes / total); // floor so shape stays readable
      const rr = r * share;
      return { x: cx + rr * Math.cos(angle), y: cy + rr * Math.sin(angle), label: slice.label };
    });
  }, [radarTop]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
      {/* ── Header: wordmark + account + gear (shared pattern) ── */}
      <View style={styles.headerRow}>
        <Text style={[styles.headerTitle, { color: colors.text, fontFamily: fonts.title }]}>
          TANGENT
        </Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => navigation.navigate('Account')}
            style={styles.iconButton}
            accessibilityLabel="Account"
          >
            <User size={20} color={colors.textSecondary} strokeWidth={1.8} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation.navigate('Settings')}
            style={styles.iconButton}
            accessibilityLabel="Settings"
          >
            <Settings size={20} color={colors.textSecondary} strokeWidth={1.8} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.pageTitle, { color: colors.text, fontFamily: fonts.headline }]}>
          Tuning
        </Text>
        {saveState !== 'idle' ? (
          <Text style={[monoLabel(fonts), { color: colors.accent }]}>
            {saveState === 'saving' ? "● SAVING" : "● SAVED"}
          </Text>
        ) : null}

        {/* ── Segmented control (4px radius per system) ── */}
        <View style={[styles.segmented, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          {(['taste', 'stats'] as Mode[]).map((m) => {
            const active = mode === m;
            return (
              <TouchableOpacity
                key={m}
                style={[
                  styles.segmentButton,
                  active && { backgroundColor: colors.background, borderColor: colors.borderStrong },
                ]}
                onPress={() => setMode(m)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    monoLabel(fonts),
                    { color: active ? colors.text : colors.textSecondary },
                  ]}
                >
                  {m === 'taste' ? 'TASTE TUNING' : 'STATS & INSIGHTS'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>


        {/* ── STATS & INSIGHTS ── */}
        {mode === 'stats' ? (
          <>
            <View style={styles.metricRow}>
              <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[monoLabel(fonts), { color: colors.textMuted }]}>ESSAYS READ</Text>
                <Text style={[styles.metricValue, { color: colors.text, fontFamily: fonts.display }]}>
                  {profile?.totalArticlesRead ?? 0}
                </Text>
              </View>
              <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[monoLabel(fonts), { color: colors.textMuted }]}>TIME READING</Text>
                <Text style={[styles.metricValue, { color: colors.text, fontFamily: fonts.display }]}>
                  {hours(profile?.totalReadTimeMs)}
                </Text>
              </View>
              <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[monoLabel(fonts), { color: colors.textMuted }]}>DAY STREAK</Text>
                <Text style={[styles.metricValue, { color: colors.accent, fontFamily: fonts.display }]}>
                  {profile?.currentStreakDays ?? 0}
                </Text>
              </View>
            </View>

            {/* Taste Radar */}
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.cardHeader}>
                <Text style={[monoLabel(fonts), { color: colors.textMuted }]}>TASTE RADAR</Text>
                <Text style={[monoLabel(fonts), { color: colors.textFaint }]}>
                  {`${radarTop.length} CATEGORIES`}
                </Text>
              </View>
              {radarPoints ? (
                <Svg width={200} height={200} style={styles.radar}>
                  <Polygon
                    points={radarPoints.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill={colors.accentSoft}
                    stroke={colors.accent}
                    strokeWidth={1.5}
                  />
                </Svg>
              ) : (
                <Text style={[styles.emptyNote, { color: colors.textMuted, fontFamily: fonts.body }]}>
                  Read a few essays and your taste shape appears here.
                </Text>
              )}
              {radarPoints ? (
                <View style={styles.radarLabels}>
                  {radarTop.map((slice) => (
                    <Text key={slice.label} style={[monoLabel(fonts), { color: colors.textFaint }]}>
                      {slice.label.toUpperCase()}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>

            {/* Completion Funnel */}
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.cardHeader}>
                <Text style={[monoLabel(fonts), { color: colors.textMuted }]}>COMPLETION FUNNEL</Text>
              </View>
              {(() => {
                const stages = [
                  { label: 'SAVED', value: savedCount },
                  { label: 'READ', value: profile?.totalArticlesRead ?? 0 },
                  { label: 'THIS WEEK', value: weeklyReadCount },
                ];
                const max = Math.max(1, ...stages.map((s) => s.value));
                return stages.map((stage) => (
                  <View key={stage.label} style={styles.funnelRow}>
                    <Text style={[monoLabel(fonts), { color: colors.textFaint, width: 76 }]}>
                      {stage.label}
                    </Text>
                    <View style={[styles.funnelTrack, { backgroundColor: colors.surfaceRaised }]}>
                      <View
                        style={[
                          styles.funnelBar,
                          {
                            width: `${Math.max(4, (stage.value / max) * 100)}%`,
                            backgroundColor: colors.accent,
                          },
                        ]}
                      />
                    </View>
                    <Text style={[monoLabel(fonts), { color: colors.text, width: 34, textAlign: 'right' }]}>
                      {stage.value}
                    </Text>
                  </View>
                ));
              })()}
            </View>


            {/* Reading velocity 2×2 */}
            <View style={styles.velocityGrid}>
              {velocityCards.map((card) => (
                <View
                  key={card.label}
                  style={[styles.velocityCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <Text style={[monoLabel(fonts), { color: colors.textMuted }]}>{card.label}</Text>
                  <Text style={[styles.metricValue, { color: colors.text, fontFamily: fonts.display }]}>
                    {card.value}
                  </Text>
                  <Text style={[monoLabel(fonts), { color: colors.textFaint }]}>{card.note}</Text>
                </View>
              ))}
            </View>

            {/* Thematic Diet */}
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.cardHeader}>
                <Text style={[monoLabel(fonts), { color: colors.textMuted }]}>THEMATIC DIET</Text>
                <Text style={[monoLabel(fonts), { color: colors.textFaint }]}>
                  {`${diet.length} CATEGORIES`}
                </Text>
              </View>
              {diet.length > 0 ? (
                <>
                  <View style={styles.dietBarRow}>
                    {diet.slice(0, 5).map((slice, i) => (
                      <View
                        key={slice.label}
                        style={{
                          flex: Math.max(0.5, slice.minutes / dietTotalMinutes),
                          height: 6,
                          backgroundColor: colors.accent,
                          opacity: 1 - i * 0.16,
                        }}
                      />
                    ))}
                  </View>
                  {diet.slice(0, 5).map((slice, i) => (
                    <View key={slice.label} style={styles.dietRow}>
                      <View style={[styles.dietDot, { backgroundColor: colors.accent, opacity: 1 - i * 0.16 }]} />
                      <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.text, flex: 1 }}>
                        {slice.label}
                      </Text>
                      <Text style={[monoLabel(fonts), { color: colors.textMuted }]}>
                        {formatMinutes(slice.minutes)}
                      </Text>
                      <Text style={[monoLabel(fonts), { color: colors.accent, width: 40, textAlign: 'right' }]}>
                        {`${Math.round((slice.minutes / dietTotalMinutes) * 100)}%`}
                      </Text>
                    </View>
                  ))}
                </>
              ) : (
                <Text style={[styles.emptyNote, { color: colors.textMuted, fontFamily: fonts.body }]}>
                  Your thematic diet builds as you read.
                </Text>
              )}
            </View>


            {/* Intent vs. Reality Gap */}
            {gapExists ? (
              <View
                style={[
                  styles.card,
                  styles.gapCard,
                  { backgroundColor: colors.surface, borderColor: colors.accent },
                ]}
              >
                <Text style={[monoLabel(fonts), { color: colors.accent }]}>
                  INTENT VS. REALITY GAP
                </Text>
                <Text style={[styles.gapBody, { color: colors.text, fontFamily: fonts.body }]}>
                  {`You boosted ${boostedTop!.label}, but ${timeTopShare}% of your reading time centered on ${timeTop!.label}. Consider pinning ${boostedTop!.label} longforms to your queue.`}
                </Text>
              </View>
            ) : null}

            {/* Source Loyalty */}
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.cardHeader}>
                <Text style={[monoLabel(fonts), { color: colors.textMuted }]}>SOURCE LOYALTY</Text>
                <Text style={[monoLabel(fonts), { color: colors.textFaint }]}>TOP 3</Text>
              </View>
              {loyalty.length > 0 ? (
                loyalty.map((source, index) => (
                  <View key={source.label} style={styles.loyaltyRow}>
                    <Text style={[monoLabel(fonts), { color: colors.accent }]}>{`${index + 1}`}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.text }}>
                        {source.label}
                      </Text>
                      <Text style={[monoLabel(fonts), { color: colors.textFaint, marginTop: 2 }]}>
                        {`${source.count} ESSAYS READ`}
                      </Text>
                    </View>
                    <Text style={[monoLabel(fonts), { color: colors.textMuted }]}>
                      {formatMinutes(source.minutes)}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={[styles.emptyNote, { color: colors.textMuted, fontFamily: fonts.body }]}>
                  Your regular tables appear here.
                </Text>
              )}
            </View>
          </>
        ) : null}

        {/* ── TASTE TUNING ── */}
        {mode === 'taste' ? (
          <>
            {/* Discovery Injection Rate */}
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.cardHeader}>
                <Text style={[monoLabel(fonts), { color: colors.textMuted }]}>
                  DISCOVERY INJECTION RATE
                </Text>
                <Text style={[monoLabel(fonts), { color: colors.textFaint }]}>
                  {`${Math.round((profile?.discoveryInjectionRate ?? 0.2) * 100)}%`}
                </Text>
              </View>
              <View style={styles.slotRow}>
                {INJECTION_SLOTS.map((slot) => {
                  const active = (profile?.discoveryInjectionRate ?? 0.2) === slot.rate;
                  return (
                    <TouchableOpacity
                      key={slot.key}
                      style={[
                        styles.slot,
                        {
                          borderColor: active ? colors.accent : colors.border,
                          backgroundColor: active ? colors.accentSoft : colors.surfaceRaised,
                        },
                      ]}
                      onPress={() => void persistInjection(slot.rate)}
                      activeOpacity={0.8}
                    >
                      <Text style={[monoLabel(fonts), { color: active ? colors.accent : colors.textSecondary }]}>
                        {slot.key}
                      </Text>
                      <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 11, color: active ? colors.accent : colors.text, marginTop: 2 }}>
                        {slot.detail}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Topic Mix Matrix */}
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.cardHeader}>
                <Text style={[monoLabel(fonts), { color: colors.textMuted }]}>TOPIC MIX</Text>
                <Text style={[monoLabel(fonts), { color: colors.textFaint }]}>TAP TO CYCLE</Text>
              </View>
              {CATEGORIES.map((category) => {
                const state = stateFromLatent(weights[category.id] ?? 0);
                const chipColor =
                  state === 'BOOST' ? colors.accent : state === 'MUTE' ? colors.error : colors.textSecondary;
                return (
                  <View key={category.id} style={styles.topicRow}>
                    <Text style={{ fontFamily: fonts.body, fontSize: 14, color: colors.text, flex: 1 }}>
                      {category.name}
                    </Text>
                    <TouchableOpacity
                      style={[styles.topicChip, { borderColor: chipColor }]}
                      onPress={() => cycleCategory(category.id)}
                      activeOpacity={0.8}
                    >
                      <Text style={[monoLabel(fonts), { color: chipColor }]}>
                        {state === 'BOOST' ? 'BOOST' : state === 'NORMAL' ? 'NORMAL' : 'MUTE'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>

            {/* Length slider */}
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.cardHeader}>
                <Text style={[monoLabel(fonts), { color: colors.textMuted }]}>LENGTH</Text>
                <Text style={[monoLabel(fonts), { color: colors.accent }]}>{`${lengthMin} MIN · ${lengthReadout}`}</Text>
              </View>
              <Slider
                minimumValue={5}
                maximumValue={60}
                step={1}
                value={lengthMin}
                onValueChange={onLengthChange}
                minimumTrackTintColor={colors.accent}
                maximumTrackTintColor={colors.borderStrong}
                thumbTintColor={colors.accent}
              />
              <View style={styles.sliderLabels}>
                <Text style={[monoLabel(fonts), { color: colors.textFaint }]}>BRIEF</Text>
                <Text style={[monoLabel(fonts), { color: colors.textFaint }]}>LONG OPUS</Text>
              </View>
            </View>

            {/* Publisher mix */}
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.cardHeader}>
                <Text style={[monoLabel(fonts), { color: colors.textMuted }]}>PUBLISHER MIX</Text>
                <Text style={[monoLabel(fonts), { color: colors.textFaint }]}>TAP TO CYCLE</Text>
              </View>
              {publishers5.length > 0 ? publishers5.map((publisher) => {
                const state = stateFromLatent(publisherWeights[publisher.label] ?? 0);
                const chipColor =
                  state === 'BOOST' ? colors.accent : state === 'MUTE' ? colors.error : colors.textSecondary;
                return (
                  <View key={publisher.label} style={styles.topicRow}>
                    <Text style={{ fontFamily: fonts.body, fontSize: 14, color: colors.text, flex: 1 }} numberOfLines={1}>
                      {publisher.label}
                    </Text>
                    <TouchableOpacity
                      style={[styles.topicChip, { borderColor: chipColor }]}
                      onPress={() => cyclePublisher(publisher.label)}
                      activeOpacity={0.8}
                    >
                      <Text style={[monoLabel(fonts), { color: chipColor }]}>
                        {state === 'BOOST' ? 'BOOST' : state === 'NORMAL' ? 'NORMAL' : 'MUTE'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              }) : (
                <Text style={[styles.emptyNote, { color: colors.textMuted, fontFamily: fonts.body }]}>
                  Your most-read publishers appear here once you read.
                </Text>
              )}
            </View>

            <Text style={[monoLabel(fonts), styles.autoSaveNote, { color: colors.textFaint }]}>
              CHANGES SAVE AUTOMATICALLY
            </Text>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}



const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: 2.4,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: 24,
    paddingBottom: 32,
    gap: 16,
  },
  pageTitle: {
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.3,
    fontWeight: '500',
  },
  segmented: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 4,
    padding: 4,
    gap: 4,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  metricRow: {
    flexDirection: 'row',
    gap: 10,
  },
  metricCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 4,
    padding: 14,
    gap: 6,
  },
  metricValue: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '500',
  },
  card: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  radar: {
    alignSelf: 'center',
  },
  radarLabels: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
  },
  emptyNote: {
    fontSize: 13,
    lineHeight: 20,
  },
  funnelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  funnelTrack: {
    flex: 1,
    height: 10,
    borderRadius: 2,
    overflow: 'hidden',
  },
  funnelBar: {
    height: 10,
    borderRadius: 2,
  },
  velocityGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  velocityCard: {
    width: '47.5%',
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 4,
    padding: 14,
    gap: 6,
  },
  dietBarRow: {
    flexDirection: 'row',
    gap: 2,
  },
  dietRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dietDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  gapCard: {
    borderWidth: 1,
  },
  gapBody: {
    fontSize: 14,
    lineHeight: 22,
  },
  loyaltyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  slotRow: {
    flexDirection: 'row',
    gap: 8,
  },
  slot: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 4,
    padding: 10,
    gap: 4,
  },
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 9,
  },
  topicChip: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  autoSaveNote: {
    textAlign: 'center',
    letterSpacing: 1,
  },
});
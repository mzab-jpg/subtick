// ============================================================
// Tangent — Stacks Screen (B2 — Stacks Hub & Queue)
// Three views of the reading life: QUEUE (saved vault summary),
// HISTORY (recent reads with % DEPTH when known), VAULT (archive
// of finished stacks — arrives with the stacks backend, owner
// amendment #1). Teasers reuse the full History/SavedReads screens.
// ============================================================

import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { User, Settings, Plus, Archive, RotateCcw, Layers, Check } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { RootStackParamList } from '../types';
import { monoLabel } from '../utils/constants';
import {
  getSeenArticleMetas,
  getSavedArticleMetas,
} from '../services/feedService';
import { ArticleMeta } from '../services/feed/articleMeta';
import {
  getStacks,
  createStack,
  moveStackToVault,
  restoreStackFromVault,
  stackTotals,
  ReadingStack,
  StackEssay,
} from '../services/feed/stacksStore';

type Segment = 'QUEUE' | 'HISTORY' | 'VAULT';

function depthLabel(meta: ArticleMeta): string | null {
  if (typeof meta.depth !== 'number') return null;
  return `${Math.round(meta.depth * 100)}% DEPTH`;
}

function timeAgo(ms?: number): string | null {
  if (!ms) return null;
  const min = Math.floor((Date.now() - ms) / 60_000);
  if (min < 60) return `${Math.max(1, min)}M AGO`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}H AGO`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'YESTERDAY';
  if (day < 7) return `${day} DAYS AGO`;
  return null;
}

export default function StacksScreen() {
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();

  const [segment, setSegment] = useState<Segment>('HISTORY');
  const [saved, setSaved] = useState<ArticleMeta[]>([]);
  const [seen, setSeen] = useState<ArticleMeta[]>([]);
  const [stacks, setStacks] = useState<ReadingStack[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerName, setComposerName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTextRef = useRef('');

  const showToast = (text: string) => {
    toastTextRef.current = text;
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(1900),
      Animated.timing(toastOpacity, { toValue: 0, duration: 260, useNativeDriver: true }),
    ]).start();
  };

  const refresh = async () => {
    try {
      const [savedMetas, seenMetas, localStacks] = await Promise.all([
        getSavedArticleMetas(),
        getSeenArticleMetas(60),
        getStacks(),
      ]);
      setSaved(savedMetas);
      setSeen(seenMetas);
      setStacks(localStacks);
    } catch {
      // Lists render empty on failure; the room stays usable.
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const activeStacks = stacks.filter((s) => s.state === 'active');
  const vaultStacks = stacks.filter((s) => s.state === 'vault');

  const togglePicked = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const composerEssays: StackEssay[] = saved
    .filter((meta) => picked.has(meta.id))
    .map((meta) => ({
      id: meta.id,
      title: meta.title,
      publicationName: meta.publicationName,
      minutes: meta.estimatedReadMinutes || 0,
    }));
  const composerTotals = composerEssays.reduce(
    (acc, essay) => ({ essays: acc.essays + 1, minutes: acc.minutes + essay.minutes }),
    { essays: 0, minutes: 0 }
  );

  const openComposer = () => {
    setComposerName('');
    setPicked(new Set());
    setComposerOpen(true);
  };

  const handleCreateStack = async () => {
    if (creating || composerTotals.essays === 0) return;
    setCreating(true);
    try {
      await createStack(composerName || 'Untitled Stack', composerEssays);
      setComposerOpen(false);
      await refresh();
      showToast(`STACK COMPILED · ${composerTotals.essays} ESSAYS · ${composerTotals.minutes} MIN`);
    } finally {
      setCreating(false);
    }
  };

  const handleArchive = async (stack: ReadingStack) => {
    const next = await moveStackToVault(stack.id);
    setStacks(next);
    showToast(`ARCHIVED TO VAULT · ${stack.name.toUpperCase()}`);
  };

  const handleRestore = async (stack: ReadingStack) => {
    const next = await restoreStackFromVault(stack.id);
    setStacks(next);
    showToast(`RESTORED · ${stack.name.toUpperCase()}`);
  };

  const handleBeginReading = (stack: ReadingStack) => {
    if (stack.essays.length === 0) return;
    navigation.navigate('Reader', {
      articleId: stack.essays[0].id,
      queueArticleIds: stack.essays.map((essay) => essay.id),
      startIndex: 0,
      mode: 'saved',
    });
  };

  const stackCard = (stack: ReadingStack, vaulted: boolean) => {
    const totals = stackTotals(stack);
    const nextEssay = stack.essays[0];
    const showRibbon = stack.essays.length > 0 && stack.essays.length <= 6;
    return (
      <View
        key={stack.id}
        style={[styles.card, styles.stackCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <View style={styles.stackHeader}>
          <View style={styles.labelRow}>
            <Layers size={16} color={colors.accent} strokeWidth={1.8} />
            <TouchableOpacity onPress={() => navigation.navigate('StackDetail', { stackId: stack.id })} activeOpacity={0.7}>
              <Text style={[styles.stackName, { color: colors.text, fontFamily: fonts.title }]}>
                {stack.name}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={[monoLabel(fonts), { color: colors.accent }]}>
            {vaulted ? `ARCHIVED · ${totals.essays} ESSAYS` : `${totals.essays} ESSAYS`}
          </Text>
        </View>
        {showRibbon ? (
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', gap: 1 }}>
              {stack.essays.map((essay, i) => (
                <View key={essay.id} style={{ flex: Math.max(1, essay.minutes), backgroundColor: i % 2 === 0 ? colors.accent : colors.borderStrong }} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 1 }}>
              {stack.essays.map((essay) => (
                <Text key={essay.id} style={[monoLabel(fonts), { fontSize: 8, flex: Math.max(1, essay.minutes), color: colors.textFaint }]}>
                  {`${essay.minutes}M`}
                </Text>
              ))}
            </View>
          </View>
        ) : null}
        {!vaulted && nextEssay ? (
          <View
            style={[
              styles.upNext,
              { backgroundColor: colors.background, borderColor: colors.border },
            ]}
          >
            <Text style={[monoLabel(fonts), { color: colors.accent }]}>UP NEXT TO READ:</Text>
            <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.text }} numberOfLines={1}>
              {nextEssay.title}
            </Text>
            <Text style={[monoLabel(fonts), { color: colors.textMuted, marginTop: 2 }]}>
              {`${nextEssay.publicationName.toUpperCase()} // ${nextEssay.minutes} MIN READ`}
            </Text>
          </View>
        ) : null}
        <View style={styles.stackActions}>
          {vaulted ? (
            <TouchableOpacity
              style={[styles.stackButton, { borderColor: colors.borderStrong }]}
              onPress={() => void handleRestore(stack)}
              activeOpacity={0.8}
            >
              <RotateCcw size={14} color={colors.textSecondary} strokeWidth={1.8} />
              <Text style={[monoLabel(fonts), { color: colors.text, letterSpacing: 1 }]}>RESTORE</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.stackPrimary, { backgroundColor: colors.primary }]}
                onPress={() => handleBeginReading(stack)}
                activeOpacity={0.85}
                disabled={totals.essays === 0}
              >
                <Text
                  style={[
                    monoLabel(fonts),
                    { color: colors.onPrimary, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1 },
                  ]}
                >
                  {nextEssay ? `RESUME QUEUE (${nextEssay.minutes} MIN)` : "EMPTY STACK"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.stackButton, { borderColor: colors.borderStrong }]}
                onPress={() => navigation.navigate('StackDetail', { stackId: stack.id })}
                activeOpacity={0.8}
              >
                <Text style={[monoLabel(fonts), { color: colors.text, letterSpacing: 1 }]}>VIEW ALL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.stackButton, { borderColor: colors.borderStrong, width: 48, paddingHorizontal: 0 }]}
                onPress={() => void handleArchive(stack)}
                activeOpacity={0.8}
                accessibilityLabel={`Archive ${stack.name} to vault`}
              >
                <Archive size={15} color={colors.textSecondary} strokeWidth={1.8} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    );
  };

  const savedMinutes = useMemo(
    () => saved.reduce((sum, meta) => sum + (meta.estimatedReadMinutes || 0), 0),
    [saved]
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
      {/* ── Header: wordmark + SAVED pill + account + gear ── */}
      <View style={styles.headerRow}>
        <Text style={[styles.headerTitle, { color: colors.text, fontFamily: fonts.title }]}>
          TANGENT
        </Text>
        <View style={styles.headerActions}>
          <View style={[styles.savedPill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[monoLabel(fonts), { color: colors.textMuted }]}>
              <Text style={{ color: colors.accent }}>{`${saved.length} `}</Text>
              SAVED
            </Text>
          </View>
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

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.pageTitleRow}>
          <Text style={[styles.pageTitle, { color: colors.text, fontFamily: fonts.headline }]}>
            Stacks
          </Text>
          <TouchableOpacity
            style={[styles.plusButton, { borderColor: colors.accent }]}
            onPress={openComposer}
            activeOpacity={0.8}
            accessibilityLabel="New stack"
          >
            <Plus size={16} color={colors.accent} strokeWidth={2.2} />
          </TouchableOpacity>
        </View>

        {/* ── Segmented switch (caps labels; VAULT not VAULT / ARCHIVE) ── */}
        <View style={[styles.segmented, { borderColor: colors.border }]}>
          {(['QUEUE', 'HISTORY', 'VAULT'] as Segment[]).map((s) => {
            const active = segment === s;
            return (
              <TouchableOpacity
                key={s}
                style={[
                  styles.segmentButton,
                  active && { backgroundColor: colors.background, borderColor: colors.borderStrong },
                ]}
                onPress={() => setSegment(s)}
                activeOpacity={0.8}
              >
                <Text style={[monoLabel(fonts), { color: active ? colors.text : colors.textSecondary }]}>
                  {s}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── QUEUE: active stacks, then the saved vault ── */}
        {segment === 'QUEUE' ? (
          <>
            {activeStacks.map((stack) => stackCard(stack, false))}
            {activeStacks.length === 0 && saved.length === 0 ? (
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.emptyNote, { color: colors.textMuted, fontFamily: fonts.body }]}>
                  Tap the bookmark on any essay to file it here — or compile your first stack.
                </Text>
              </View>
            ) : null}
            {saved.length > 0 ? (
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.cardHeader}>
                  <View style={styles.labelRow}>
                    <View style={[styles.pip, { backgroundColor: colors.accent }]} />
                    <Text style={[monoLabel(fonts), { color: colors.textSecondary }]}>
                      IMMEDIATE READING
                    </Text>
                  </View>
                  <Text style={[monoLabel(fonts), { color: colors.textFaint }]}>
                    {`UNSORTED SAVES · ${saved.length}`}
                  </Text>
                </View>
                {saved.slice(0, 3).map((meta) => (
                  <View key={meta.id} style={styles.listRow}>
                    <Text
                      style={[styles.rowTitle, { color: colors.text, fontFamily: fonts.bodyMedium }]}
                      numberOfLines={2}
                    >
                      {meta.title}
                    </Text>
                    <Text style={[monoLabel(fonts), { color: colors.textFaint, marginTop: 4 }]}>
                      {`${meta.publicationName.toUpperCase()} · ${meta.estimatedReadMinutes || '?'} MIN`}
                    </Text>
                  </View>
                ))}
                {saved.length > 3 ? (
                  <Text style={[monoLabel(fonts), { color: colors.textFaint }]}>
                    {`+ ${saved.length - 3} MORE IN THE VAULT`}
                  </Text>
                ) : null}
                <TouchableOpacity
                  style={[styles.ghostButton, { borderColor: colors.borderStrong }]}
                  onPress={() => navigation.navigate('SavedReads')}
                  activeOpacity={0.8}
                >
                  <Text style={[monoLabel(fonts), { color: colors.text, letterSpacing: 1 }]}>
                    {`OPEN SAVED VAULT${savedMinutes > 0 ? ` (${savedMinutes} MIN)` : ''}  →`}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </>
        ) : null}

        {/* ── HISTORY: the reading log with % DEPTH when known ── */}
        {segment === 'HISTORY' ? (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <Text style={[monoLabel(fonts), { color: colors.textMuted }]}>READING HISTORY</Text>
              <Text style={[monoLabel(fonts), { color: colors.textFaint }]}>
                {`LAST ${seen.length} READS`}
              </Text>
            </View>
            {seen.length > 0 ? (
              <>
                {seen.slice(0, 8).map((meta) => {
                  const ago = timeAgo(meta.seenAt);
                  const pct =
                    typeof meta.depth === "number"
                      ? Math.round(meta.depth * 100)
                      : null;
                  const pill =
                    pct === null
                      ? null
                      : pct >= 80
                        ? { text: `${pct}% READ`, strong: true }
                        : pct >= 50
                          ? { text: `${pct}% READ`, strong: false }
                          : { text: `${pct}% SKIM`, strong: false };
                  return (
                    <View key={meta.id} style={styles.listRow}>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={[monoLabel(fonts), { color: colors.accent, fontSize: 8.5 }]}>
                          {`${meta.publicationName.toUpperCase()} · ${meta.estimatedReadMinutes || "?"} MIN`}
                        </Text>
                        <Text
                          style={[styles.rowTitle, { color: colors.text, fontFamily: fonts.bodyMedium }]}
                          numberOfLines={2}
                        >
                          {meta.title}
                        </Text>
                        <Text style={[monoLabel(fonts), { color: colors.textFaint, fontSize: 8 }]}>
                          {ago ? `READ ${ago}` : "READ"}
                        </Text>
                      </View>
                      {pill ? (
                        <View
                          style={[
                            styles.pill,
                            {
                              borderColor: pill.strong ? colors.accent : colors.border,
                              backgroundColor: pill.strong ? colors.accentSoft : "transparent",
                            },
                          ]}
                        >
                          <Text
                            style={[
                              monoLabel(fonts),
                              { fontSize: 9, color: pill.strong ? colors.accent : colors.textSecondary },
                            ]}
                          >
                            {pill.text}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  );                })}
                <TouchableOpacity
                  style={[styles.ghostButton, { borderTopColor: colors.border }]}
                  onPress={() => navigation.navigate('History')}
                  activeOpacity={0.8}
                >
                  <Text style={[monoLabel(fonts), { color: colors.text, letterSpacing: 1 }]}>
                    VIEW FULL HISTORY  →
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={[styles.emptyNote, { color: colors.textMuted, fontFamily: fonts.body }]}>
                Your reading log builds as you read essays.
              </Text>
            )}
          </View>
        ) : null}

        {/* ── VAULT: archived stacks (amendment #1) ── */}
        {segment === 'VAULT' ? (
          <>
            {vaultStacks.map((stack) => stackCard(stack, true))}
            {vaultStacks.length === 0 ? (
              <View style={[styles.card, styles.vaultCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[monoLabel(fonts), { color: colors.textMuted }]}>THE VAULT</Text>
                <Text style={[styles.emptyNote, { color: colors.textMuted, fontFamily: fonts.body }]}>
                  Finished stacks rest here — out of your queue, one tap from
                  returning. Archive a stack from the queue with the box button.
                </Text>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

        {/* ── Composer modal (checkbox + live tally + CREATE) ── */}
        <Modal
          visible={composerOpen}
          transparent
          animationType="none"
          statusBarTranslucent
          onRequestClose={() => setComposerOpen(false)}
        >
          <View style={styles.composerBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setComposerOpen(false)} />
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <View style={[styles.composer, { backgroundColor: colors.surfaceRaised, borderTopColor: colors.border }]}>
                <Text style={[monoLabel(fonts), { color: colors.textMuted }]}>NEW STACK</Text>
                <TextInput
                  value={composerName}
                  onChangeText={setComposerName}
                  placeholder="Untitled Stack"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.composerNameInput, { color: colors.text, fontFamily: fonts.bodyMedium, borderColor: colors.borderStrong, backgroundColor: colors.background }]}
                />
                <View style={styles.composerHeader}>
                  <Text style={[monoLabel(fonts), { color: colors.textMuted }]}>PICK FROM YOUR SAVED VAULT</Text>
                  <Text style={[monoLabel(fonts), { color: colors.accent }]}>
                    {`${composerTotals.essays} ESSAYS · ${composerTotals.minutes} MIN`}
                  </Text>
                </View>
                <ScrollView style={styles.composerList} nestedScrollEnabled>
                  {saved.map((meta) => {
                    const checked = picked.has(meta.id);
                    return (
                      <TouchableOpacity
                        key={meta.id}
                        style={[styles.composerRow, checked && { backgroundColor: colors.accentSoft }]}
                        onPress={() => togglePicked(meta.id)}
                        activeOpacity={0.8}
                      >
                        <View
                          style={[
                            styles.checkbox,
                            {
                              borderColor: checked ? colors.accent : colors.borderStrong,
                              backgroundColor: checked ? colors.accent : 'transparent',
                            },
                          ]}
                        >
                          {checked ? <Check size={13} color="#0B0E13" strokeWidth={2.4} /> : null}
                        </View>
                        <Text
                          style={[styles.rowTitle, { color: colors.text, fontFamily: fonts.body, flex: 1 }]}
                          numberOfLines={1}
                        >
                          {meta.title}
                        </Text>
                        <Text style={[monoLabel(fonts), { color: colors.textMuted }]}>
                          {`${meta.estimatedReadMinutes || '?'} MIN`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  {saved.length === 0 ? (
                    <Text style={[styles.emptyNote, { color: colors.textMuted, fontFamily: fonts.body }]}>
                      Your saved vault is empty — bookmark essays from the feed first.
                    </Text>
                  ) : null}
                </ScrollView>
                <TouchableOpacity
                  style={[
                    styles.composerCreate,
                    { backgroundColor: colors.primary, opacity: composerTotals.essays === 0 ? 0.4 : 1 },
                  ]}
                  onPress={() => void handleCreateStack()}
                  disabled={composerTotals.essays === 0 || creating}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[monoLabel(fonts), { color: colors.onPrimary, fontFamily: fonts.mono, fontSize: 12, letterSpacing: 1.2 }]}
                  >
                    {`CREATE STACK (${composerTotals.essays} ESSAYS · ${composerTotals.minutes} MIN)  →`}
                  </Text>
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </View>
        </Modal>

        {/* ── Toast ── */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.toast,
            { backgroundColor: colors.surfaceRaised, borderColor: colors.border, opacity: toastOpacity },
          ]}
        >
          <Text style={[monoLabel(fonts), { color: colors.text }]} numberOfLines={1}>
            {toastTextRef.current}
          </Text>
        </Animated.View>
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
    gap: 10,
  },
  savedPill: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
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
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pip: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  listRow: {
    paddingVertical: 8,
  },
  listRowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  rowTitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  ghostButton: {
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 4,
    borderWidth: 1,
  },
  vaultCard: {
    gap: 10,
  },
  emptyNote: {
    fontSize: 13,
    lineHeight: 20,
  },
  pageTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  plusButton: {
    width: 40,
    height: 40,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stackCard: {
    gap: 8,
  },
  stackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stackName: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
  },
  upNext: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 12,
    gap: 2,
  },
  pill: {
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'center',
  },
  stackActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 6,
  },
  stackPrimary: {
    flex: 1,
    height: 44,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stackButton: {
    height: 44,
    borderRadius: 4,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  composerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  composer: {
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 16,
    gap: 12,
    maxHeight: '82%',
  },
  composerNameInput: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  composerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  composerList: {
    maxHeight: 320,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerCreate: {
    height: 48,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toast: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 10,
    maxWidth: '88%',
  },
});



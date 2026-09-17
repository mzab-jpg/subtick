// ============================================================
// Tangent — Stack Detail (dossier view from the full-interactive mock)
// Banner with session itinerary projection, session ribbon with PART
// labels, per-article rows (READ NOW / remove), ARCHIVE / DELETE,
// and an ADD ARTICLE sheet drawing from the saved vault.
// ============================================================

import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { ChevronLeft, Archive, Trash2, Plus, Check, Play } from "lucide-react-native";
import { useTheme } from "../contexts/ThemeContext";
import { RootStackParamList } from "../types";
import { monoLabel } from "../utils/constants";
import {
  getStacks,
  addEssayToStack,
  removeEssayFromStack,
  moveStackToVault,
  deleteStack,
  stackTotals,
  ReadingStack,
  StackEssay,
} from "../services/feed/stacksStore";
import { getSavedArticleMetas } from "../services/feedService";
import { ArticleMeta } from "../services/feed/articleMeta";

function formatClock(date: Date): string {
  const h = date.getHours() % 12 || 12;
  const m = String(date.getMinutes()).padStart(2, "0");
  const ampm = date.getHours() >= 12 ? "PM" : "AM";
  return `${h}:${m} ${ampm}`;
}

function SessionRibbon({ essays, colors, labels }: {
  essays: StackEssay[];
  colors: { accent: string; borderStrong: string; textFaint: string };
  labels: boolean;
}) {
  if (essays.length === 0) return null;
  return (
    <View>
      <View style={{ flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden", gap: 1 }}>
        {essays.map((essay, i) => (
          <View
            key={essay.id}
            style={{
              flex: Math.max(1, essay.minutes),
              backgroundColor: i % 2 === 0 ? colors.accent : colors.borderStrong,
            }}
          />
        ))}
      </View>
      {labels && essays.length <= 5 ? (
        <View style={{ flexDirection: "row", gap: 1 }}>
          {essays.map((essay) => (
            <Text
              key={essay.id}
              style={[monoLabel({} as never), { fontSize: 8, flex: Math.max(1, essay.minutes), color: colors.textFaint }]}
            >
              {`${essay.minutes}M`}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function StackDetailScreen() {
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "StackDetail">>();
  const [stack, setStack] = useState<ReadingStack | null>(null);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [saved, setSaved] = useState<ArticleMeta[]>([]);

  const loadStack = async () => {
    const all = await getStacks();
    setStack(all.find((s) => s.id === route.params.stackId) ?? null);
  };

  useEffect(() => {
    void loadStack();
    void getSavedArticleMetas().then(setSaved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params.stackId]);

  const totals = stack ? stackTotals(stack) : { essays: 0, minutes: 0 };
  const completionAt = useMemo(() => {
    const d = new Date(Date.now() + totals.minutes * 60_000);
    return formatClock(d);
  }, [totals.minutes]);

  if (!stack) {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <Text style={[monoLabel(fonts), { color: colors.textMuted }]}>STACK NOT FOUND</Text>
      </View>
    );
  }

  const nextEssay = stack.essays[0];

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 4 }]}>
      {/* Header: back + archive + delete */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.iconButton}
          accessibilityLabel="Back"
        >
          <ChevronLeft size={22} color={colors.textSecondary} strokeWidth={1.8} />
        </TouchableOpacity>
        <View style={{ flexDirection: "row", gap: 4 }}>
          <TouchableOpacity
            style={styles.iconButton}
            accessibilityLabel="Archive stack"
            onPress={async () => {
              await moveStackToVault(stack.id);
              navigation.goBack();
            }}
          >
            <Archive size={19} color={colors.textSecondary} strokeWidth={1.8} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconButton}
            accessibilityLabel="Delete stack"
            onPress={async () => {
              await deleteStack(stack.id);
              navigation.goBack();
            }}
          >
            <Trash2 size={19} color={colors.error} strokeWidth={1.8} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Dossier banner */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.accentSoft }]}>
          <Text style={[monoLabel(fonts), { color: colors.accent }]}>{`${totals.essays} ESSAYS · ${totals.minutes} MIN`}</Text>
          <Text style={[styles.stackTitle, { color: colors.text, fontFamily: fonts.headline }]}>{stack.name}</Text>
          <Text style={[monoLabel(fonts), { color: colors.textMuted }]}>
            {`SESSION ITINERARY — COMPLETION AT ~${completionAt}`}
          </Text>
        </View>

        {/* Session ribbon */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[monoLabel(fonts), { color: colors.textMuted }]}>SESSION RIBBON</Text>
          <SessionRibbon essays={stack.essays} colors={{ accent: colors.accent, borderStrong: colors.borderStrong, textFaint: colors.textFaint }} labels={true} />
        </View>

        {/* BEGIN READING */}
        <TouchableOpacity
          style={[styles.primary, { backgroundColor: colors.primary, opacity: totals.essays === 0 ? 0.4 : 1 }]}
          disabled={totals.essays === 0}
          activeOpacity={0.85}
          onPress={() => {
            if (!nextEssay) return;
            navigation.navigate("Reader", {
              articleId: nextEssay.id,
              queueArticleIds: stack.essays.map((e) => e.id),
              startIndex: 0,
              mode: "saved",
            });
          }}
        >
          <Play size={15} color={colors.onPrimary} strokeWidth={2} />
          <Text style={[monoLabel(fonts), { color: colors.onPrimary, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.2 }]}>
            {nextEssay ? `BEGIN READING (${nextEssay.minutes} MIN)` : "EMPTY STACK"}
          </Text>
        </TouchableOpacity>

        {/* Itinerary rows */}
        {stack.essays.map((essay, index) => (
          <View key={essay.id} style={[styles.card, styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[monoLabel(fonts), { color: colors.accent }]}>
                {index === 0 ? "NEXT IN SEQUENCE" : `QUEUED · PART ${index + 1} OF ${stack.essays.length}`}
              </Text>
              <Text style={[styles.rowTitle, { color: colors.text, fontFamily: fonts.bodyMedium }]} numberOfLines={2}>
                {essay.title}
              </Text>
              <Text style={[monoLabel(fonts), { color: colors.textFaint }]}>
                {`${essay.publicationName.toUpperCase()} · ${essay.minutes} MIN`}
              </Text>
            </View>
            <View style={styles.rowActions}>
              <TouchableOpacity
                style={[styles.readNow, { borderColor: colors.borderStrong }]}
                activeOpacity={0.8}
                onPress={() =>
                  navigation.navigate("Reader", {
                    articleId: essay.id,
                    queueArticleIds: stack.essays.map((e) => e.id),
                    startIndex: index,
                    mode: "saved",
                  })
                }
              >
                <Text style={[monoLabel(fonts), { color: colors.text, letterSpacing: 1 }]}>READ NOW</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.removeButton, { borderColor: colors.border }]}
                activeOpacity={0.8}
                accessibilityLabel={"Remove from stack"}
                onPress={async () => {
                  const next = await removeEssayFromStack(stack.id, essay.id);
                  const updated = next.find((s) => s.id === stack.id);
                  if (updated) setStack(updated);
                }}
              >
                <Text style={[monoLabel(fonts), { color: colors.error }]}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {/* ADD ARTICLE */}
        <TouchableOpacity
          style={[styles.addTile, { borderColor: colors.borderStrong }]}
          onPress={() => setAddSheetOpen(true)}
          activeOpacity={0.8}
        >
          <Plus size={16} color={colors.accent} strokeWidth={2} />
          <Text style={[monoLabel(fonts), { color: colors.accent, letterSpacing: 1.2 }]}>ADD ARTICLE</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ADD ARTICLE sheet */}
      <Modal visible={addSheetOpen} transparent animationType="none" statusBarTranslucent onRequestClose={() => setAddSheetOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setAddSheetOpen(false)} />
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={[styles.sheet, { backgroundColor: colors.surfaceRaised, borderTopColor: colors.border }]}>
              <Text style={[monoLabel(fonts), { color: colors.textMuted, marginBottom: 8 }]}>ADD FROM YOUR SAVED VAULT</Text>
              <ScrollView style={{ maxHeight: 360 }}>
                {saved
                  .filter((meta) => !stack.essays.some((e) => e.id === meta.id))
                  .map((meta) => (
                    <TouchableOpacity
                      key={meta.id}
                      style={styles.addRow}
                      activeOpacity={0.8}
                      onPress={async () => {
                        const next = await addEssayToStack(stack.id, {
                          id: meta.id,
                          title: meta.title,
                          publicationName: meta.publicationName,
                          minutes: meta.estimatedReadMinutes || 0,
                        });
                        const updated = next.find((s) => s.id === stack.id);
                        if (updated) setStack(updated);
                        setAddSheetOpen(false);
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.text }} numberOfLines={1}>
                          {meta.title}
                        </Text>
                        <Text style={[monoLabel(fonts), { color: colors.textFaint, marginTop: 2 }]}>
                          {`${meta.publicationName.toUpperCase()} · ${meta.estimatedReadMinutes || "?"} MIN`}
                        </Text>
                      </View>
                      <Plus size={16} color={colors.accent} strokeWidth={2} />
                    </TouchableOpacity>
                  ))}
                {saved.filter((meta) => !stack.essays.some((e) => e.id === meta.id)).length === 0 ? (
                  <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textMuted }}>
                    Everything in your vault is already in this stack.
                  </Text>
                ) : null}
              </ScrollView>
              <TouchableOpacity
                style={[styles.sheetClose, { borderTopColor: colors.border }]}
                onPress={() => setAddSheetOpen(false)}
              >
                <Text style={[monoLabel(fonts), { color: colors.textSecondary, letterSpacing: 1.2 }]}>DONE</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  scroll: { paddingHorizontal: 24, paddingBottom: 32, gap: 12 },
  card: { borderWidth: 1, borderRadius: 8, padding: 16, gap: 8 },
  stackTitle: { fontSize: 24, lineHeight: 30, letterSpacing: -0.3, fontWeight: "500" },
  primary: {
    height: 48,
    borderRadius: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  row: { flexDirection: "row", gap: 12 },
  rowTitle: { fontSize: 15, lineHeight: 21 },
  rowActions: { alignItems: "flex-end", justifyContent: "space-between", gap: 8 },
  readNow: {
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  removeButton: {
    width: 32,
    height: 32,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  addTile: {
    borderWidth: 1,
    borderRadius: 8,
    borderStyle: "dashed",
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { borderTopWidth: 1, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8 },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
  },
  sheetClose: { borderTopWidth: 1, alignItems: "center", paddingVertical: 14, marginTop: 8 },
});

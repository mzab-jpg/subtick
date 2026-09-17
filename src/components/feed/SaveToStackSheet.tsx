// ============================================================
// Tangent — Save-to-Stack Sheet (B1 filing concept)
// Filing-not-saving: the bookmark opens the sheet, the user picks
// a destination — the Saved vault or any reading stack — or types
// a name to found a new stack on the spot. Local stacks now; the
// backend phase swaps stacksStore internals for Firestore.
// ============================================================

import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Bookmark, Check, Plus, Layers } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { monoLabel } from '../../utils/constants';
import {
  getStacks,
  createStack,
  addEssayToStack,
  stackTotals,
  ReadingStack,
  StackEssay,
} from '../../services/feed/stacksStore';

interface SaveToStackSheetProps {
  visible: boolean;
  alreadySaved: boolean;
  /** The essay being filed; null disables saving. */
  article: {
    id: string;
    title: string;
    publicationName: string;
    minutes: number;
  } | null;
  onClose: () => void;
  /** Fired with the confirmation label for the hero toast. */
  onFiled: (label: string) => void;
  /** Vault save (existing savedStore path, handled by the parent). */
  onSaveVault: () => Promise<void>;
}

export function SaveToStackSheet({
  visible,
  alreadySaved,
  article,
  onClose,
  onFiled,
  onSaveVault,
}: SaveToStackSheetProps) {
  const { colors, fonts } = useTheme();
  const [stacks, setStacks] = useState<ReadingStack[]>([]);
  const [busy, setBusy] = useState(false);
  const [vaultSaved, setVaultSaved] = useState(alreadySaved);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (!visible) return;
    setVaultSaved(alreadySaved);
    setCreating(false);
    setNewName('');
    void getStacks().then(setStacks);
  }, [visible, alreadySaved]);

  if (!article) return null;

  const essay: StackEssay = {
    id: article.id,
    title: article.title,
    publicationName: article.publicationName,
    minutes: article.minutes,
  };

  const finish = (label: string) => {
    onFiled(label);
    setTimeout(onClose, 500);
  };

  const handleAddToStack = async (stack: ReadingStack) => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await addEssayToStack(stack.id, essay);
      setStacks(next);
      finish(`SAVED TO ${stack.name.toUpperCase()}`);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateStack = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await createStack(newName || 'Untitled Stack', [essay]);
      finish(`SAVED TO ${(newName || 'Untitled Stack').toUpperCase()}`);
    } finally {
      setBusy(false);
    }
  };

  const handleVault = async () => {
    if (vaultSaved || busy) return;
    setBusy(true);
    try {
      await onSaveVault();
      setVaultSaved(true);
      finish('SAVED TO VAULT');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.sheet, { backgroundColor: colors.surfaceRaised, borderTopColor: colors.border }]}>
            <Text style={[monoLabel(fonts), { color: colors.textMuted, marginBottom: 10 }]}>
              SAVE TO STACK
            </Text>

            {/* Vault destination */}
            <TouchableOpacity
              style={[styles.row, vaultSaved && { backgroundColor: colors.accentSoft }]}
              onPress={handleVault}
              disabled={vaultSaved || busy}
              activeOpacity={0.8}
            >
              <View style={[styles.rowIcon, { borderColor: colors.border }]}>
                <Bookmark
                  size={16}
                  color={vaultSaved ? colors.accent : colors.textSecondary}
                  fill={vaultSaved ? colors.accent : 'transparent'}
                  strokeWidth={1.8}
                />
              </View>
              <View style={styles.rowText}>
                <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.text }}>
                  Saved
                </Text>
                <Text style={[monoLabel(fonts), { color: colors.textMuted, marginTop: 2 }]}>
                  READ-LATER VAULT
                </Text>
              </View>
              {vaultSaved ? <Check size={18} color={colors.accent} strokeWidth={2.2} /> : null}
            </TouchableOpacity>

            {/* Stack destinations */}
            {stacks.map((stack) => {
              const totals = stackTotals(stack);
              const held = stack.essays.some((e) => e.id === article.id);
              return (
                <TouchableOpacity
                  key={stack.id}
                  style={[styles.row, held && { backgroundColor: colors.accentSoft }]}
                  onPress={() => void handleAddToStack(stack)}
                  disabled={held || busy}
                  activeOpacity={0.8}
                >
                  <View style={[styles.rowIcon, { borderColor: colors.border }]}>
                    <Layers size={16} color={held ? colors.accent : colors.textSecondary} strokeWidth={1.8} />
                  </View>
                  <View style={styles.rowText}>
                    <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.text }}>
                      {stack.name}
                    </Text>
                    <Text style={[monoLabel(fonts), { color: colors.textMuted, marginTop: 2 }]}>
                      {held ? 'ALREADY IN THIS STACK' : `${totals.essays} ESSAYS`}
                    </Text>
                  </View>
                  {held ? <Check size={18} color={colors.accent} strokeWidth={2.2} /> : null}
                </TouchableOpacity>
              );
            })}

            {/* + NEW STACK — inline founder */}
            {creating ? (
              <View style={[styles.creatorRow, { borderColor: colors.border }]}>
                <TextInput
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="Untitled Stack"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.nameInput, { color: colors.text, fontFamily: fonts.bodyMedium, borderColor: colors.borderStrong, backgroundColor: colors.background }]}
                  autoFocus
                  onSubmitEditing={() => void handleCreateStack()}
                />
                <TouchableOpacity
                  style={[styles.createMiniButton, { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }]}
                  onPress={() => void handleCreateStack()}
                  activeOpacity={0.85}
                >
                  <Check size={16} color={colors.onPrimary} strokeWidth={2.2} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.row}
                onPress={() => setCreating(true)}
                disabled={busy}
                activeOpacity={0.8}
              >
                <View style={[styles.rowIcon, { borderColor: colors.accent }]}>
                  <Plus size={16} color={colors.accent} strokeWidth={2} />
                </View>
                <View style={styles.rowText}>
                  <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.accent }}>
                    New Stack
                  </Text>
                  <Text style={[monoLabel(fonts), { color: colors.textMuted, marginTop: 2 }]}>
                    FILE THIS ESSAY INTO A FRESH STACK
                  </Text>
                </View>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.closeButton, { borderTopColor: colors.border }]}
              onPress={onClose}
              activeOpacity={0.8}
            >
              <Text style={[monoLabel(fonts), { color: colors.textSecondary, letterSpacing: 1.2 }]}>
                CANCEL
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 4,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
  },
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 4,
  },
  nameInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  createMiniButton: {
    width: 36,
    height: 36,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    borderTopWidth: 1,
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 8,
  },
});

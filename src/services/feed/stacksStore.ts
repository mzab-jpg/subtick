// ============================================================
// Tangent — Reading Stacks Store (frontend-first)
// Local AsyncStorage stacks so the full composer/queue/vault UI
// works before the Firestore backend lands (design/stitch-export/
// new-ui-B/README.md). The backend phase swaps these internals for
// a users/{uid}/stacks subcollection — the API surface stays.
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';

const STACKS_KEY = '@subtick_stacks';

export interface StackEssay {
  id: string;
  title: string;
  publicationName: string;
  minutes: number;
}

export interface ReadingStack {
  id: string;
  name: string;
  essays: StackEssay[];
  /** active = on the Stacks screen; vault = archived (owner amendment #1). */
  state: 'active' | 'vault';
  createdAt: number;
  updatedAt: number;
}

export function makeStackId(): string {
  return `stack_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function getStacks(): Promise<ReadingStack[]> {
  try {
    const raw = await AsyncStorage.getItem(STACKS_KEY);
    return raw ? (JSON.parse(raw) as ReadingStack[]) : [];
  } catch {
    return [];
  }
}

async function writeStacks(stacks: ReadingStack[]): Promise<void> {
  await AsyncStorage.setItem(STACKS_KEY, JSON.stringify(stacks));
}

export function stackTotals(stack: ReadingStack): { essays: number; minutes: number } {
  return {
    essays: stack.essays.length,
    minutes: stack.essays.reduce((sum, essay) => sum + (essay.minutes || 0), 0),
  };
}

export async function createStack(name: string, essays: StackEssay[]): Promise<ReadingStack> {
  const now = Date.now();
  const stack: ReadingStack = {
    id: makeStackId(),
    name: name.trim() || 'Untitled Stack',
    essays,
    state: 'active',
    createdAt: now,
    updatedAt: now,
  };
  const stacks = await getStacks();
  await writeStacks([stack, ...stacks]);
  return stack;
}

/** Adds an essay if this stack doesn't already hold it. Returns updated stacks. */
export async function addEssayToStack(stackId: string, essay: StackEssay): Promise<ReadingStack[]> {
  const stacks = await getStacks();
  const next = stacks.map((stack) => {
    if (stack.id !== stackId || stack.essays.some((e) => e.id === essay.id)) return stack;
    return { ...stack, essays: [...stack.essays, essay], updatedAt: Date.now() };
  });
  await writeStacks(next);
  return next;
}

export async function removeEssayFromStack(stackId: string, essayId: string): Promise<ReadingStack[]> {
  const stacks = await getStacks();
  const next = stacks.map((stack) =>
    stack.id === stackId
      ? { ...stack, essays: stack.essays.filter((e) => e.id !== essayId), updatedAt: Date.now() }
      : stack
  );
  await writeStacks(next);
  return next;
}

export async function moveStackToVault(stackId: string): Promise<ReadingStack[]> {
  const stacks = await getStacks();
  const next = stacks.map((stack) =>
    stack.id === stackId ? { ...stack, state: 'vault' as const, updatedAt: Date.now() } : stack
  );
  await writeStacks(next);
  return next;
}

export async function restoreStackFromVault(stackId: string): Promise<ReadingStack[]> {
  const stacks = await getStacks();
  const next = stacks.map((stack) =>
    stack.id === stackId ? { ...stack, state: 'active' as const, updatedAt: Date.now() } : stack
  );
  await writeStacks(next);
  return next;
}

export async function deleteStack(stackId: string): Promise<ReadingStack[]> {
  const stacks = await getStacks();
  const next = stacks.filter((stack) => stack.id !== stackId);
  await writeStacks(next);
  return next;
}

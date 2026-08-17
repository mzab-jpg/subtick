// ============================================================
// Tangent — Account Transition Coordinator
// Keeps the app from rendering one account's navigation/profile state while
// sign-out, reset, or deletion prepares a fresh account.
// ============================================================

type TransitionListener = (active: boolean) => void;

const listeners = new Set<TransitionListener>();
let active = false;

export function subscribeToAccountTransition(listener: TransitionListener): () => void {
  listeners.add(listener);
  listener(active);
  return () => listeners.delete(listener);
}

export function beginAccountTransition(): void {
  active = true;
  listeners.forEach((listener) => listener(true));
}

export function endAccountTransition(): void {
  active = false;
  listeners.forEach((listener) => listener(false));
}

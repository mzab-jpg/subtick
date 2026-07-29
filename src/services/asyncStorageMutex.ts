// ============================================================
// SubTick — AsyncStorage Mutex
// Shared concurrency-safe queue for AsyncStorage read-modify-write operations.
// Each service creates its own independent queue — they must NOT share
// a queue because they serve different domains (feeds, behavior, etc.)
// and one slow domain should not block the other.
// ============================================================

type StorageOperation<T> = () => Promise<T>;

export interface StorageMutex {
  enqueue<T>(operation: StorageOperation<T>): Promise<T>;
}

/**
 * Creates a new independent mutex queue for AsyncStorage operations.
 * Call this once per service domain.
 */
export function createStorageMutex(): StorageMutex {
  let queue = Promise.resolve();

  return {
    async enqueue<T>(operation: StorageOperation<T>): Promise<T> {
      const nextInLine = queue.then(operation);
      queue = nextInLine.then(() => {}).catch(() => {});
      return nextInLine;
    },
  };
}
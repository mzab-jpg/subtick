// ============================================================
// SubTick — Feed: Storage Mutex
// Shared concurrency-safe queue for feed-domain AsyncStorage
// read-modify-write operations (seen + saved stores).
//
// Feed and behavior deliberately use SEPARATE queues so one
// slow domain never blocks the other (see asyncStorageMutex.ts).
// ============================================================

import { createStorageMutex } from '../asyncStorageMutex';

export const feedStorageMutex = createStorageMutex();

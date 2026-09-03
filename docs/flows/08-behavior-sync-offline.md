# 08 — Behavior Sync & the Offline Queue

> **What this shows:** what happens to every event between "user does a thing" and
> "the server learns from it" — including what survives being offline.

---

## 1. Queue → flush → learn

```mermaid
flowchart TD
    E["event: read_session · like · save · swipe_not_interested · quick_exit (server-classified) etc."] --> Q["queueBehaviorEvent\nAsyncStorage @subtick_behavior_queue\n500 cap (oldest dropped first), mutex-serialized"]
    Q --> F{"flush trigger?"}
    F -->|"Reader exit"| FL
    F -->|"network restored (NetInfo)"| FL
    F -->|"other lifecycle flush"| FL
    FL --> UP["flushBehaviorQueue  — network runs OUTSIDE the mutex so new events can queue meanwhile"]
    UP -->|"no network?  go back to Q"| Q
    UP --> C["syncBehaviorEvents callable (≤100 events, client_id included)"]
    C --> V["validate: auth.uid, field checks, finite timestamps, depth [0,1], duration ≤ 24h, word count ≤ 1,000,000"]
    V --> CL["classify raw read_session  (geometry-only:  see 06)"]
    CL --> ST["persist final event type (+ feedId/impressionId attribution)"]
    ST --> UP2["update user weights + publisher quality + trendingScore (same batch; watermark moves"]
    ST --> GA["analytics:  final types + weight_updated + user properties"]
    UP2 --> DONE["synced events pruned after 5 min  — the queue idempotent via event.id doc IDs"]
```

---

## 2. The offline manager (network watch)

```mermaid
flowchart TD
    N["@react-native-community/netinfo"] --> ON{"back online?"}
    ON -->|"yes"| TRY{"cooldown active? (last failure < 30s)"}
    TRY -->|"yes"| WAIT["skip — retry later"]
    TRY -->|"no"| FL2["attemptFlush"]
    FL2 -->|"success"| GONE["queue drained"]
    FL2 -->|"failure"| CF["lastFailureTime = now → 30s cooldown"]
    CF --> WAIT
```

- **Concurrent callers share ONE upload:** module-level in-progress promise — two
  flushes can't send the same unsynced 20-event batch twice (B6 fix..
- **Reader-safe sync:** reaching the 20-event batch size never starts an upload during
  active reading — events stay queued until Reader exit / reconnect / lifecycle flush.

## 3. Failure table — nothing left out

| Scenario | Behaviour |
|---|---|
| Sync fails | 30s cooldown, then retry |
| Queue overflow | 500 cap; oldest dropped |
| Server input cap | ≤100 events per call; malformed telemetry rejected before persist |
| Concurrent flush | Share one in-progress upload promise |
| Offline session | Raw session queued honestly until reconnect; profile stats stay provisional |
| Synced events cleanup | Pruned after 5 min if `synced: true` |
| Duplicate send | `event.id` is the Firestore doc ID — idempotent |

---

## 4. Where this lives

| Concern | File |
|---|---|
| Client queue + flush | `src/services/behaviorSync.ts` |
| Mutex factory | `src/services/asyncStorageMutex.ts` |
| Offline reconnect manager | `src/services/offlineManager.ts` |
| Session sensing (what goes in the queue)) | `src/hooks/useBehaviorTracker.ts` |
| Server validate + classify + deltas | `firebase/functions/src/syncBehaviorEvents.ts` |
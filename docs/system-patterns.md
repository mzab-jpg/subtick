# Tangent — System Patterns

> **Last verified:** July 2026 against current codebase (post-cost-optimisation + full audit/fix session).
> All values, formulas, and constants are pulled directly from source code — no estimates.

---

## 1. State Management

### Global State (React Context)
| State | Provider | Consumers | Persistence |
|---|---|---|---|
| Theme (light/dark/system) + computed color palette | `ThemeContext.tsx: ThemeProvider` | All screens via `useTheme()` | `AsyncStorage[@subtick_theme_preference]` + Firestore `users/{uid}.themePreference` |
| Pre-compiled WebView CSS string | `ThemeContext.tsx: webViewCSS` computed in `useMemo` | `ReaderScreen.tsx` (initial load only — updates pushed via `injectJavaScript`) | Recomputed on theme change, never persisted |

### Local Component State
- `DashboardScreen.tsx`: `feedArticles: Article[]`, `userProfile: UserProfile | null`, `loading: boolean`, `sessionShownIds: Set<string>` (in-memory, resets on unmount). Focus listener no longer triggers a full refetch on every navigation back — only when all articles have been read (A5 fix). Reader queue is shuffled on tap so untapped cards are scattered randomly (A5 fix). `getTopCategory()` uses `userProfile.categoryWeights || {}` to guard against missing schema fields.
- `ReaderScreen.tsx`: `article`, `resolvedHtml`, `currentIndex`, `activeQueueIds`, `articleCache` (in-memory sliding window), `isLiked`, `isSaved`, `hudVisible`, `queueExhausted`, `preloading`
- `OnboardingScreen.tsx`: `chipStates: Record<string, 'selected'|'not_interested'|'neutral'>` — pure local, never synced until Continue is pressed
- `SettingsScreen.tsx`: `profile: UserProfile | null` — fetched on mount + focus, optimistically updated on changes. Account section now delegates to `AccountScreen.tsx` sub-screen (single navigation row with email/Anonymous subtitle).
- `AccountScreen.tsx`: `profile: UserProfile | null` — fetched on mount. Shows account status card (email or "Anonymous"), link/unlink Google toggle, and action buttons.
- `CategoryPreferencesScreen.tsx`: `profile: UserProfile | null`, `selectedIds`, `notInterestedIds`. `handleTap` uses `...(profile.categoryWeights || {})` for null-safety.

### On-Device State (AsyncStorage — primary store)
**Note:** `@subtick_seen_articles` IDs are now also written to Firestore `users/{uid}.seenArticleIds` (via `arrayUnion`) for cross-device dedup. AsyncStorage remains the primary/instant store; Firestore is the sync layer.

| Key | Content | Max Size |
|---|---|---|
| `@subtick_seen_articles` | `string[]` of article IDs (also synced to Firestore `seenArticleIds`) | 1000 entries (oldest dropped) |
| `@subtick_seen_articles_meta` | `Record<string, {id,title,publicationName,category,estimatedReadMinutes}>` | Unbounded |
| `@subtick_saved_articles` | `string[]` of saved article IDs | Unbounded |
| `@subtick_saved_articles_meta` | `Record<string, ArticleMeta>` | Unbounded |
| `@subtick_saved_html_{articleId}` | Full sanitized HTML string for offline reading | One key per saved article |
| `@subtick_behavior_queue` | `PendingBehaviorEvent[]` pending sync | 500 max (oldest dropped first) |
| `@subtick_theme_preference` | `'system'|'light'|'dark'` | Tiny |
| `@subtick_rss_failed_{articleId}` | `'1'` flag indicating this article's RSS feed has failed | One key per failed article |

### AsyncStorage Mutex (Concurrency Safety)
All AsyncStorage operations in `feedService.ts` and `behaviorSync.ts` involving read-modify-write are serialized through a **Promise chain mutex**. Each file maintains its own independent queue:

```typescript
// feedService.ts  /  behaviorSync.ts (identical pattern in both)
let storageQueue = Promise.resolve();

async function enqueueStorageOperation<T>(operation: () => Promise<T>): Promise<T> {
  const nextInLine = storageQueue.then(operation);
  storageQueue = nextInLine.then(() => {}).catch(() => {});
  return nextInLine;
}
```

`feedService.ts` uses this for: `markArticleSeen`, `markArticleSaved`, `unmarkArticleSaved`, `getSeenArticleIds`, `getSavedArticleIds`.

`behaviorSync.ts` uses this for: `queueBehaviorEvent` (the queue append) and both the read-step and write-back-step of `flushBehaviorQueue`. The network upload itself runs *outside* the mutex so new events can be queued while an upload is in progress (B6 fix).

---

## 2. The Ranking / Scoring Algorithm

### 2a. Component Normalization

**All 5 scoring components output values in [0, 1].** This ensures the formula weights mean exactly what they say — a 40% weight produces exactly 40% of the score contribution at maximum.

### 2b. P — Personalization [0, 1]

Source: `getRankedFeed.ts: normalizeP()`

```typescript
const MIN_W = 0.1, MAX_W = 5.0, RANGE = 4.9;
catFraction = (categoryWeight - MIN_W) / RANGE
pubFraction = (publisherWeight - MIN_W) / RANGE
P = catFraction × 0.7 + pubFraction × 0.3
```

Category gets 70% of P, publisher gets 30%.

| Situation | catWeight | pubWeight | P |
|---|---|---|---|
| New user (neutral) | 1.0 | 1.0 | ≈ 0.18 |
| Likes category | 3.0 | 1.0 | ≈ 0.47 |
| Loves both | 4.5 | 3.5 | ≈ 0.84 |
| Hates category | 0.1 | 1.0 | ≈ 0.05 |
| Maximum | 5.0 | 5.0 | 1.00 |

Weights come from the user profile (3D matrix: category × category+length composite × publisher). Neutral = 1.0, max = 5.0, min = 0.1.

### 2c. T — Trending [0, 1]

Source: `getRankedFeed.ts: normalizeT()`, decay in `cronDecayTrendingScores`

```typescript
T = min(trendingScore, MAX_TRENDING_SCORE) / MAX_TRENDING_SCORE
// MAX_TRENDING_SCORE = 50
```

`trendingScore` is incremented when users engage with an article. It decays daily at **×0.9057** (halves every 7 days). The decay cron only processes articles with `trendingScore > 1.0` (raised from 0.1 to reduce write costs — C1 fix).

Trending increments (`syncBehaviorEvents.ts`):
| Action | trendingScore increment |
|---|---|
| Save | +3.0 |
| Unsave | -3.0 |
| Like | +2.0 |
| Unlike | -2.0 |
| Read thoroughly | +1.5 |
| Read skim | +0.5 |
| Read shallow | +0.2 |
| Swipe past / exit | +0.0 |

**peakTrendingScore:** Each article also tracks `peakTrendingScore` — the all-time high value of `trendingScore`, which never decays. Updated in the **same batch** as the trendingScore increment in `syncBehaviorEvents.ts`. Used by `cronCleanupOldArticles` to rank which old articles to delete.

**Per-user per-article dedup:** In-batch `likeDedup` and `saveDedup` Sets prevent a user from double-counting like/unlike or save/unsave on the same article within a single API call batch.

### 2d. R — Recency [0, 1]

Source: `getRankedFeed.ts: normalizeR()`

**Two-phase decay** — stays high for the first 7 days, then falls more steeply:

```typescript
if (daysOld <= 7):
    R = 1.0 - (daysOld / 7) × 0.2      // Linear: 1.0 → 0.8
else:
    R = 0.8 × (7 / daysOld)^1.5         // Power-law: steep after day 7
```

| Age | R value |
|---|---|
| 0 days | 1.00 |
| 3 days | 0.91 |
| 7 days | 0.80 |
| 14 days | 0.43 |
| 28 days | 0.15 |
| 60 days | 0.04 |

### 2e. Q — Publisher Quality [0, 1]

Source: `getRankedFeed.ts: normalizeQ()`

```typescript
Q = (publisherQualityScore - 0.2) / 0.8
// Crowd-sourced qualityScore is clamped to [0.20, 1.00]
```

| Raw quality | Q |
|---|---|
| 0.20 (worst) | 0.00 |
| 0.80 (default new) | 0.75 |
| 1.00 (best) | 1.00 |

Publisher quality increments (`syncBehaviorEvents.ts`):
```
save: +0.010 / like: +0.005 / read_thorough: +0.005 / read_skim: +0.001
swipe_not_interested: -0.010 / quick_exit: -0.005
```

### 2f. U — Diversity [0, 1]

Source: `getRankedFeed.ts: normalizeU()`

```typescript
rawU = 1.0 - (min(1.0, (articlesInSamePub - 1) / 15) × 0.6)
U = (rawU - 0.4) / 0.6
```

| Articles from same publisher | U |
|---|---|
| 1 | 1.00 (no penalty) |
| 8 | 0.53 |
| 16+ | 0.00 (maximum penalty) |

### 2g. Scoring Formulas by Tranche

**High & Mid tranches (personalized):**
```
Score = 0.40×P + 0.15×T + 0.20×R + 0.15×Q + 0.10×U
```
Weights defined in `SCORE_WEIGHTS` in `firebase/functions/src/constants.ts`. Sum = 1.0. Output: [0, 1].

**Low & Discovery tranches (merit-based):**
```
Score = 0.40×R + 0.30×T + 0.30×Q
```
Weights defined in `SCORE_WEIGHTS_MERIT` in `firebase/functions/src/constants.ts`. Sum = 1.0. No personalization, no diversity penalty.

### 2h. Tranche Assembly

Source: `getRankedFeed.ts: assembleFeedWithTranches()`

Articles bucketed by normalized P value:

| Tranche | P threshold | Target | Selection (established users) | Selection (new users, <30 reads) |
|---|---|---|---|---|
| High | P ≥ 0.40 | 12 | **Random shuffle** | **Random shuffle** |
| Mid | P ≥ 0.20 | 8 | **Random shuffle** | **Random shuffle** |
| Low | P ≥ 0.10 | 4 | **Merit score DESC** | **Random shuffle** |
| Discovery | P < 0.10 | 6 | **Merit score DESC** | **Random shuffle** |

High/Mid are always shuffled randomly to provide variety within preferred categories. Low/Discovery are sorted by merit score (R+T+Q) for established users to surface the best objectively-good articles, but randomized for new users with fewer than 30 total reads. Overflow from underpopulated tranches cascades down. Final feed of 30 is shuffled before return.

---

## 3. Weight Learning System

### 3a. Feedback Delta Multipliers (Δ)

Source: `firebase/functions/src/constants.ts` (server) and `src/utils/constants.ts` (client — identical values)

```typescript
export const FEEDBACK_DELTAS = {
  save:                +0.55,
  like:                +0.40,
  read_thorough:       +0.30,
  read_skim:           +0.10,
  read_shallow:        +0.00,
  swipe_next:          +0.00,
  quick_exit:          -0.20,
  swipe_not_interested: -0.40,
};
```

### 3b. Dimension-Specific Learning Rates

Source: `weightUpdater.ts`

```typescript
const categoryL  = LEARNING_RATE × 1.0;  // 0.08
const lengthL    = LEARNING_RATE × 1.5;  // 0.12
const publisherL = LEARNING_RATE × 2.0;  // 0.16
```

`LEARNING_RATE = 0.08`

Each behavior event updates three dimensions:
```
categoryWeight[category]          += Δ × 0.08
categoryLengthWeights[cat::style] += Δ × 0.12
publisherWeights[publisher]       += Δ × 0.16
```

### 3c. Watermark-Based Event Processing

Source: `weightUpdater.ts`

`updateWeights()` stores `weightUpdatedAt` (Unix ms timestamp) on the user profile. On each call:
1. Queries only events with `timestamp > weightUpdatedAt` (new events only — no replay)
2. Processes those events
3. Updates `weightUpdatedAt` to the latest processed event's timestamp
4. Applies daily decay only if `now - watermark >= 23 hours`

### 3d. Clamping

```
weight = max(0.1, min(5.0, weight))
```

### 3e. Daily Decay

```typescript
decayed[cat] = 1.0 + (weight - 1.0) × DAILY_DECAY_RATE
// DAILY_DECAY_RATE = 0.995 (0.5% per day)
```

Weights drift back toward 1.0 (neutral) if unused. Applied at most once per 23-hour window.

### 3f. UI Sync Thresholds

After weight update, `selectedCategoryIds` and `notInterestedCategoryIds` are synced:
- `weight <= 0.2` → add to `notInterestedCategoryIds`, remove from `selectedCategoryIds`
- `weight >= 1.5` → add to `selectedCategoryIds`, remove from `notInterestedCategoryIds`
- `0.2 < weight < 1.5` (if was notInterested) → remove from `notInterestedCategoryIds`

---

## 4. Behavior Event Classification

Source: `useBehaviorTracker.ts: concludeSession()`

```
if (scrollDepth < QUICK_EXIT_MAX_SCROLL AND sessionDuration < QUICK_EXIT_MAX_DURATION_MS):
    → 'quick_exit'          // < 20% scroll AND < 15s
else if (scrollDepth >= 0.8):
    if (sessionDuration >= expectedReadTime × 0.7):
        → 'read_thorough'
    else:
        → 'read_skim'
else if (scrollDepth >= 0.4):
    → 'read_shallow'
else:
    → 'swipe_next'
```

`QUICK_EXIT_MAX_SCROLL = 0.2` and `QUICK_EXIT_MAX_DURATION_MS = 15_000` are named constants from `src/utils/constants.ts`.

Right-swipe always emits `'swipe_not_interested'` (fires immediately via `trackEvent`, not `concludeSession`).

**Quick-exit double-fire prevention (B2 fix):** `useBehaviorTracker` now uses a shared `sessionSnapshotRef` object. When `concludeSession()` fires, it sets `sessionSnapshotRef.current.concluded = true`. The `useEffect` cleanup, which also closes over `sessionSnapshotRef.current`, reads the live `concluded` value — if it's `true`, the cleanup fires nothing. This replaced the old frozen-value snapshot pattern that always saw `concluded = false`.

**Tracking disabled** in `'history'`, `'saved'`, and mock/sandbox modes.

---

## 5. Async / Failure Handling

### RSS Collector
| Operation | Timeout | Failure |
|---|---|---|
| `parser.parseURL()` | 15s | Caught per-feed; other feeds continue |
| `fetchOgMetadata()` | 6s | Returns empty `{}`; article written without image/description |
| Feed batches | `Promise.allSettled()` | One feed failure never blocks others |
| Article existence check | — | Single `db.getAll()` batch per feed (C3 fix) |

### Client RSS Fetch
| Operation | Timeout | Failure |
|---|---|---|
| `fetch(feedUrl)` | 15s (AbortController) | Throws; `feedSessionCache.delete(feedUrl)` so next request retries |
| Article not found in feed | — | `markRssFailed(id)` in AsyncStorage; article renders as archived (raw URL) |
| HTML sanitization | — | Runs only on the single matched article, not the whole feed (C6 fix) |

### getRankedFeed Cloud Function
| Operation | Failure |
|---|---|
| `system/candidatePool` read | Falls back to on-the-fly stratified query |
| On-the-fly query | Returns expired in-memory cache if available; throws if empty |
| Publisher quality fetch | Returns expired/empty cache; articles fall back to `article.qualityScore` |

### Client getRankedFeed Call
| Failure | Fallback |
|---|---|
| Cloud Function call fails | `fallbackGetArticles()`: Firestore query `articles WHERE isPaywalled == false ORDER BY publishDate DESC LIMIT 90`, filter seen |

### Behavior Sync
| Scenario | Behavior |
|---|---|
| No network | Events remain in `@subtick_behavior_queue` |
| Network restored | `offlineManager.ts` fires `attemptFlush()` |
| Sync fails | 30s cooldown (`RETRY_COOLDOWN_MS`), then retry |
| Concurrent flush | `isSyncing` guard prevents double-flush |
| Queue overflow | 500 cap; oldest events dropped |
| Server input cap | `syncBehaviorEvents` truncates to 50 events max per call (A4 fix) — prevents batch overflow and abuse |
| Synced events cleanup | Events older than 5 min with `synced: true` pruned after flush |
| Concurrent queue + flush | Both use the same `enqueueStorageOperation` mutex; network call is outside (B6 fix) |

### WebView Navigation Lock
**HUD Visibility:** HUD starts hidden (`useState(false)`). It appears only when the user actively scrolls up (the WebView injected JS sends a `hud:visible=true` message when `scrollTop < lastScrollTop - 15`). The `scrollTop <= 0` case (which previously showed the HUD on initial page load) has been removed (A5 fix). HUD shows article title with `ellipsizeMode="tail"` truncation instead of publication name (A5 fix). Tap anywhere on the article body toggles it; it auto-hides after 2.5s.

- **Sanitized HTML mode:** Any `http` link click → `Linking.openURL(url); return false`
- **Raw URI (archived) mode:** Same-domain navigations allowed (redirects); cross-domain → OS browser. Initial load fully allowed.
- HTTP errors (≥400) or load errors → error UI with "Open in Browser" button.

---

## 6. Functions with Legal / Compliance Significance

> ⚠️ **Do not modify these without understanding the implications.**

### Paywall Detection — `checkIsPaywalled()` (`rssCollector.ts`)
Paywalled articles are excluded from all candidate pools and feed results. Three mechanisms:
1. Keyword match against PAYWALL_KEYWORDS (24 phrases) — defined in `firebase/functions/src/constants.ts`
2. CSS class: `class="*paywall*"`, `class="*subscriber-only*"`, `class="*locked-content*"`
3. Script pattern: body contains both `/paywall/i` and `<script`

### `isTruncatedFeed` Flag (`rssCollector.ts`)
```typescript
const isTruncatedFeed = bodyHtml.length > 0 && (description.length / bodyHtml.length) > 0.9;
```
Used in `weightUpdater.ts` to skip WPM calibration for articles where the RSS body is truncated. Removing this guard corrupts users' `averageWpm`.

### Article ID Generation — `generateArticleId()` (`rssCollector.ts`)
```typescript
const hash = createHash('sha256').update(`${url}::${title}`).digest('hex');
return `article_${hash.substring(0, 16)}`;
```
Sole deduplication mechanism. Format must remain stable across deployments.

### `rssStatus` Lifecycle
- `'current'`: Reader fetches live RSS content
- `'archived'`: Reader loads `publicationUrl` directly as a full webpage
- Client sets `@subtick_rss_failed_{id}` in AsyncStorage when live RSS fetch fails (replaces the previously-broken Firestore write, which was blocked by security rules)
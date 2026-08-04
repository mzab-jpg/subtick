# Tangent — System Patterns

> **Last verified:** 4 August 2026 (post-analytics logging implementation).
> All values, formulas, and constants are pulled directly from source code — no estimates.

---

## 1. State Management

### Global State (React Context)
| State | Provider | Consumers | Persistence |
|---|---|---|---|
| Theme (light/dark/system) + computed color palette | `ThemeContext.tsx: ThemeProvider` | All screens via `useTheme()` | `AsyncStorage[@subtick_theme_preference]` + Firestore `users/{uid}.themePreference` |
| Pre-compiled WebView CSS string | `ThemeContext.tsx: webViewCSS` computed in `useMemo` | `ReaderScreen.tsx` (initial load only — updates pushed via `injectJavaScript`) | Recomputed on theme change, never persisted |
| User profile (UserProfile \| null) | `UserContext.tsx: UserProvider` → `useUser()` | SettingsScreen, AccountScreen, DashboardStatsScreen, CategoryPreferencesScreen (all via `useUser()`) | Fetched once from Firestore on auth; re-fetched via `refreshProfile()` on demand |
| Safe area insets (top/bottom/left/right) | `App.tsx: SafeAreaProvider` | All 11 screens via `useSafeAreaInsets()` | Native OS values — dynamic per device |

### Local Component State
- `DashboardScreen.tsx`: `feedArticles: Article[]`, `userProfile: UserProfile | null`, `loading: boolean`, `sessionShownIds: Set<string>` (in-memory, resets on unmount). Uses `onSnapshot` listener for real-time stat updates (not `useUser()` — needs live sync). Focus listener only refetches when feed depleted (A5). Reader queue shuffled on tap (A5). Uses `insets.top` for header padding.
- `ReaderScreen.tsx` (orchestrator): Delegates state to feature hooks — `useArticleLoader` (article, resolvedHtml, fetchError, loading), `useNavigationQueue` (currentIndex, activeQueueIds, goToNext/Prev), `useReaderHUD` (hudVisible, isLiked, isSaved). Retains own `scrollProgress` state and PanResponder refs. Uses `insets.top` for HUD, `insets.bottom` for progress bar.
- `OnboardingScreen.tsx`: `chipStates: Record<string, ChipState>` — pure local, never synced until Continue is pressed. Uses shared `CategoryChipGrid`.
- `SettingsScreen.tsx`: Profile from `useUser()`. Refreshes on focus. Optimistically updates on changes.
- `AccountScreen.tsx`: Profile from `useUser()`. Covers Google link/unlink, sign out, reset, delete.
- `CategoryPreferencesScreen.tsx`: `selectedIds`, `notInterestedIds` derived from profile via `useUser()`. Auto-saves on tap via `updateCategoryWeights()` + `refreshProfile()`.
- `DashboardStatsScreen.tsx`: `selectedMetricIds` from profile via `useUser()`. Optimistic toggle + `setDoc` merge.
- `HistoryScreen.tsx` / `SavedReadsScreen.tsx`: 24-line wrappers — delegate all state to `ArticleListScreen`.

### On-Device State (AsyncStorage — primary store)
**Note:** `@subtick_seen_articles` IDs are also written to Firestore `users/{uid}.seenArticleIds` (via `arrayUnion`) for cross-device dedup.

| Key | Content | Max Size |
|---|---|---|
| `@subtick_seen_articles` | `string[]` of article IDs (also synced to Firestore `seenArticleIds`) | 1000 entries (oldest dropped) |
| `@subtick_seen_articles_meta` | `Record<string, {id,title,publicationName,category,estimatedReadMinutes}>` | Unbounded |
| `@subtick_saved_articles` | `string[]` of saved article IDs | Unbounded |
| `@subtick_saved_articles_meta` | `Record<string, ArticleMeta>` | Unbounded |
| `@subtick_saved_html_{articleId}` | Full sanitized HTML string for offline reading | One key per saved article |
| `@subtick_behavior_queue` | `PendingBehaviorEvent[]` pending sync | 500 max (oldest dropped first) |
| `@subtick_theme_preference` | `'system'|'light'|'dark'` | Tiny |
| `@subtick_app_instance_id` | `string` — stable GA4 client_id in dotted format (XXXXXXXXXX.XXXXXXXXXX) | ~21 chars |
| `@subtick_rss_failed_{articleId}` | `'1'` flag indicating this article's RSS feed has failed | One key per failed article |

### AsyncStorage Mutex (Concurrency Safety)
All AsyncStorage operations in `feedService.ts` and `behaviorSync.ts` involving read-modify-write are serialized through a **Promise chain mutex**, created via the shared factory in `src/services/asyncStorageMutex.ts`:

```typescript
// src/services/asyncStorageMutex.ts
import { createStorageMutex } from './asyncStorageMutex';
const storageMutex = createStorageMutex();

// Usage: storageMutex.enqueue(async () => { ... })
```

Each service creates its own independent queue — they intentionally do NOT share a queue because feeds and behavior events are separate domains and one slow domain should not block the other.

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

`trendingScore` is incremented when users engage with an article. It decays daily at **×0.9057** (halves every 7 days). The decay cron only processes articles with `trendingScore > 1.0` (raise from 0.1 to reduce write costs — C1 fix).

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

**peakTrendingScore:** All-time high, never decays. Updated in the same batch as trendingScore. Used by `cronCleanupOldArticles` for deletion ranking.

**Per-user per-article dedup:** In-batch `likeDedup` and `saveDedup` Sets.

### 2d. R — Recency [0, 1]

Source: `getRankedFeed.ts: normalizeR()`

Two-phase decay:
```typescript
if (daysOld <= 7):
    R = 1.0 - (daysOld / 7) × 0.2      // 1.0 → 0.8
else:
    R = 0.8 × (7 / daysOld)^1.5         // Power-law after day 7
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
// qualityScore clamped to [0.20, 1.00]
```

| Raw quality | Q |
|---|---|
| 0.20 (worst) | 0.00 |
| 0.80 (default new) | 0.75 |
| 1.00 (best) | 1.00 |

Quality increments (`syncBehaviorEvents.ts`):
```
save: +0.010 / like: +0.005 / read_thorough: +0.005 / read_skim: +0.001
swipe_not_interested: -0.010 / quick_exit: -0.005
```

### 2f. U — Diversity [0, 1]

```typescript
rawU = 1.0 - (min(1.0, (articlesInSamePub - 1) / 15) × 0.6)
U = (rawU - 0.4) / 0.6
```

| Articles from same publisher | U |
|---|---|
| 1 | 1.00 |
| 8 | 0.53 |
| 16+ | 0.00 |

### 2g. Scoring Formulas by Tranche

**High & Mid tranches (personalized):**
```
Score = 0.40×P + 0.15×T + 0.20×R + 0.15×Q + 0.10×U
```

**Low & Discovery tranches (merit-based):**
```
Score = 0.40×R + 0.30×T + 0.30×Q
```

Weights in `firebase/functions/src/constants.ts` (`SCORE_WEIGHTS` / `SCORE_WEIGHTS_MERIT`). Sum = 1.0. Output: [0, 1].

### 2h. Tranche Assembly

| Tranche | P threshold | Target | Selection (est.) | Selection (new, <30 reads) |
|---|---|---|---|---|
| High | P ≥ 0.40 | 12 | Random shuffle | Random shuffle |
| Mid | P ≥ 0.20 | 8 | Random shuffle | Random shuffle |
| Low | P ≥ 0.10 | 4 | Merit score DESC | Random shuffle |
| Discovery | P < 0.10 | 6 | Merit score DESC | Random shuffle |

Overflow cascades down. Final feed of 30 shuffled before return.

---

## 3. Weight Learning System

### 3a. Feedback Delta Multipliers (Δ)

Source: `firebase/functions/src/constants.ts` (server) and `src/utils/constants.ts` (client — identical values)

```typescript
save: +0.55 / like: +0.40 / read_thorough: +0.30 / read_skim: +0.10
read_shallow: 0.00 / swipe_next: 0.00
quick_exit: -0.20 / swipe_not_interested: -0.40
```

### 3b. Dimension-Specific Learning Rates

```typescript
categoryL  = 0.08  // LEARNING_RATE × 1.0
lengthL    = 0.12  // LEARNING_RATE × 1.5
publisherL = 0.16  // LEARNING_RATE × 2.0
```

Each event updates three dimensions: `category += Δ × 0.08`, `length += Δ × 0.12`, `publisher += Δ × 0.16`.

### 3c. Watermark-Based Event Processing

`updateWeights()` uses `weightUpdatedAt` watermark to process only new events. No replay. Daily decay applied if ≥23h since last update.

### 3d. Clamping

`weight = max(0.1, min(5.0, weight))`

### 3e. Daily Decay

`decayed[cat] = 1.0 + (weight - 1.0) × 0.995` — weights drift toward neutral (1.0) at 0.5% per day.

### 3f. UI Sync Thresholds

- `weight <= 0.2` → add to `notInterestedCategoryIds`
- `weight >= 1.5` → add to `selectedCategoryIds`
- `0.2 < weight < 1.5` (if was notInterested) → remove from `notInterestedCategoryIds`

---

## 4. Behavior Event Classification

Source: `useBehaviorTracker.ts: concludeSession()`

```
if (scrollDepth < 0.2 AND sessionDuration < 15s) → 'quick_exit'
else if (scrollDepth >= 0.8):
    if (sessionDuration >= expectedReadTime × 0.7) → 'read_thorough'
    else → 'read_skim'
else if (scrollDepth >= 0.4) → 'read_shallow'
else → 'swipe_next'
```

Right-swipe always emits `'swipe_not_interested'` (fires immediately, not via `concludeSession`).

**Quick-exit double-fire prevention (B2 fix):** Shared `sessionSnapshotRef` — `concludeSession()` sets `concluded = true`; cleanup reads live value.

**Tracking disabled** in `'history'`, `'saved'`, and mock/sandbox modes.

---

## 5. Async / Failure Handling

### RSS Collector
| Operation | Timeout | Failure |
|---|---|---|
| `parser.parseURL()` | 15s | Caught per-feed; other feeds continue |
| `fetchOgMetadata()` | 6s | Returns `{}`; article written without image/description |
| Feed batches | `Promise.allSettled()` | One feed failure never blocks others |
| Article existence check | — | Single `db.getAll()` batch per feed (C3) |

### Client RSS Fetch
| Operation | Timeout | Failure |
|---|---|---|
| `fetch(feedUrl)` | 15s (AbortController) | Throws; `feedSessionCache.delete(feedUrl)` for retry |
| Article not found in feed | — | `markRssFailed(id)` in AsyncStorage; renders as archived |
| HTML sanitization | — | Only the matched article (C6 — lazy sanitize) |

### getRankedFeed Cloud Function
| Operation | Failure |
|---|---|
| `system/candidatePool` read | Falls back to on-the-fly stratified query |
| Publisher quality fetch | Returns expired/empty cache; falls back to `article.qualityScore` |

### Client getRankedFeed Call
| Failure | Fallback |
|---|---|
| Cloud Function call fails | `fallbackGetArticles()`: Firestore `WHERE isPaywalled == false ORDER BY publishDate DESC LIMIT 90` |

### Behavior Sync
| Scenario | Behavior |
|---|---|
| No network | Events remain in `@subtick_behavior_queue` |
| Network restored | `offlineManager.ts` fires `attemptFlush()` |
| Sync fails | 30s cooldown (`RETRY_COOLDOWN_MS`), then retry |
| Concurrent flush | `isSyncing` guard prevents double-flush |
| Queue overflow | 500 cap; oldest events dropped |
| Server input cap | 50 events max per call (A4 fix) |
| Synced events cleanup | Pruned after 5 min if `synced: true` |
| Concurrent queue + flush | Both use `enqueueStorageOperation` mutex; network outside mutex (B6) |

### Sign-Out / Fresh Session
| Scenario | Behavior |
|---|---|
| Sign Out | `clearAllLocalData()` → `signOut(auth)` → `signInAnonymouslyIfNeeded()` → `ensureUserProfile()` |
| Stale profile not found | Dashboard's `loadData()` detects null → redirects to Onboarding |

### WebView Navigation Lock
**HUD Visibility:** HUD starts hidden (`useState(false)`). Appears only on scroll-up (`scrollTop < lastScrollTop - 15` in injected JS). Title shown with `ellipsizeMode="tail"` truncation (A5). Hidden on initial page load. Tap toggles; auto-hides after 2.5s.

- **Sanitized HTML mode:** Any `http` link click → `Linking.openURL(url); return false`
- **Raw URI (archived) mode:** Same-domain navigations allowed; cross-domain → OS browser.
- HTTP errors (≥400) or load errors → error UI with "Open in Browser" button.

### Progress Bar
Plain React state (`useState(scrollProgress)`) with a `View` (not `Animated.View`):
- `width: \`${Math.round(scrollProgress * 100)}%\`` — Fabric-safe (no `AnimatedInterpolation`)
- Uses `colors.accent` fill; `borderRadius: 3`; positioned at `bottom: insets.bottom`
- Driven by WebView `postMessage` → `setScrollProgress()` in `onMessage`

### Fabric Crash Fix — `cardStyleInterpolator` → `presentation: 'modal'`
Source: `RootNavigator.tsx`

Fabric's debug-mode `overridePropsReadableMap` assertion gate rejects `AnimatedInterpolation` objects passed as props. The fix replaces JS-driven transition animations with native `presentation: 'modal'` transitions that bypass Fabric's prop validation entirely.

**Before (crashing in debug):**
```tsx
cardStyleInterpolator: ({ current, layouts }) => ({
  cardStyle: {
    transform: [{
      translateY: current.progress.interpolate({
        inputRange: [0, 1],
        outputRange: [layouts.screen.height, 0],
      }),
    }],
  },
}),
```

**After (fixed):**
```tsx
presentation: 'modal',
```

Release builds strip Fabric's assertion gates, so the crash never occurred in production APKs. Only debug-mode dev clients and Expo Go were affected.

---

## 6. Functions with Legal / Compliance Significance

> ⚠️ **Do not modify these without understanding the implications.**

### Paywall Detection — `checkIsPaywalled()` (`rssCollector.ts`)
Three mechanisms: keyword match (24 phrases), CSS class patterns, script patterns. Paywalled articles excluded from all candidate pools.

### `isTruncatedFeed` Flag (`rssCollector.ts`)
```typescript
const isTruncatedFeed = bodyHtml.length > 0 && (description.length / bodyHtml.length) > 0.9;
```
Used in `weightUpdater.ts` to skip WPM calibration for truncated feeds. Removing this guard corrupts `averageWpm`.

### Article ID Generation — `generateArticleId()` (`rssCollector.ts`)
```typescript
const hash = createHash('sha256').update(`${url}::${title}`).digest('hex');
return `article_${hash.substring(0, 16)}`;
```
Sole deduplication mechanism. Format must remain stable across deployments.

### `rssStatus` Lifecycle
- `'current'`: Reader fetches live RSS content
- `'archived'`: Reader loads `publicationUrl` directly as a full webpage
- Client sets `@subtick_rss_failed_{id}` in AsyncStorage when live RSS fetch fails

### `deleteOrphanProfile` Cloud Function (`firebase/functions/src/index.ts`)
```typescript
export const deleteOrphanProfile = onCall(async (request) => {
  // Validates: caller authenticated, orphanUid provided, orphanUid ≠ caller's own UID
  // Uses Admin SDK db.doc(`users/${orphanUid}`).delete() to bypass rules
  // Returns { success: true, deleted: orphanUid } or { alreadyGone: true }
});
```
Exists because Firestore rules have `allow delete: if false` on `users/{userId}`. Client-side `deleteDoc()` is blocked. The function validates caller authentication for rate-limiting but does NOT require ownership of the orphan document.
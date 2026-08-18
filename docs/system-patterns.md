# Tangent — System Patterns

> **Last verified:** 17 August 2026 (audit hardening, reliable onboarding/startup flow, sequential Reader prefetch, rolling dashboard statistics, and highest-scoring opening-card update).
> All values, formulas, and constants are pulled directly from source code — no estimates.

---

## 1. State Management

### Global State (React Context)
| State | Provider | Consumers | Persistence |
|---|---|---|---|
| Theme (light/dark/system) + computed color palette | `ThemeContext.tsx: ThemeProvider` | All screens via `useTheme()` | `AsyncStorage[@subtick_theme_preference]` + Firestore `users/{uid}.themePreference` |
| Pre-compiled WebView CSS string | `ThemeContext.tsx: webViewCSS` computed in `useMemo` | `ReaderScreen.tsx` (initial load only — updates pushed via `injectJavaScript`) | Recomputed on theme change, never persisted |
| User profile (UserProfile \| null) + rolling weekly read count | `UserContext.tsx: UserProvider` → `useUser()` | Dashboard, SettingsScreen, AccountScreen, DashboardStatsScreen, CategoryPreferencesScreen, ReaderScreen | One authenticated Firestore profile listener; a separate owner-scoped seven-day behavior-event listener supplies the live weekly count. Every auth change clears the preceding profile/count before attaching new listeners. `refreshProfile()` remains available for explicit recovery. |
| Safe area insets (top/bottom) | Manual constants `src/utils/safeArea.ts` | All 11 screens via `topInset` / `bottomInset` (avoids `react-native-safe-area-context` Fabric crash on RN 0.86) | Hardcoded per-platform values |

### Local Component State
- `DashboardScreen.tsx`: `feedArticles: Article[]`, `loading: boolean`, `sessionShownIds: Set<string>` (in-memory, resets on unmount). Receives the shared live profile and rolling weekly count from `useUser()`; it has no separate profile listener. Its active cards and shown IDs are mirrored into a UID-scoped memory cache, so a remount restores the same feed instead of fetching replacements. While Reader is open, each genuinely opened article is removed from that cache and replacements append behind unread cards; ordinary navigation never rearranges unread cards. Reader queue is shuffled on tap (A5). Uses `topInset` for header padding.
- `ReaderScreen.tsx` (orchestrator): Delegates state to feature hooks — `useArticleLoader` (article, resolved HTML, RSS-unavailable state, loading), `useNavigationQueue` (currentIndex, activeQueueIds, goToNext/Prev), `useReaderHUD` (hudVisible, isLiked, isSaved). On Android, its local Expo module streams RSS/Atom feeds outside the Reader JavaScript/UI workload. One serial lane serves the article the person selected; at most two bounded workers serve speculative lookahead, so active reading never waits behind an unrelated future preload and one slow publisher does not block every later target. It targets a rolling five upcoming articles: 2–6 are requested while 1 is open; every advance adds one new sixth target. The module retains at most 16 ordinary-sized raw XML feeds in process memory (5 MB cache allowance each) and a five-entry extracted-body cache for the five upcoming Reader targets. The Dashboard-tapped/current and already shown articles are fixed. Preparation completion never changes visible queue order: Reader advances through the ranked queue sequentially. If a future lookahead connection/feed request fails before display, that future card is removed only from the active Reader session and mounted Dashboard cache; it is not written to History or persistent seen state, so a later session can retry. A selected/current article remains exact and retryable. For one exact article key, active loading and lookahead share one native in-flight operation. This is crucial for a large feed that cannot be retained as raw XML: reaching an article already being prepared joins the existing scan instead of opening a second download. When an article becomes current, its prepared body is consumed and one newly exposed future target is added. It never extracts unrelated entries from a publisher feed. Larger legitimate feeds are stream-parsed only to the requested target and are not retained. A genuine swipe change lets only already-running native work finish, then replaces stale queued targets with the latest buffer; a harmless readiness reorder does not restart the same five targets. JavaScript receives and sanitises only the displayed article; cleaned HTML is never prefetched. Valid edge swipes require direction/distance; an intentional finger pause longer than 200 ms before release cancels the gesture without navigation or behaviour recording. Each new request immediately unmounts the previous native WebView and shows an opaque theme surface; a small spinner appears on that surface only after 180 ms. This prevents a native publisher page from flashing beneath a loader, and generation IDs prevent stale rapid-swipe loads from replacing the latest article. Behavior events are queued locally during reading and backend sync is deferred until Reader exit/reconnect/lifecycle work. iOS/currently unrebuilt development APKs use the JavaScript fallback. An unavailable live-RSS item silently advances when raw archived pages are disabled. Its guarded finish path intercepts all normal removals (HUD close, Android/system back, queue-exhausted return), writes History once and exits immediately while behavior sync continues in the background. Retains own `scrollProgress` state and PanResponder refs. Uses `topInset` for HUD, `bottomInset` for progress bar.
- `OnboardingScreen.tsx`: `chipStates: Record<string, ChipState>` remains local until Continue/Skip. It writes onboarding completion directly, disables duplicate taps while saving, and only navigates after the write succeeds. Uses shared `CategoryChipGrid`.
- `SettingsScreen.tsx`: Profile from `useUser()` and no longer forces a focus-time profile refresh. It keeps ScreenHeader and the themed shell mounted while profile data settles, showing only an inline spinner. Its Archived Articles preference uses the reusable `TangentToggle`: local value moves immediately, control disables during the Firestore write, and it restores the prior value on failure.
- `AccountScreen.tsx`: Profile from `useUser()`. Covers Google link/unlink, sign out, reset, delete. The latter three use the application-level account-transition coordinator; root navigation remounts at Onboarding after the fresh/reset profile is ready.
- `CategoryPreferencesScreen.tsx`: `selectedIds`, `notInterestedIds` derived from profile via `useUser()`. Auto-saves on tap via `updateCategoryWeights()` + `refreshProfile()`.
- `DashboardStatsScreen.tsx`: `selectedMetricIds` from profile via `useUser()`. Optimistic toggle + `setDoc` merge. It deliberately follows CategoryChipGrid's whole-row state language—selected/full-row inversion and an explicit state label—while retaining its distinct maximum-three multi-select behaviour.
- `HistoryScreen.tsx` / `SavedReadsScreen.tsx`: 24-line wrappers — delegate all state to `ArticleListScreen`.
- `FeedbackScreen.tsx` / `FeedRequestScreen.tsx`: Thin wrappers — delegate shell (header, subtitle, submit button, spinner) to shared `FormScreen` component.

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
| `@subtick_rss_failed_{articleId}` | `'1'` flag indicating this article could not be fetched/found in live RSS; Reader skips it when archived pages are disabled | One key per failed article |

### AsyncStorage Mutex (Concurrency Safety)
All AsyncStorage operations in `feedService.ts` and `behaviorSync.ts` involving read-modify-write are serialized through a **Promise chain mutex**, created via the shared factory in `src/services/asyncStorageMutex.ts`:

```typescript
// src/services/asyncStorageMutex.ts
import { createStorageMutex } from './asyncStorageMutex';
const storageMutex = createStorageMutex();

// Usage: storageMutex.enqueue(async () => { ... })
```

Each service creates its own independent queue — they intentionally do NOT share a queue because feeds and behavior events are separate domains and one slow domain should not block the other.

`feedService.ts` uses this for: `markArticleSeen`, `markArticleSaved`, `unmarkArticleSaved`, `getSeenArticleIdsLocally`, `getSavedArticleIds`.

`behaviorSync.ts` uses this for: `queueBehaviorEvent` (the queue append) and both the read-step and write-back-step of `flushBehaviorQueue`. The network upload itself runs *outside* the mutex so new events can be queued while an upload is in progress (B6 fix).

---

## 2. The Ranking / Scoring Algorithm

### 1b. Recommendation Attribution and Personalization Health

Every normal ranked-feed response receives a server-generated `feedId`, and every returned article receives an `impressionId` (`feedId:position`). This context is transient: it is returned to the phone, preserved while the Reader moves through its queue, and sent with the later read/Like/Save/Not Interested telemetry. It is never persisted on the global article document.

`article_shown` captures the exact ranking context: feed/impression ID, position, tranche, score components, a reporting-only user stage, prior qualifying reads, days since the prior qualifying read, profile concentration, and unknown-publisher/category discovery flags. `feed_generated` carries the feed-level snapshot. Subsequent behavior events carry the same IDs.

The backend adds `analytics_environment` to every Measurement Protocol event. It is server-derived (`production` or `emulator`), so launch reporting can exclude test traffic without trusting a phone/browser value. The reporting source and Looker instructions live in [`analytics-looker-guide.md`](./analytics-looker-guide.md); its canonical BigQuery view SQL is `firebase/analytics/create_personalization_health_view.sql`.

### 2a. Component Normalization

**All 4 scoring components output values in [0, 1].** This ensures the formula weights mean exactly what they say. Diversity is enforced by a hard per‑publisher cap (5) during feed assembly, not as a scoring component.

### 2b. P — Personalization [0, 1]

Source: `getRankedFeed.ts: normalizeP()`

```typescript
const MIN_W = 0.1, MAX_W = 5.0, RANGE = 4.9;
catFraction = (categoryWeight - MIN_W) / RANGE
pubFraction = (publisherWeight - MIN_W) / RANGE
P = catFraction × categoryShare + pubFraction × publisherShare
```

For a publisher with **any stored interaction history**, category gets 60% of P and publisher gets 40%.

For a publisher with **no stored publisher weight at all**, the configurable cold-start shares apply: category 90%, publisher 10% by default. The two cold-start shares are normalized to total 1.0 when config is loaded. Presence—not whether the stored publisher weight is positive—is what makes a publisher known. Thus a publisher with a recorded negative weight remains known and receives the normal 60/40 calculation.

| Situation | Publisher history? | catWeight | pubWeight | P |
|---|---|---:|---:|---:|
| New user (neutral) | No | 1.0 | 1.0 | ≈ 0.18 |
| Likes category | No | 3.0 | 1.0 | ≈ 0.55 |
| Likes category | Yes | 3.0 | 1.0 | ≈ 0.43 |
| Loves both | Yes | 4.5 | 3.5 | ≈ 0.82 |
| Hates category | Yes | 0.1 | 1.0 | ≈ 0.07 |
| Maximum | Yes | 5.0 | 5.0 | 1.00 |

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

**peakTrendingScore:** All-time high, never decays. Updated in the same batch as trendingScore. Used by `cronCleanupOldArticles` for deletion ranking (now via sampled query — 500 worst-scoring candidates, composite index on `publishDate` + `peakTrendingScore`).

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

### 2f. Diversity — Publisher Cap and Topic Anti-Fatigue

Diversity is not a scoring component. A hard per-publisher cap of **5 articles** is enforced during selection in `assembleFeedWithTranches()`. A configurable `maxArticlesPerCategory` limit is also applied during selection. Both limits relax only when the remaining eligible candidate pool cannot otherwise fill the requested feed.

After normal selection, the backend attempts to meet configurable `minDistinctCategories`: it replaces the weakest removable article from an overrepresented category with the strongest unseen candidate from a missing category, provided that candidate respects the publisher cap. The reserved startup anchor is never replaced. After selection, the remaining feed is passed through `interleaveArticlesByCategory()`. It will not place a third consecutive card from the same category if any other category remains. The reserved highest-scoring article is then moved to position 0; all other cards retain their category-varied order. These safeguards change membership/display order only: scoring formulas, tranches, and publisher-cap rules remain intact.

### 2g. Scoring Formulas by Tranche

**High & Mid tranches (personalized):**
```
fullScore = 0.60×P + 0.15×T + 0.10×R + 0.15×Q
```

**Tail tranche (trending + recency only):**
```
tailScore = 0.43×T + 0.57×R
```

Weights in `firebase/functions/src/constants.ts` (`SCORE_WEIGHTS` / `SCORE_WEIGHTS_TAIL`). Sum = 1.0. Output: [0, 1].

### 2h. Tranche Assembly

Articles are scored with the 4-component `fullScore` and then bucketed:

| Tranche | fullScore threshold | Target | Selection |
|---|---|---|---|
| High | > 0.40 | 12 | Random selection after any global startup anchor is reserved, max 5 per publisher |
| Mid | > 0.20 | 8 | Random selection after any global startup anchor is reserved, max 5 per publisher |
| Tail | ≤ 0.20 | 10 | Sorted by tailScore (T+R) after any global startup anchor is reserved, max 5 per publisher; randomized for users with <30 reads |

Overflow cascades down. The highest eligible article, whether it falls in High, Mid, or Tail, is reserved in its normal tranche allocation and returned at position 0 for the Dashboard hero; the other selected cards retain their randomized/category-varied order. Bucketing is by the full 4-component score, not P alone.

### 2i. Deferred Personalization Designs

**Short-term session mood:** A future, bounded recent-behavior signal may influence only the next generated feed. It must not reorder the current Reader queue, overwrite durable weights, or introduce duplicate feedback-strength controls.

**Lightweight personalized fallback:** When the ranked-feed callable is unavailable, a future client fallback may combine unseen filtering, local category preferences, basic variety limits, and recency tie-breaking. It must remain a safety net rather than a duplicate on-device ranking engine.

### 2j. Cleanup Cron (Cost-Capped)

The `cronCleanupOldArticles` runs every 72 hours and uses a **sampled query** with a fixed 500-read ceiling:

```
1. Delete ALL paywalled articles.
2. Query articles WHERE publishDate < 90 days ago
   ORDER BY peakTrendingScore ASC LIMIT 500
   → Delete bottom 3% of the sample (worst ~15 articles).
```

This uses a composite index (`publishDate` ASC + `peakTrendingScore` ASC) and never reads the full articles collection. Cost is constant regardless of database size.

---

## 3. Weight Learning System

### 3a. Feedback Delta Multipliers (Δ)

Source: `firebase/functions/src/constants.ts` (server) and `src/utils/constants.ts` (client — identical values)

```typescript
save: +0.55 / like: +0.40 / read_thorough: +0.30 / read_skim: +0.10
read_shallow: 0.00 / swipe_next: 0.00
quick_exit: 0.00 / swipe_not_interested: -0.40
```

### 3b. Dimension-Specific Learning Rates

```typescript
categoryL  = 0.08  // LEARNING_RATE × 1.0
lengthL    = 0.12  // LEARNING_RATE × 1.5
publisherL = 0.16  // LEARNING_RATE × 2.0
```

Each event updates three dimensions: `category += Δ × 0.08`, `length += Δ × 0.12`, `publisher += Δ × 0.16`.

### 3c. Watermark-Based Event Processing

`updateWeights()` uses `weightUpdatedAt` to process only new events, with no replay. Preference aging uses its separate `weightsDecayedAt` timestamp.

### 3d. Clamping

`weight = max(0.1, min(5.0, weight))`

### 3e. Time-Accurate Daily Decay

`decayedWeight = 1.0 + (weight - 1.0) × dailyDecayRate^elapsedFullDays` — category, category+length, and publisher weights drift toward neutral (1.0) at the configured daily rate for every full day since the last decay. `weightsDecayedAt` is separate from the event watermark so a long inactive period cannot be mistaken for only one day of decay.

### 3f. Repeated Quick-Exit Evidence

A single `quick_exit` remains neutral for personal preference learning. The backend stores recent distinct quick-exit article IDs by category only. If the number within `learning.repeatedQuickExitLookbackDays` reaches `learning.repeatedQuickExitThreshold`, it applies `feedback.quick_exit × category learning rate` **once** to that top-level category and clears the pending evidence. It never changes publisher or category+length weights. A `read_thorough`, `read_skim`, Like, or Save in that category clears pending evidence before inference.

### 3g. WPM Calibration and Read-Time Estimates

New user profiles begin at `averageWpm = 200`. On every Reader exit with positive word count and positive active foreground time, the app uses the live WebView word count when available and otherwise the stored article count.

```text
sessionWpm = wordCount / (sessionDurationMs / 60,000)
newAverageWpm = round(oldAverageWpm × 0.80 + sessionWpm × 0.20)
```

WPM is independent of scroll depth and server read classification. `averageWpm` drives the live Dashboard and Reader `min read` estimate: `max(1, ceil(wordCount / averageWpm))`. Stored article `estimatedReadMinutes` remains a separate ingestion-time generic estimate using fixed 250 WPM, primarily retained in saved/history metadata.

### 3h. UI Sync Thresholds

- `weight <= 0.2` → add to `notInterestedCategoryIds`
- `weight >= 1.5` → add to `selectedCategoryIds`
- `0.2 < weight < 1.5` (if was notInterested) → remove from `notInterestedCategoryIds`

---


### 3h. Behavior Event Pipeline (syncBehaviorEvents)

The syncBehaviorEvents Cloud Function handles batched behavior events from the client, updates trending scores, publisher quality, and triggers weight updates. Two critical fixes were applied:

**1. FieldValue.increment replaced with absolute writes**
The emulator's stubbed irebase-admin does not implement FieldValue.increment(). The original code used dmin.firestore.FieldValue.increment(netDelta) which threw TypeError: Cannot read properties of undefined (reading 'increment'). Fixed by computing absolute values:

`	ypescript
trendingScore: (initial?.trendingScore ?? 0) + netDelta
qualityScore: (existingQuality ?? DEFAULT) + netDelta
`

**2. Missing articles skipped to prevent batch failure**
The batch atch.update(articleRef, ...) threw NOT_FOUND if an event referenced an article that no longer exists (e.g., cleaned up). Fixed by checking rticleInitialScores and skipping missing articles:

`	ypescript
const initial = articleInitialScores[artId];
if (!initial) { console.warn(...); continue; }
`

These fixes ensure the weight update pipeline works reliably in the emulator and is resilient to data drift in production.

---

## 4. Behavior Event Classification

Source: client `useBehaviorTracker.ts` plus server `syncBehaviorEvents.ts` / `scoringConfig.ts`.

The client is a sensor: on normal next swipe or unfinished Reader cleanup it sends a raw `'read_session'` containing foreground-active duration, maximum scroll depth, and the latest rendered word count when available. It does not decide whether the read was a skim or thorough. `useBehaviorTracker.ts` listens to React Native `AppState`: it pauses timing on `inactive` or `background` and resumes on `active`. Thus app switching, locking, calls, and multitasking time are excluded, including if Reader cleanup occurs while still paused.

The backend validates the telemetry, loads the active `system/scoringConfig` and the authenticated user's server-owned `averageWpm` once per batch, then stores one final type:

```
if (scrollDepth < quickExitDepth AND duration < quickExitTimeoutSec) → 'quick_exit'
else if (scrollDepth >= thoroughDepth):
    expectedTime = actualWordCount / userWpm
    if (duration >= expectedTime × thoroughTimeFraction) → 'read_thorough'
    else → 'read_skim'
else if (scrollDepth >= shallowDepth) → 'read_shallow'
else → 'swipe_next'
```

The default thresholds are 0.20 depth / 15 seconds for quick exit, 0.70 depth plus 60% of expected time for thorough, and 0.40 depth for shallow. The backend uses 200 WPM only if the profile has no valid `averageWpm`. If no positive live word count was captured, expected time is treated as unavailable and a deep session is classified as `read_thorough`; WPM calibration later attempts a safe stored article-count fallback. The config is cached for about 60 seconds per warm Function instance, so a Dashboard change is near-real-time rather than globally instantaneous.

Legacy client read-family labels are also reclassified during rollout. Right-swipe `'swipe_not_interested'` and explicit Like/Unlike/Save/Unsave events are never reclassified.

**Duplicate prevention:** `sessionSnapshotRef` marks a concluded session so cleanup does not emit a second raw session. Tracking remains disabled in `'history'`, `'saved'`, and mock/sandbox modes.

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
| Confirmed article absent from a successfully loaded feed | — | Reader remembers the absence for this session only. With Archived Articles on, it may use the publication webpage; off, it silently marks the item seen and advances. Temporary network/native/timeout errors are not persisted and show retryable error UI. |
| HTML sanitization | — | Only the article currently being displayed is sanitized (C6 — lazy sanitize). Background work retains raw parsed RSS only, not cleaned article HTML. |

### getRankedFeed Cloud Function
| Operation | Failure |
|---|---|
| `system/candidatePool` read | Falls back to an on-the-fly stratified query; when archived content is off, it accepts only `rssStatus == 'current'` and populates only the current-only cache |
| Candidate-pool data is stale/misclassified | Final feed filter removes non-current records whenever archived content is off |
| Publisher quality fetch | Returns expired/empty cache; falls back to `article.qualityScore` |

### Client getRankedFeed Call
| Failure | Fallback |
|---|---|
| Cloud Function call fails | `fallbackGetArticles()` reads the authenticated user's archived-content preference. Off: Firestore `WHERE isPaywalled == false AND rssStatus == 'current' ORDER BY publishDate DESC LIMIT 90`; on: the same query without the status restriction |

### Behavior Sync
| Scenario | Behavior |
|---|---|
| No network | Events remain in `@subtick_behavior_queue` |
| Network restored | `offlineManager.ts` fires `attemptFlush()` |
| Sync fails | 30s cooldown (`RETRY_COOLDOWN_MS`), then retry |
| Concurrent flush | All callers share `behaviorSync.ts`'s module-level in-progress upload promise, so the same unsynced batch is sent once; `offlineManager.ts` also avoids duplicate reconnect attempts |
| Queue overflow | 500 cap; oldest events dropped |
| Server input cap | 100 events max per call; malformed telemetry is rejected before persistence |
| Normal Reader exit | HUD close, Android/system back, and queue-exhausted return share a guarded path: await local raw-session queue write, write History, apply provisional default-rule metrics, then immediately attempt normal authenticated flush. The next profile update replaces the estimate with authoritative backend classification. |
| Synced events cleanup | Pruned after 5 min if `synced: true` |
| Concurrent queue + flush | Both use `enqueueStorageOperation` mutex; network outside mutex (B6) |

### Sign-Out / Fresh Session
| Scenario | Behavior |
|---|---|
| Sign Out | `clearAllLocalData()` → `signOut(auth)` → `signInAnonymouslyIfNeeded()` → `ensureUserProfile()` |
| Stale profile not found | Dashboard's `loadData()` detects null → redirects to Onboarding |

### WebView Navigation Lock
**Opaque Reader states:** Clean RSS WebViews use the theme background rather than transparency. Loading, RSS-unavailable, slow-loading, and error states also paint a solid theme background; on Android this prevents a previously mounted native WebView/page from appearing underneath a spinner or error view.

**HUD Visibility:** HUD starts hidden (`useState(false)`). Appears only on scroll-up (`scrollTop < lastScrollTop - 15` in injected JS). Title shown with `ellipsizeMode="tail"` truncation (A5). Hidden on initial page load. Tap toggles; auto-hides after 2.5s.

- **Sanitized HTML mode:** Any `http` link click → `Linking.openURL(url); return false`
- **Raw URI (archived) mode:** Same-domain navigations allowed; cross-domain → OS browser.
- HTTP errors (≥400) or load errors in an allowed raw archived webpage → error UI with "Open in Browser" button. This path is unavailable when Archived Articles is off.

### Progress Bar
Plain React state (`useState(scrollProgress)`) with a `View` (not `Animated.View`):
- `width: \`${Math.round(scrollProgress * 100)}%\`` — Fabric-safe (no `AnimatedInterpolation`)
- Uses `colors.accent` fill; `borderRadius: 3`; positioned at `bottom: bottomInset`
- Driven by WebView `postMessage` → `setScrollProgress()` in `onMessage`

### Reader Swipe-Back Gesture
The Reader screen has `gestureEnabled: true` in `RootNavigator.tsx`. This enables the standard horizontal edge-swipe-to-go-back gesture provided by React Navigation. It does NOT conflict with the Reader's internal vertical article-swiping (handled by PanResponder edge zones) because the navigation gesture is horizontal and the Reader's article swipes are vertical. The `presentation: 'modal'` animation is native and bypasses Fabric's prop validation.

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
Retained as article-ingestion metadata. WPM calibration now uses the Reader's live rendered word count when available and otherwise the stored count by product decision; it is no longer skipped solely because this flag is set.

### Article ID Generation — `generateArticleId()` (`rssCollector.ts`)
```typescript
const hash = createHash('sha256').update(`${url}::${title}`).digest('hex');
return `article_${hash.substring(0, 16)}`;
```
Sole deduplication mechanism. Format must remain stable across deployments.

### `rssStatus` Lifecycle
- `'current'`: Reader fetches live RSS content
- `'archived'`: Reader loads `publicationUrl` directly as a full webpage
- Client sets `@subtick_rss_failed_{id}` in AsyncStorage when live RSS fetch/matching fails; with archived pages disabled, Reader silently skips that item

### `deleteOrphanProfile` Cloud Function (`firebase/functions/src/index.ts`)

The callable deletes a stale anonymous `users/{orphanUid}` Firestore profile after
Google credential recovery. It validates caller authentication and rejects a
request to delete the caller's own profile, but it does not verify ownership of the
supplied orphan UID. This known authorization risk is deliberately deferred in
`docs/audit-backlog.md`.





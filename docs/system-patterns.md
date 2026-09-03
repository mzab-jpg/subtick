# Tangent — System Patterns

> **Last verified:** 26 August 2026 (attention-factor engagement model, body-relative scroll measurement, WPM plausibility guards, geometry-only classification, stats-spec, scroll/speed-band audit fixes).
> All values, formulas, and constants are pulled directly from source code — no estimates.

---

## 1. State Management

### Global State (React Context)
| State | Provider | Consumers | Persistence |
|---|---|---|---|
| Theme (light/dark/system) + computed color palette | `ThemeContext.tsx: ThemeProvider` | All screens via `useTheme()` | `AsyncStorage[@subtick_theme_preference]` + Firestore `users/{uid}.themePreference` |
| Pre-compiled WebView CSS string | `ThemeContext.tsx: webViewCSS` computed in `useMemo` | `ReaderScreen.tsx` (initial load only — updates pushed via `injectJavaScript`) | Recomputed on theme change, never persisted |
| User profile (UserProfile \| null) + rolling weekly read count | `UserContext.tsx: UserProvider` → `useUser()` | Dashboard, SettingsScreen, AccountScreen, DashboardStatsScreen, CategoryPreferencesScreen, ReaderScreen | One authenticated Firestore profile listener; a separate owner-scoped seven-day behavior-event listener supplies the live weekly count. Every auth change clears the preceding profile/count before attaching new listeners. Each confirmed profile also refreshes a UID-bound local startup-route snapshot; `refreshProfile()` remains available for explicit recovery. |
| Safe area insets (top/bottom) | Manual constants `src/utils/safeArea.ts` | All 11 screens via `topInset` / `bottomInset` (avoids `react-native-safe-area-context` Fabric crash on RN 0.86) | Hardcoded per-platform values |

### Local Component State
- `StartupScreen.tsx`: Shown only during React-level application initialization or an account transition, after the native Android splash. It uses the same top-left, system-font `TANGENT` title styling as Home and types lowercase `sapere aude` using the selected sequence: cursor-only for 600 ms, 180 ms letters inside each word, a 400 ms blinking pause between `sapere` and `aude`, then an 850 ms completed-phrase hold. Its cursor uses a 500 ms half-cycle. Its completion callback is held separately so parent renders cannot restart typing midway. It declaratively hides the Android status bar while mounted; the normal ThemeContext status bar returns on unmount. This prevents a startup-to-Home loading flash. Account transitions display `Preparing your new account…` rather than the motto.
- `LoadingCursor.tsx` / `HomeLoadingState.tsx`: Shared top-left waiting treatment. It shows exactly red `Loading|` in the app system font on Home when no cards are locally available and on Reader’s existing opaque article-loading surface, replacing those generic circles without changing error states or allowing publisher-page flashes.
- `DashboardScreen.tsx`: `feedArticles: Article[]`, `loading: boolean`, `sessionShownIds: Set<string>` (in-memory, resets on unmount). Receives the shared live profile and rolling weekly count from `useUser()`; it has no separate profile listener. Active cards/shown IDs are mirrored into a UID-scoped memory cache and a 24-hour non-sensitive AsyncStorage cache. After Firebase restores the exact UID, Dashboard filters local seen IDs and renders cached cards immediately—even while the profile/stat listener is still verifying—because profile readiness is not content readiness. Its neutral three-part stats-pill placeholder reserves the final vertical space until verified metric values arrive, preventing a later layout jump. Verification and a fresh feed run in the background; fresh results are staged for the next launch rather than replacing current cards. While Reader is open, each genuinely opened article is removed and replacements append behind unread cards; ordinary navigation never rearranges unread cards. Reader queue is shuffled on tap (A5). Uses `topInset` for header padding.
- `ReaderScreen.tsx` (orchestrator): Delegates state to feature hooks — `useArticleLoader` (article, resolved HTML, RSS-unavailable state, loading), `useNavigationQueue` (currentIndex, activeQueueIds, goToNext/Prev), `useReaderHUD` (hudVisible, isLiked, isSaved). A stationary in-content WebView double tap excludes scrolls and links, then reuses the same normal like/unlike action as the HUD button, explicitly shows the HUD, and briefly native-pulses its theme-aware heart confirmation. On Android, its local Expo module streams RSS/Atom feeds outside the Reader JavaScript/UI workload. One serial lane serves the article the person selected; at most two bounded workers serve speculative lookahead, so active reading never waits behind an unrelated future preload and one slow publisher does not block every later target. It targets a rolling five upcoming articles: 2–6 are requested while 1 is open; every advance adds one new sixth target. The module retains at most 16 ordinary-sized raw XML feeds in process memory (5 MB cache allowance each) and a five-entry extracted-body cache for the five upcoming Reader targets. The Dashboard-tapped/current and already shown articles are fixed. Preparation completion never changes visible queue order: Reader advances through the ranked queue sequentially. If a future lookahead connection/feed request fails before display, that future card is removed only from the active Reader session and mounted Dashboard cache; it is not written to History or persistent seen state, so a later session can retry. A selected/current article remains exact and retryable. For one exact article key, active loading and lookahead share one native in-flight operation. This is crucial for a large feed that cannot be retained as raw XML: reaching an article already being prepared joins the existing scan instead of opening a second download. When an article becomes current, its prepared body is consumed and one newly exposed future target is added. It never extracts unrelated entries from a publisher feed. Larger legitimate feeds are stream-parsed only to the requested target and are not retained. A genuine swipe change lets only already-running native work finish, then replaces stale queued targets with the latest buffer; a harmless readiness reorder does not restart the same five targets. JavaScript receives and sanitises only the displayed article; cleaned HTML is never prefetched. Valid edge swipes require direction/distance; an intentional finger pause longer than 200 ms before release cancels the gesture without navigation or behaviour recording. Each new request immediately unmounts the previous native WebView and shows an opaque theme surface; a small spinner appears on that surface only after 180 ms. This prevents a native publisher page from flashing beneath a loader, and generation IDs prevent stale rapid-swipe loads from replacing the latest article. Behavior events are queued locally during reading and backend sync is deferred until Reader exit/reconnect/lifecycle work. iOS/currently unrebuilt development APKs use the JavaScript fallback. An unavailable live-RSS item silently advances when raw archived pages are disabled. Its guarded finish path intercepts all normal removals (HUD close, Android/system back, queue-exhausted return), writes History once and exits immediately while behavior sync continues in the background. Retains own `scrollProgress` state and PanResponder refs. Uses `topInset` for HUD, `bottomInset` for progress bar.
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
// Latent scores x stored in Firestore (unbounded, neutral = 0.0).
// At runtime, sigmoid(x) = 1/(1+e^(-x)) maps to [0,1].
P = categoryShare × sigmoid(catLatent) + publisherShare × sigmoid(pubLatent)
```

For a publisher with **any stored interaction history**, category gets 60% of P and publisher gets 40%.

For a publisher with **no stored publisher weight at all**, the configurable cold-start shares apply: category 90%, publisher 10% by default. The unknown publisher latent defaults to 0.0 (neutral, σ(0)=0.50).

| Situation | Publisher history? | catLatent | pubLatent | P (approx) |
|---|---|---:|---:|---:|
| New user (neutral) | No | 0.0 | 0.0 | 0.50 |
| Likes category | No | 1.0 | 0.0 | 0.66 |
| Likes category | Yes | 1.0 | 0.0 | 0.60 |
| Loves both | Yes | 2.2 | 2.2 | 0.90 |
| Hates category | Yes | -2.2 | 1.0 | 0.43 |

Latent scores are unbounded; the old [0.1, 5.0] weight scale has been fully replaced. Neutral = 0.0 (true 50% score). No config-level clamp is duplicated in normalizeP — the sigmoid naturally handles any x value.

### 2c. T — Trending [0, 1]

Source: `getRankedFeed.ts: normalizeT()`, decay in `cronDecayTrendingScores`

```typescript
T = S / (S + k)   // S = raw trending score, k = trendingHalfSat (default 25)
```

Half-saturation at k=25 means: a raw score of 25 → T=0.50. At k=25 this calibrates to ~1% of DAU. Saturation is asymptotic — no hard cap, viral runaways flatten naturally.

| Raw score S | T (k=25) |
|---|---|
| 0 (new) | 0.00 |
| 5 | 0.17 |
| 10 | 0.29 |
| 25 | 0.50 |
| 50 | 0.67 |
| 100 | 0.80 |

`trendingScore` is incremented when users engage with an article. It decays daily at **×0.9057** (halves every 7 days).

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

Read-visit increments are multiplied by the attention factor `A` (see §3a) — a
fling contributes zero trending, a skim contributes 0.35×. Deliberate
save/like/unlike/unsave are unscaled. `read_skim` is no longer emitted by the
classifier (geometry-only labels); the increment row is retained for legacy
records created before that change.

**peakTrendingScore:** All-time high, never decays. Updated in the same batch as trendingScore. Used by `cronCleanupOldArticles` for deletion ranking (now via sampled query — 500 worst-scoring candidates, composite index on `publishDate` + `peakTrendingScore`).

**Per-user per-article dedup:** In-batch `likeDedup` and `saveDedup` Sets.

### 2d. R — Recency [0, 1]

Source: `getRankedFeed.ts: normalizeR()`

```typescript
R = 1 / (1 + daysOld / τ)   // τ = recencyDaysConstant (default 14)
```

Single monotone decay — no piecewise curve. At τ=14 days: an article half-loses its recency score every 14 days.

| Age | R value (τ=14) |
|---|---|
| 0 days | 1.00 |
| 3 days | 0.82 |
| 7 days | 0.67 |
| 14 days | 0.50 |
| 28 days | 0.33 |
| 60 days | 0.19 |

### 2e. Q — Publisher Quality [0, 1]

Source: `getRankedFeed.ts: normalizeQ()`

```typescript
Q = sigmoid(publisherLatent) = 1 / (1 + e^(-y))
// publisherLatent y stored in publishers/{id}.qualityScore (unbounded)
```

Publisher reputation is stored as an unbounded latent y. At runtime, sigmoid maps it to [0,1]. New publishers seed at y=1.386 → Q=0.80 (optimistic). Collective feedback applies tiny quality increments:

| Action | γ (latent change) |
|---|---|
| Save | +0.010 |
| Like | +0.005 |
| Thorough read | +0.005 |
| Swipe not interested | -0.010 |
| Quick exit | -0.010 |

This establishes a 2:1 veto ratio — a publisher's reputation rises only when ≥66.7% of readers thoroughly engage. Read-visit deltas are scaled by the Engagement Index; explicit actions are unscaled. Latents are write-time clamped to ±20 (configurable).

| Stored latent y | Q |
|---|---|
| -2.20 (worst) | 0.10 |
| -0.69 | 0.33 |
| 0.00 | 0.50 |
| 1.386 (default new) | 0.80 |
| 2.20 (excellent) | 0.90 |

### 2f. Diversity — Single-Pass Greedy Selection

Diversity is enforced through subtractive penalty steps during sequential greedy selection in `selectFeed()`. No hard per-publisher cap — instead, each prior pick of a category subtracts 0.15 from candidates in that category, and each prior pick of a publisher subtracts 0.25 from candidates from that publisher. A configurable `maxArticlesPerCategory` hard cap remains as a safety net. Discovery slots (every 5th card, positions 4/9/14/19/24/29) zero out personalization entirely for that pick. Stochastic jitter (±0.03) keeps the feed organic. A `minDistinctCategories` fixup replaces the weakest overrepresented-category article with the strongest missing-category candidate when eligible alternatives exist.

### 2g. Scoring Formula (Single Formula)

```
fullScore = 0.60×P + 0.15×T + 0.10×R + 0.15×Q
```

One formula is used for both selection and ordering. No separate tail formula exists in v2. Weights are in `firebase/functions/src/constants.ts` (`SCORE_WEIGHTS`). Sum = 1.0. Output: [0, 1].

### 2h. Feed Assembly (Single-Pass Selector)

1. Sort all candidates by fullScore descending. Lock the highest-scoring article into position 0 (hero anchor).
2. For positions 1–29, re-score every remaining candidate: `Adjusted = BaseScore − (0.15 × N_cat) − (0.25 × N_pub) + jitter(±0.03)`.
3. Discovery slots (every 5th card) use only T+R+Q (w_P=0.0).
4. The candidate with the highest adjusted score wins; N_cat and N_pub increment for future picks.
5. After selection: category interleave + publisher spacing (3-card gap) as display-order polish.

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

### 3a. Feedback Latent Steps (δ)

Source: `firebase/functions/src/constants.ts`

```typescript
// Latent steps applied directly to user preference latent x.
// Read-session steps are scaled by the Engagement Index E; explicit actions unscaled.
// Quick-exit uses asymmetric rejection: -2.5 × read_thorough.
save: +0.55 / unsave: -0.55
like: +0.40 / unlike: -0.40
read_thorough: +0.275 / read_skim: +0.10 / read_shallow: +0.10
swipe_next: 0.00
quick_exit: -0.6875 / swipe_not_interested: -0.6875
```

**Pivot velocity (N=8):** 8 consecutive thorough reads (E=1.0) move a user from neutral (x=0, P=0.50) to enthusiastic (x=2.20, P≈0.90). δ_cat = 2.20/8 = 0.275.

### 3b. Engagement-Index Scaling

Read-session deltas are multiplied by the continuous Engagement Index `E = scrollDepth × pacePenalty`, where pacePenalty is derived from the user's session WPM divided by their personal `averageWpm`:

| Relative speed R_s | Pace Penalty |
|---|---|
| ≤1.25× personal average | 1.00 |
| =2.0× personal average | 0.50 |
| ≥3.0× personal average | 0.00 |

Deliberate tap-actions (save/like/unlike/unsave/not-interested) ship unscaled.

### 3c. Watermark-Based Event Processing

`updateWeights()` uses `weightUpdatedAt` to process only new events. Latent drift uses a separate `weightsDecayedAt` timestamp.

### 3d. Latent Clamping

`x = clampLatent(x, cfg)` — clamped to ±`latent.clamp` (default 20) at write time.

### 3e. Nightly Latent Drift

`x_{t+1} = x_t × λ^elapsedDays` — every full day since last drift pulls latents toward neutral 0.0 at λ=0.]95 (5% per day).

### 3f. Asymmetric Rejection (thresholded v2)

A quick exit is certified as a real rejection by **repeated evidence**, not applied per
tap. Quick exits are counted per axis — category, length-style, and publisher — inside a
rolling `rejection.windowMs` (24h); one capped penalty (−0.6875) applies when an axis
crosses its `rejection.*MinQuickExits` (default 2). A positive signal on the same axis
clears its evidence. This stops accidental taps from suppressing a category at full
strength. A read_thorough, read_skim, like, or save during the same batch applies its own
delta normally.

### 3g. WPM Calibration and Read-Time Estimates

(WPM calibration unchanged from audit)

### 3h. UI Sync Thresholds

- `latent <= -0.85` → add to `notInterestedCategoryIds` (σ ≈ 0.30)
- `latent >= 0.85` → add to `selectedCategoryIds` (σ ≈ 0.70)
- Between: remove from arrays if previously flagged

---


### 3h. Behavior Event Pipeline (syncBehaviorEvents)

The syncBehaviorEvents Cloud Function handles batched behavior events from the client, updates trending scores, publisher quality, and triggers weight updates. Two critical fixes were applied:

**1. FieldValue.increment replaced with absolute writes**
The emulator's stubbed irebase-admin does not implement FieldValue.increment(). The original code used `admin.firestore.FieldValue.increment(netDelta) which threw TypeError: Cannot read properties of undefined (reading 'increment'). Fixed by computing absolute values:

````typescript
trendingScore: (initial?.trendingScore ?? 0) + netDelta
qualityScore: (existingQuality ?? DEFAULT) + netDelta
`

**2. Missing articles skipped to prevent batch failure**
The batch `batch.update(articleRef, ...) threw NOT_FOUND if an event referenced an article that no longer exists (e.g., cleaned up). Fixed by checking `articleInitialScores and skipping missing articles:

````typescript
const initial = articleInitialScores[artId];
if (!initial) { console.warn(...); continue; }
`

These fixes ensure the weight update pipeline works reliably in the emulator and is resilient to data drift in production.

---

## 4. Behavior Event Classification

Source: client `useBehaviorTracker.ts` plus server `syncBehaviorEvents.ts` / `scoringConfig.ts`.

The client is a sensor: on normal next swipe or unfinished Reader cleanup it sends a raw `'read_session'` containing foreground-active duration, maximum scroll depth, and the latest rendered word count when available. It does not decide whether the read was a skim or thorough. `useBehaviorTracker.ts` listens to React Native `AppState`: it pauses timing on `inactive` or `background` and resumes on `active`. Thus app switching, locking, calls, and multitasking time are excluded, including if Reader cleanup occurs while still paused.

**Scroll depth and word count are measured against the ARTICLE BODY, not the whole
document** (scroll-accuracy fix). The injected Reader script (`makeReaderScript` in
`ReaderScreen.tsx`) locates a content root — `#tangent-article` in sanitized mode,
or a selector heuristic (`article`, `main`, Substack's `.post-content`, etc.) in
raw-webpage/archived mode, with `document.body` as last resort. Depth =
section of the body whose bottom edge has crossed the viewport bottom, recomputed
from live geometry on every scroll event (lazy-loaded images/embeds can't distort
it; bodies shorter than one screen resolve naturally). Word count derives from the
root's innerText. Scroll messages are throttled to 200 ms with an unconditional
final-position capture on `pagehide`/`visibilitychange` so the deepest genuine
position always lands. This prevents recommendation modules and page footers
(which inflate both document depth and word count on Substack-style pages) from
distorting classification, WPM calibration, or consumed-word math.

The backend validates the telemetry, loads the active `system/scoringConfig` once per batch, then stores one final type. **Classification is geometry-only** — pace plays no role in labelling (the retired WPM-pace trial was removed); the attention factor handles pace scaling at weight/trending/quality time:

```
if (scrollDepth < quickExitDepth AND duration < quickExitTimeoutSec) → 'quick_exit'
else if (scrollDepth >= thoroughDepth) → 'read_thorough'
else if (scrollDepth >= shallowDepth) → 'read_shallow'
else → 'swipe_next'
```

The default thresholds are 0.20 depth / 15 seconds for quick exit, 0.70 depth for thorough (Finished), and 0.40 depth for shallow (weekly-read / streak bar). The retired `thoroughTimeFraction` key remains in stored configs for compatibility only and is no longer consulted. `read_skim` is no longer emitted, but legacy records of that type remain honored in weekly counts and weight/trending math. The config is cached for about 60 seconds per warm Function instance, so a Dashboard change is near-real-time rather than globally instantaneous.

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
Google credential recovery. Since the 21 Aug fix it requires a one-time ownership token that the still-signed-in device stamped into its own profile beforehand, compared with timing_safe_equal; without a valid token it refuses to delete. 





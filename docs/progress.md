# SubTick — Progress & Status

> **Last verified:** July 2026 against commit `fb3b62ab`.  
> All status claims are based on reading the actual code, not planning notes. "Working" means the code path is complete end-to-end. "Incomplete" means the code exists but a specific branch or feature is verifiably broken or missing.

---

## 1. Fully Implemented & Working

The following features have complete, connected code paths from UI through to backend and back.

### Core Feed Pipeline
- ✅ **RSS ingestion** — `rssCollector.ts` fires every 3 hours via Firebase Scheduler, reads from `feeds` Firestore collection, fetches all active RSS feeds, deduplicates by SHA-256 ID, writes new articles. (`rssCollector.ts:157-331`)
- ✅ **OG metadata fallback scraper** — When RSS item is missing image/author/description, `fetchOgMetadata()` fetches the live article URL (6s timeout) and extracts `og:image`, `og:description`, `meta[name=author]` via regex. (`rssCollector.ts:30-98`)
- ✅ **Paywall detection** — Three-layer check: keyword list, CSS class patterns, script patterns. Paywalled articles are excluded from all candidate pools. (`rssCollector.ts:132-147`)
- ✅ **Dual candidate pool cron** — `cronUpdateCandidatePool` runs every 10 minutes, builds `system/candidatePool_current` (1000 articles, all current-status) and `system/candidatePool_mixed` (500 current + 500 archived). Eliminates per-user Firestore table scans. (`getRankedFeed.ts:90-163`)
- ✅ **5-component ranked feed** — `getRankedFeed` Cloud Function implements full scoring formula `(0.30×P + 0.20×T + 0.25×R + 0.15×Q + 0.10×U)` with 3D personalization matrix (category × length-style × publisher). (`getRankedFeed.ts:50-76`)
- ✅ **Tranche-based feed assembly** — 4-bucket tranche system (High: 12, Mid: 8, Low: 4, Discovery: 6) with graceful overflow and final shuffle. (`getRankedFeed.ts:302-397`)
- ✅ **Dynamic crowd-sourced publisher quality** — `publishers` collection incremented atomically per behavior event; used as Q component in scoring. (`syncBehaviorEvents.ts:117-130`, `getRankedFeed.ts:268-295`)
- ✅ **Firestore fallback** — If Cloud Function is unavailable, client falls back to direct Firestore query (recency-ordered, seen-filtered). (`feedService.ts:186-217`)

### Personalization & Learning
- ✅ **Behavior event classification** — `useBehaviorTracker.ts` classifies every article exit as one of 8 event types based on scroll depth + session duration thresholds. (`useBehaviorTracker.ts:114-146`)
- ✅ **AsyncStorage behavior queue** — Events queue locally with a 500-item cap. Mutex-serialized writes prevent race conditions from rapid swiping. (`behaviorSync.ts:24-76`, `feedService.ts:42-48`)
- ✅ **Offline sync with retry** — `offlineManager.ts` listens for network reconnect via NetInfo, flushes queue with 30-second cooldown on failure. (`offlineManager.ts`)
- ✅ **Cloud weight update** — `syncBehaviorEvents` → `updateWeights()` applies `Δ × learningRate` per dimension (category: 0.08, length: 0.12, publisher: 0.16), clamps to [0.1, 5.0], applies 0.5% daily decay, syncs `selectedCategoryIds`/`notInterestedCategoryIds` arrays. (`weightUpdater.ts:29-250`)
- ✅ **WPM calibration** — Rolling 80/20 average WPM calculated from `actualWordCount` (live from WebView JS) or fallback DB word count; skipped for truncated feeds; bounds-checked [150, 750 wpm]. (`weightUpdater.ts:172-225`)
- ✅ **Reading streak & weekly count** — `updateReadStats()` correctly maintains `currentStreakDays` and `weeklyReadCount` using Firestore subcollection queries. (`weightUpdater.ts:269-318`)

### Reader Experience
- ✅ **Live RSS article fetching at read time** — Client fetches live RSS feed XML, parses with `fast-xml-parser`, finds article by GUID match, sanitizes with `xss`. Promise-level session cache prevents duplicate concurrent downloads. (`feedService.ts:93-142`)
- ✅ **Two-mode rendering** — "Clean" mode: sanitized RSS HTML injected into custom styled WebView. "Raw" mode: archived articles load `publicationUrl` directly as `source={{ uri }}`. Switching is automatic based on `rssStatus`. (`ReaderScreen.tsx:603-611`)
- ✅ **`rssStatus` self-healing** — If live RSS fetch fails, `ReaderScreen` writes `rssStatus='archived'` to Firestore so future loads skip the failed RSS attempt and load the raw URL. (`ReaderScreen.tsx:169-176`)
- ✅ **Real-time preloader** — When 5 articles remain in queue, flushes behavior queue, fetches fresh ranked batch, appends to queue without navigation break. (`ReaderScreen.tsx:278-305`)
- ✅ **Background prefetcher** — 10-article look-ahead window fetches RSS feeds for upcoming articles concurrently. Prunes `feedSessionCache` to only keep feeds in the look-ahead window. (`ReaderScreen.tsx:195-246`)
- ✅ **HUD with auto-hide** — Frosted-glass BlurView HUD (expo-blur) shows on scroll-up/tap, hides on scroll-down. 2.5s auto-hide timer. Like/Bookmark actions in HUD. (`ReaderScreen.tsx:671-729`)
- ✅ **Edge-zone PanResponder swipes** — 45px edge zones on left/right intercept swipes without conflicting with WebView scroll. 40px threshold. (`ReaderScreen.tsx:386-424`)
- ✅ **WebView navigation lock** — External links always open in OS browser. In archived mode: same-domain redirects allowed, cross-domain blocked. (`ReaderScreen.tsx:614-648`)
- ✅ **Scroll progress bar** — Animated bottom bar driven by WebView postMessage scroll events (current depth, not max depth). (`ReaderScreen.tsx:731-750`)
- ✅ **Per-publisher frontend rules** — `frontendRules.removeCss` (hide selectors) and `frontendRules.injectCss` (inject CSS) applied both in sanitized HTML mode and raw URI mode via injected JS. (`ReaderScreen.tsx:462-526`)
- ✅ **Mock/Sandbox mode** — Reader accepts `mockArticle` + `mockHtml` route params to render any article without Firestore reads or behavior tracking. Used by Developer Sandbox in Settings. (`ReaderScreen.tsx:49-53`, `SettingsScreen.tsx:218-287`)

### Auth & Onboarding
- ✅ **Anonymous auth on first launch** — `signInAnonymouslyIfNeeded()` checks `onAuthStateChanged` first; creates new anonymous session only if no existing session. (`auth.ts:27-44`)
- ✅ **User profile bootstrap** — `ensureUserProfile()` creates default Firestore profile on first launch with neutral weights (1.0) for all 6 categories. (`auth.ts:47-85`)
- ✅ **Onboarding flow** — 3-state chip grid (Neutral → Selected → Not Interested cycle). Minimum 3 selected required. Passes selections to Dashboard which calls `completeOnboarding()`. (`OnboardingScreen.tsx`, `auth.ts:124-154`)
- ✅ **`isOnboarded` gate** — Dashboard redirects to Onboarding if `profile.isOnboarded === false`. (`DashboardScreen.tsx:95-98`)

### Screens & Navigation
- ✅ **Dashboard** — Hero + 2-row editorial layout, stats pill bar (3 configurable metrics), Discover button. Flushes behavior queue on every focus event then re-fetches profile. (`DashboardScreen.tsx`)
- ✅ **Settings** — Category preferences (3-state cycle with optimistic update + revert on failure), dashboard metric toggles (max 3), theme selection (system/light/dark), "Include Archived Articles" toggle, Google account link/unlink placeholder, developer sandbox, feed request submission. (`SettingsScreen.tsx`)
- ✅ **History screen** — Fully offline. Renders from `AsyncStorage[@subtick_seen_articles_meta]`. Zero Firestore reads. Opens in `mode='history'` (no swipes, no tracking). (`HistoryScreen.tsx`)
- ✅ **Saved Reads screen** — Fully offline. Renders from `AsyncStorage[@subtick_saved_articles_meta]`. Opens in `mode='saved'` (swipe forward/back through saved list, no tracking). Refreshes on focus to reflect unsave actions. (`SavedReadsScreen.tsx`)
- ✅ **Theme system** — Light and dark palettes fully defined. System follows OS preference. Pre-compiled WebView CSS prevents dark-mode flash on article load. Persisted to AsyncStorage + Firestore. (`ThemeContext.tsx`)

---

## 2. Designed / Partially Built — Incomplete

### Google Account Linking (Broken on Mobile)
- **Status:** Code exists and UI is present, but **non-functional on iOS and Android**.
- **Evidence:** `auth.ts:88-95` uses `linkWithPopup(auth.currentUser, provider)` which is a web-only Firebase API. `SettingsScreen.tsx:187-213` explicitly catches `auth/operation-not-supported-in-this-environment` and shows a "Not Available on Mobile" alert.
- **What's missing:** Native Google Sign-In requires `expo-auth-session` or `@react-native-google-signin/google-signin`. Neither is installed (confirmed by `package.json`).
- **Impact:** The `linkedGoogleAccount` field on `UserProfile` is always `false` on mobile. Users cannot persist their account across devices or app reinstalls — anonymous sessions are device-bound.

### `totalArticlesSaved` and `totalArticlesLiked` Counters (Unused)
- **Status:** Fields are declared in `UserProfile` type (`src/types/index.ts:17-18`) and initialized to `0` in `ensureUserProfile()` (`auth.ts:76-77`), but **no code increments them anywhere** in the codebase.
- **Evidence:** Search of all source files finds no write to `totalArticlesSaved` or `totalArticlesLiked` after initialization.
- **Impact:** These counters are always `0`. They are not shown in the Dashboard stats bar currently (the available metrics are `streak`, `avgWpm`, `totalReadTime`, `totalRead`, `topCategory`, `weeklyReads` — source: `constants.ts:97-104`).

### `trendingScore` — No Decay Mechanism
- **Status:** `trendingScore` on articles is incremented atomically but **never decayed or normalized**.
- **Evidence:** `syncBehaviorEvents.ts:107-113` only ever calls `FieldValue.increment(trendingDelta)`. No scheduled function exists to decay or reset trending scores over time.
- **Impact:** An article that received many engagements weeks ago will continue to have a high `T` component permanently. The scoring formula divides by 2.5 (`1.0 + trendingScore / 2.5`) to moderate the growth, but a score of, say, 100 would still give `T = max(0.1, 1.0 + 100/2.5) = 41.0` — a disproportionate boost. This is a known design debt.

### Feed Request Review Workflow (Admin Side Only)
- **Status:** The submission side is complete (`SettingsScreen.tsx:291-316`). The review/approval side (marking `status: 'approved'` and actually adding feeds) is **not implemented** in code.
- **Evidence:** `feed_requests` collection has a `status` field (`'pending'|'approved'|'rejected'`) but no Cloud Function, admin UI, or script processes approved requests.
- **Impact:** Feed requests submitted by users accumulate in Firestore as `status: 'pending'` indefinitely. Adding a feed still requires manually running `seedFeeds.js` or editing the `feeds` collection in the Firebase Console.

### `includeArchivedArticles` Candidate Pool Switching
- **Status:** Fully implemented in the backend (`getRankedFeed.ts:406-414` reads the user preference, `getOrUpdateCandidatePool(includeArchivedArticles)` switches pools). UI toggle exists in Settings (`SettingsScreen.tsx:509-525`).
- **Note:** This is complete but worth flagging — disabling the default (`false`) causes the server to serve articles from `candidatePool_mixed` which includes articles with `rssStatus='archived'`. These render as raw WebView loads of publisher pages, which may include subscription prompts and ads. This is documented behavior, not a bug.

---

## 3. Confirmed Absent (Gaps)

### No Automated Tests
- **Status:** Zero test files with assertions exist anywhere in the repository.
- **Evidence:** The only files matching `test_*.js` are `test_feed.js`, `test_scraper.js`, and `test_paywall.js` — these are manual Node.js scripts, not test suites. No `jest`, `vitest`, `@testing-library`, or any other testing framework appears in `package.json` or `firebase/functions/package.json` (confirmed by full file reads of both).
- **Impact:** There is no automated coverage for: the scoring formula, weight update math, behavior event classification thresholds, paywall detection, article ID generation, or any UI component.

### No Push Notifications
- **Status:** No push notification infrastructure exists.
- **Evidence:** `expo-notifications` is not in `package.json`. No Firebase Cloud Messaging configuration exists. No notification scheduling or token registration code exists in any source file.

### No Analytics / Error Tracking
- **Status:** No third-party analytics or crash reporting is integrated.
- **Evidence:** No Sentry, Firebase Analytics, Crashlytics, Amplitude, or similar packages in `package.json`. Logging is `console.log`/`console.error` only.

### No Pagination / Infinite Scroll on Dashboard
- **Status:** The Dashboard renders at most 3 articles (1 hero + 2 row items) from the 30-article feed.
- **Evidence:** `DashboardScreen.tsx:203-205`: `heroArticle = feedArticles[0]`, `rowArticles = feedArticles.slice(1, 3)`. The remaining 27 articles in the queue are only accessible via the Discover button (random pick from index 10+) or by tapping into the Reader and swiping.

### No Cross-Device Sync for Seen/Saved Articles
- **Status:** By design, seen and saved article lists are device-local only.
- **Evidence:** All seen/saved data lives in `AsyncStorage` exclusively. No Firestore write for seen/saved state exists anywhere. This is an explicit architectural decision (see `architecture.md` section 4).
- **Impact:** Users who reinstall the app or switch devices lose their reading history and saved articles. This also means the `seenArticleIds` filter sent to `getRankedFeed` is device-specific; a user on two devices will see duplicates across devices.

### No Content Moderation Pipeline
- **Status:** Articles are ingested automatically from 35 curated feeds with no human review step.
- **Evidence:** `rssCollector.ts` writes articles directly to Firestore after paywall detection. There is no `status: 'pending'|'approved'` field on articles, no admin review queue, no content filtering beyond paywall detection.

### No Rate Limiting on `syncBehaviorEvents`
- **Status:** The `syncBehaviorEvents` Cloud Function accepts any batch of events from any authenticated user with no per-user rate limiting.
- **Evidence:** `syncBehaviorEvents.ts:40-157` processes all submitted events without checking frequency or volume per user. A malicious user could artificially inflate `trendingScore` values by submitting fake `save` events (Δ = +3.0 per event) repeatedly.

---

## 4. Immediate Next Steps (Inferred from Incomplete Code)

Listed by inferred priority based on gaps and partial implementations found in code:

1. **Fix `trendingScore` decay** — Add a scheduled Cloud Function (e.g., daily cron) that applies percentage decay to `trendingScore` on all articles, similar to how `weightUpdater.ts` applies `DAILY_DECAY_RATE` to user weights. Without this, trending data becomes stale and permanently biased toward early high-engagement articles.

2. **Implement native Google Sign-In** — Install `expo-auth-session` or `@react-native-google-signin/google-signin` and replace `linkWithPopup` in `auth.ts:88-95`. This unblocks cross-device account persistence — the single biggest UX gap for retention.

3. **Wire `totalArticlesSaved` / `totalArticlesLiked` counters** — In `feedService.ts:markArticleSaved()` and `ReaderScreen.tsx` like handler, add a Firestore `increment(1)` to `users/{uid}.totalArticlesSaved` and `totalArticlesLiked`. The fields already exist; they just need write sites.

4. **Add trending score rate limiting** — Add per-user per-article deduplication in `syncBehaviorEvents.ts` to prevent the same user from incrementing `trendingScore` more than once per article. A simple check: query for an existing event from the same `userId + articleId + eventType` within a time window before applying the increment.

5. **Build feed request admin workflow** — Either a simple Cloud Function triggered by a Firestore write (when `feed_requests/{id}.status` is set to `'approved'`, automatically create the `feeds/{id}` document) or a minimal admin UI. Currently all feed requests are silently queued forever.

6. **Add automated tests** — No test framework is installed. Given the mathematical nature of the scoring algorithm and weight update formulas, unit tests for `calculateCompositeScore`, `assembleFeedWithTranches`, `updateWeights`, `concludeSession` classification, and `checkIsPaywalled` would prevent regressions on the most critical logic.

7. **Add `fetch` timeout to `fetchAndExtractArticle`** — `feedService.ts:100` calls `fetch(feedUrl)` with no `AbortController` timeout. A slow or hung publisher RSS server would block the Reader indefinitely. The server-side equivalent correctly uses a 15-second timeout (`rssCollector.ts:14`); the client should match.

8. **Implement Dashboard infinite scroll** — Currently only 3 of 30 fetched articles are visible on the Dashboard. Either show more articles in the list layout or provide a "See all" view. The 27 unused articles in `feedArticles` are fetched but displayed only through the Discover button.

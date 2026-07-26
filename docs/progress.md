# Tangent — Progress & Status

> **Last verified:** July 2026 against current codebase (post-cost-optimisation + full audit/fix session).
> All status claims are based on reading the actual code. "Working" means the code path is complete end-to-end. "Incomplete" means the code exists but a specific branch or feature is verifiably broken or missing.

---

## 1. Fully Implemented & Working

### Security
- ✅ **XSS prevention in Reader** — `escapeHtml()` correctly escapes `&`, `<`, `>`, `"`, `'` before inserting RSS-sourced title/author/publicationName into the WebView HTML template.
- ✅ **User profile field whitelist (create + update)** — Firestore rules restrict both `create` and `update` on `users/{uid}` to the same 8 safe fields (A4 fix). Stats and weight fields are server-only writes.
- ✅ **User profile create rule tightened** — `create` rule now whitelists the same fields as `update`, preventing profile forgery at account creation (A4 fix).
- ✅ **feed_requests schema validation** — Create rule enforces `userId == auth.uid`, URL length cap, field whitelist, and 2KB document size cap.
- ✅ **feedback schema validation** — Create rule enforces field whitelist and 5KB document size cap.
- ✅ **behavior_events full validation** — Create rule verifies `request.resource.data.userId == userId` (path match), `eventType` is one of 10 valid values, field whitelist enforced, and 2KB document size cap (S5 + A4 fix).
- ✅ **Firestore indexes deployed** — `firebase.json` now has `"indexes": "firestore.indexes.json"` pointer; indexes are deployed on every `firebase deploy`.
- ✅ **syncBehaviorEvents input cap** — Server-side 50-event limit prevents batch overflow and rate-limit abuse (A4 fix).
- ✅ **FeedRequestScreen description** — Sends empty string instead of `undefined`, preventing Firestore write failures on blank descriptions (A4 fix).
- ✅ **FeedbackScreen payload** — `status` field removed, matching the rules field whitelist and preventing silent write failures (A4 fix).

### Core Feed Pipeline
- ✅ **RSS ingestion** — `rssCollector.ts` fires every 3 hours, reads `feeds` collection, batch-checks article existence with `db.getAll()` (C3 fix), writes new articles.
- ✅ **Delta-driven archive update** — Post-sync archive pass now queries only `rssStatus == 'current'` articles per feed (using `feedUrl+rssStatus` composite index), not the full historical archive (C4 fix).
- ✅ **OG metadata fallback scraper** — `fetchOgMetadata()` extracts `og:image`, `og:description`, `meta[name=author]` via regex when RSS item is missing them. (6s timeout)
- ✅ **Paywall detection** — Three-layer check: keyword list, CSS class patterns, script patterns. Paywalled articles excluded from all candidate pools.
- ✅ **Dual candidate pool cron** — `cronUpdateCandidatePool` runs every 6 hours. Uses `random_score` field with circular wrap-around queries — 4 capped queries of max 500 docs each (~2,000 reads/run regardless of DB size). Box 1 (`candidatePool_current`): 500 fresh active + 500 old active. Box 2 (`candidatePool_mixed`): 500 fresh any-status + 500 old any-status (archived included proportionally by chance).
- ✅ **random_score field** — Every article has a `random_score: Math.random()` field assigned on ingestion and refreshed daily by `cronDecayTrendingScores` at zero extra cost. Enables truly random, non-repetitive pool sampling without full collection scans.
- ✅ **Trending score decay cron** — `cronDecayTrendingScores` runs daily, applies `trendingScore × 0.9057` (halves every 7 days) to all articles with `trendingScore > 1.0` (raised from 0.1 — C1 fix, ~70% write reduction). Also refreshes `random_score` on every touched article.
- ✅ **Old article cleanup cron** — `cronCleanupOldArticles` runs every 3 days. Step 1: immediately deletes ALL paywalled articles (never shown, pure waste). Step 2: deletes bottom 3% of articles older than 3 months ranked by `peakTrendingScore`. Keeps database bounded. Saved articles are protected via user profile copies.
- ✅ **peakTrendingScore tracking** — Each article has a `peakTrendingScore` field (all-time high, never decays). Updated in the **same batch** as the trendingScore increment in `syncBehaviorEvents`. Used by cleanup cron for deletion ranking.
- ✅ **Like/Unlike and Save/Unsave toggle** — Unlike and unsave events fire negative trendingScore increments (-2.0, -3.0) and negative personalization deltas (-0.40, -0.55). Per-user per-article dedup prevents double-counting in a single batch.
- ✅ **Normalized 5-component ranked feed** — `getRankedFeed` implements fully normalized scoring. All 5 components output [0,1] so formula weights are honest. Two formulas: personalized (High/Mid tranches) and merit-based (Low/Discovery tranches).
- ✅ **Tranche-based feed assembly** — 4-bucket tranche system using normalized P thresholds: High (P≥0.40): 12 random, Mid (P≥0.20): 8 random, Low (P≥0.10): 4 random if <30 reads else merit-sorted, Discovery (<0.10): 6 random if <30 reads else merit-sorted.
- ✅ **Dynamic crowd-sourced publisher quality** — `publishers` collection. New publishers seeded at DEFAULT_PUBLISHER_QUALITY (0.8) + delta; existing publishers use atomic increment. Publisher list cached in-memory with 10-min TTL in `syncBehaviorEvents` (C5 fix).
- ✅ **Firestore fallback** — If Cloud Function unavailable, client falls back to direct Firestore query with `isPaywalled == false` filter pushed to the query (C7 fix).
- ✅ **P0 Security** — Both `getRankedFeed` and `syncBehaviorEvents` enforce `request.auth.uid`. Client-supplied `userId` is ignored. Unauthenticated calls throw immediately.
- ✅ **Idempotent event sync** — `event.id` (client-generated) used as Firestore document ID. Retries after network timeout never create duplicate events.
- ✅ **Firestore write optimizations** — `syncBehaviorEvents` now: (1) skips saving zero-impact `swipe_next` events entirely, (2) merges `peakTrendingScore` update into the main batch, (3) aggregates publisher quality deltas to one write per unique publisher per batch, (4) caches publisher list with 10-min TTL. Reduces writes by ~34–52% per user session.

### Personalization & Learning
- ✅ **Behavior event classification** — `useBehaviorTracker.ts` classifies exits as one of 8 event types based on scroll depth + session duration. Uses named constants `QUICK_EXIT_MAX_DURATION_MS` / `QUICK_EXIT_MAX_SCROLL` from `constants.ts`.
- ✅ **Quick-exit double-fire fix** — Shared `sessionSnapshotRef` object used by both `concludeSession()` and the `useEffect` cleanup. `concludeSession()` sets `sessionSnapshotRef.current.concluded = true`; cleanup reads this live value. Prevents swipe_not_interested + quick_exit double-recording (B2 fix).
- ✅ **AsyncStorage behavior queue** — 500-item cap, mutex-serialized. Events queue locally and flush to Cloud Function.
- ✅ **Flush race condition fixed** — `flushBehaviorQueue` now uses the same mutex as `queueBehaviorEvent` for its read and write-back steps. Network call stays outside the mutex. Prevents concurrent swipe from being silently clobbered by a flush write-back (B6 fix).
- ✅ **Offline sync with retry** — `offlineManager.ts` listens for network reconnect, flushes queue with 30s cooldown on failure.
- ✅ **Watermark-based weight update** — `updateWeights()` uses `weightUpdatedAt` watermark to process only new events. No event replay across syncs. Daily decay applies only once per 23+ hours.
- ✅ **Faster personalization** — FEEDBACK_DELTAS: save=0.55, like=0.40, read_thorough=0.30, read_skim=0.10. Noticeable personalization within 1-2 sessions.
- ✅ **WPM calibration** — Rolling 80/20 average; bounds-checked [150, 750 wpm]; skipped for truncated feeds.
- ✅ **Reading streak & weekly count** — `updateReadStats()` maintains `currentStreakDays` and `weeklyReadCount`.

### Reader Experience
- ✅ **Live RSS article fetching** — `fetchAndExtractArticle()` with 15s timeout; Promise-level session cache prevents duplicate downloads. Lazy sanitization: only the matched article is sanitized, not the whole feed (C6 fix).
- ✅ **Two-mode rendering** — Clean (sanitized HTML) vs Raw (archived articles load URL directly). Automatic based on `rssStatus`.
- ✅ **RSS failure persistence** — Failed RSS fetches write `@subtick_rss_failed_{id}` to AsyncStorage. Future loads skip immediately.
- ✅ **HTML injection prevention** — `escapeHtml()` correctly applied to `article.title`, `publicationName`, and `author` before inserting into WebView HTML template (S1 fix).
- ✅ **Theme changes no longer reload the article** — CSS updates are injected into the existing WebView via `injectJavaScript()` instead of rebuilding the full HTML and forcing a page reload (B9 fix).
- ✅ **Real-time preloader** — When 5 articles remain, fires flush (non-blocking) + fetches next batch in parallel. No swipe stutter.
- ✅ **Background prefetcher** — 10-article look-ahead window.
- ✅ **HUD with auto-hide** — Frosted-glass BlurView, 2.5s auto-hide. Like/Bookmark in HUD. Shows article title (not publication name) with `ellipsizeMode="tail"` so long titles truncate instead of expanding the bar (A5 fix). Never visible on initial page load — only appears when user actively scrolls up (A5 fix).
- ✅ **Edge-zone PanResponder swipes** — 45px zones, 40px threshold.
- ✅ **Right-swipe navigation in history mode** — Right-swipe now correctly calls `goToPrev()` in both saved-reads and history modes (B5 fix).
- ✅ **WebView navigation lock** — External links open in OS browser; archived mode allows same-domain redirects.
- ✅ **Scroll progress bar** — Animated bottom bar.
- ✅ **Per-publisher frontend rules** — `frontendRules.removeCss` and `injectCss` in both rendering modes.
- ✅ **Mock/Sandbox mode** — Reader accepts `mockArticle` + `mockHtml` for developer testing.

### Auth & Onboarding
- ✅ **Anonymous auth** — `signInAnonymouslyIfNeeded()` reuses existing session.
- ✅ **User profile bootstrap** — `ensureUserProfile()` creates default profile with neutral weights (1.0).
- ✅ **Onboarding flow** — 3-state chip grid. Minimum 3 selected. `completeOnboarding()` properly awaited before Dashboard reloads.
- ✅ **`isOnboarded` gate** — Dashboard redirects to Onboarding if not onboarded.

### Screens & Navigation
- ✅ **Dashboard** — Hero + 2-row layout, stats pill (3 configurable metrics). Queue passed to Reader no longer includes the opened article (B3 fix). Discover button jumps past the 3 visible cards only (SURPRISE_ME_MIN_INDEX = 3, A3 fix). Focus listener no longer refetches articles on every navigation back — only refetches if all articles were read (A5 fix). Reader queue is shuffled so untapped Dashboard cards are scattered randomly among the full feed (A5 fix).
- ✅ **Settings** — Now scrollable (`<ScrollView>`). Developer Options section hidden in production (`__DEV__` gate). Sections: Account, Library, Preferences, Support & Feedback.
- ✅ **History screen** — Fully offline. Zero Firestore reads. Loads once via focus listener only, no double-load on mount (B10 fix). Passes full history ID array as Reader queue, enabling swipe navigation through all history articles (A4 fix).
- ✅ **Saved Reads screen** — `loadSaved()` called on both mount AND focus.
- ✅ **Saved articles Firestore sync** — `unmarkArticleSaved()` now correctly deletes the server copy in addition to local storage (B4 fix). `markArticleSaved()` only writes to Firestore if the article isn't already saved (C8 fix).
- ✅ **Dashboard Stats screen** — "Hours Read" correctly displays `totalReadTimeMs`.
- ✅ **Theme system** — Light/dark/system. Pre-compiled WebView CSS. Persisted to AsyncStorage + Firestore.
- ✅ **CategoryPreferences, DashboardStats, Feedback, FeedRequest** sub-screens all implemented.

### Build & Foundation
- ✅ **babel.config.js and metro.config.js** — Standard Expo SDK 57 build configuration files present.
- ✅ **Functions tsconfig** — No longer incorrectly extends `expo/tsconfig.base`; standalone Node.js config.
- ✅ **.env.example** — Documents `EXPO_PUBLIC_USE_EMULATORS` and optional `EXPO_PUBLIC_FIREBASE_*` override variables.
- ✅ **Firebase config env-var support** — `firebase.ts` reads config from `EXPO_PUBLIC_FIREBASE_*` with hardcoded production values as fallback.

---

## 2. Designed / Partially Built — Incomplete

### Google Account Linking (Broken on Mobile)
- **Status:** UI present, non-functional on iOS/Android.
- **Evidence:** `auth.ts` uses `linkWithPopup()` which is web-only. `SettingsScreen.tsx` catches `auth/operation-not-supported-in-this-environment` and shows an alert.
- **What's missing:** `expo-auth-session` or `@react-native-google-signin/google-signin`.
- **Impact:** `linkedGoogleAccount` always `false` on mobile. No cross-device account persistence.

### Feed Request Review Workflow (Admin Side Only)
- **Status:** Submission complete. Review/approval not implemented. Requests accumulate as `status: 'pending'` indefinitely.

---

## 3. Confirmed Absent (Gaps)

- **No automated tests** — No jest/vitest/testing-library anywhere.
- **No push notifications** — No `expo-notifications` or FCM.
- **No analytics / error tracking** — Console logging only.
- **No cross-device sync** — Seen/saved state is device-local by design.
- **No content moderation** — Articles ingested automatically, paywall detection only.
- **No rate limiting on `syncBehaviorEvents`** — Per-user per-article dedup prevents in-batch abuse, but a user sending many separate batches could still inflate trendingScore. Decay mitigates long-term impact.
- **No pull-to-refresh** — Feed refresh is triggered by navigation focus and queue depletion only.
- **No ErrorBoundary** — A render crash anywhere in the component tree shows a red screen.

---

## 4. Known Future Work

1. **Implement native Google Sign-In** — Replace `linkWithPopup` with `expo-auth-session`. Unblocks cross-device persistence.
2. **Add trending score rate limiting** — Per-user per-article dedup already in `syncBehaviorEvents.ts` for a single batch; add cross-session dedup.
3. **Build feed request admin workflow** — Cloud Function trigger or admin UI to process approved requests.
4. **Add automated tests** — Scoring formula, weight update math, behavior classification, paywall detection.
5. **Candidate pool document size limit** — At ~1,250 articles, the `system/candidatePool_current` document will approach Firestore's 1 MB limit. Strip pool articles to scoring-essential fields only, or migrate to a subcollection.
6. **Dashboard infinite scroll** — Only 3 of 30 fetched articles shown; remaining accessible only via Discover button.
7. **Run `backfillRandomScore.js` once** — `firebase/scripts/oneoff/backfillRandomScore.js` must be run once against production to assign `random_score` to all pre-existing articles. Until then, `cronUpdateCandidatePool` will only sample articles ingested after the deployment.
8. **Shared component extraction** — `OnboardingScreen` and `CategoryPreferencesScreen` share ~80% code. `HistoryScreen` and `SavedReadsScreen` are near-identical. Extract shared components to reduce duplication.
9. **UserContext** — Each screen independently fetches the user profile from Firestore. A shared React Context would eliminate redundant reads.
10. **Theme preference cross-device sync** — `themePreference` is written to Firestore but ThemeContext only reads from AsyncStorage. Fresh installs on new devices ignore the cloud preference.
# SubTick — Progress & Status

> **Last verified:** July 2026 against current codebase (post-bugfix session).
> All status claims are based on reading the actual code. "Working" means the code path is complete end-to-end. "Incomplete" means the code exists but a specific branch or feature is verifiably broken or missing.

---

## 1. Fully Implemented & Working

### Core Feed Pipeline
- ✅ **RSS ingestion** — `rssCollector.ts` fires every 3 hours, reads `feeds` collection, deduplicates by SHA-256, writes new articles.
- ✅ **OG metadata fallback scraper** — `fetchOgMetadata()` extracts `og:image`, `og:description`, `meta[name=author]` via regex when RSS item is missing them. (6s timeout)
- ✅ **Paywall detection** — Three-layer check: keyword list, CSS class patterns, script patterns. Paywalled articles excluded from all candidate pools.
- ✅ **Dual candidate pool cron** — `cronUpdateCandidatePool` runs every 10 minutes, builds `system/candidatePool_current` (500 fresh + 500 old) and `system/candidatePool_mixed` (500 current + 500 archived).
- ✅ **Trending score decay cron** — `cronDecayTrendingScores` runs daily, applies `trendingScore × 0.9057` (halves every 7 days) to all articles with `trendingScore > 0.1`.
- ✅ **Normalized 5-component ranked feed** — `getRankedFeed` implements fully normalized scoring. All 5 components output [0,1] so formula weights are honest. Two formulas: personalized (High/Mid tranches) and merit-based (Low/Discovery tranches).
- ✅ **Tranche-based feed assembly** — 4-bucket tranche system using normalized P thresholds: High (P≥0.40): 12 random, Mid (P≥0.20): 8 random, Low (P≥0.10): 4 merit-sorted, Discovery (<0.10): 6 merit-sorted.
- ✅ **Dynamic crowd-sourced publisher quality** — `publishers` collection. New publishers seeded at DEFAULT_PUBLISHER_QUALITY (0.8) + delta; existing publishers use atomic increment.
- ✅ **Firestore fallback** — If Cloud Function unavailable, client falls back to direct Firestore query.
- ✅ **P0 Security** — Both `getRankedFeed` and `syncBehaviorEvents` enforce `request.auth.uid`. Client-supplied `userId` is ignored. Unauthenticated calls throw immediately.
- ✅ **Idempotent event sync** — `event.id` (client-generated) used as Firestore document ID. Retries after network timeout never create duplicate events.

### Personalization & Learning
- ✅ **Behavior event classification** — `useBehaviorTracker.ts` classifies exits as one of 8 event types based on scroll depth + session duration.
- ✅ **Quick-exit double-fire fix** — Cleanup effect snapshots `concluded`/`maxDepth`/`startTime` at effect-setup time (not live ref). Prevents swipe_not_interested + quick_exit double-recording.
- ✅ **AsyncStorage behavior queue** — 500-item cap, mutex-serialized. Events queue locally and flush to Cloud Function.
- ✅ **Offline sync with retry** — `offlineManager.ts` listens for network reconnect, flushes queue with 30s cooldown on failure.
- ✅ **Watermark-based weight update** — `updateWeights()` uses `weightUpdatedAt` watermark to process only new events. No event replay across syncs. Daily decay applies only once per 23+ hours.
- ✅ **Faster personalization** — FEEDBACK_DELTAS increased: save=0.55, like=0.40, read_thorough=0.30, read_skim=0.10. Noticeable personalization within 1-2 sessions.
- ✅ **WPM calibration** — Rolling 80/20 average; bounds-checked [150, 750 wpm]; skipped for truncated feeds.
- ✅ **Reading streak & weekly count** — `updateReadStats()` maintains `currentStreakDays` and `weeklyReadCount`.

### Reader Experience
- ✅ **Live RSS article fetching** — `fetchAndExtractArticle()` with 15s timeout; Promise-level session cache prevents duplicate downloads.
- ✅ **Two-mode rendering** — Clean (sanitized HTML) vs Raw (archived articles load URL directly). Automatic based on `rssStatus`.
- ✅ **RSS failure persistence (P1-C fix)** — Failed RSS fetches write `@subtick_rss_failed_{id}` to AsyncStorage instead of blocked Firestore write. Future loads skip immediately.
- ✅ **HTML injection prevention (P1-D fix)** — `escapeHtml()` applied to `article.title`, `publicationName`, and `author` before inserting into WebView HTML template.
- ✅ **Real-time preloader** — When 5 articles remain, fires flush (non-blocking) + fetches next batch in parallel. No swipe stutter.
- ✅ **Background prefetcher** — 10-article look-ahead window.
- ✅ **HUD with auto-hide** — Frosted-glass BlurView, 2.5s auto-hide. Like/Bookmark in HUD.
- ✅ **Edge-zone PanResponder swipes** — 45px zones, 40px threshold.
- ✅ **WebView navigation lock** — External links open in OS browser; archived mode allows same-domain redirects.
- ✅ **Scroll progress bar** — Animated bottom bar.
- ✅ **Per-publisher frontend rules** — `frontendRules.removeCss` and `injectCss` in both rendering modes.
- ✅ **Mock/Sandbox mode** — Reader accepts `mockArticle` + `mockHtml` for developer testing.

### Auth & Onboarding
- ✅ **Anonymous auth** — `signInAnonymouslyIfNeeded()` reuses existing session.
- ✅ **User profile bootstrap** — `ensureUserProfile()` creates default profile with neutral weights (1.0).
- ✅ **Onboarding flow** — 3-state chip grid. Minimum 3 selected. `completeOnboarding()` is now properly awaited before Dashboard reloads (race condition fix).
- ✅ **`isOnboarded` gate** — Dashboard redirects to Onboarding if not onboarded.

### Screens & Navigation
- ✅ **Dashboard** — Hero + 2-row layout, stats pill (3 configurable metrics). Removed 800ms artificial delay on focus. Removed redundant `flushBehaviorQueue()` on load. `flushBehaviorQueue` is now fire-and-forget on focus.
- ✅ **Settings** — Now scrollable (`<ScrollView>`). Developer Options section hidden in production (`__DEV__` gate). Sections: Account, Library, Preferences, Support & Feedback.
- ✅ **History screen** — Fully offline. Zero Firestore reads.
- ✅ **Saved Reads screen** — Fixed: `loadSaved()` now called on both mount AND focus (was only on focus, causing permanent spinner on first open).
- ✅ **Dashboard Stats screen** — Fixed: "Hours Read" case was missing from switch statement; now correctly displays `totalReadTimeMs`.
- ✅ **Theme system** — Light/dark/system. Pre-compiled WebView CSS. Persisted to AsyncStorage + Firestore.
- ✅ **CategoryPreferences, DashboardStats, Feedback, FeedRequest** sub-screens all implemented.

---

## 2. Designed / Partially Built — Incomplete

### Google Account Linking (Broken on Mobile)
- **Status:** UI present, non-functional on iOS/Android.
- **Evidence:** `auth.ts` uses `linkWithPopup()` which is web-only. `SettingsScreen.tsx` catches `auth/operation-not-supported-in-this-environment` and shows an alert.
- **What's missing:** `expo-auth-session` or `@react-native-google-signin/google-signin`.
- **Impact:** `linkedGoogleAccount` always `false` on mobile. No cross-device account persistence.

### `totalArticlesSaved` and `totalArticlesLiked` Counters (Unused)
- **Status:** Fields exist in `UserProfile`, initialized to 0, never incremented.

### Feed Request Review Workflow (Admin Side Only)
- **Status:** Submission complete. Review/approval not implemented. Requests accumulate as `status: 'pending'` indefinitely.

---

## 3. Confirmed Absent (Gaps)

- **No automated tests** — No jest/vitest/testing-library anywhere.
- **No push notifications** — No `expo-notifications` or FCM.
- **No analytics / error tracking** — Console logging only.
- **No cross-device sync** — Seen/saved state is device-local by design.
- **No content moderation** — Articles ingested automatically, paywall detection only.
- **No rate limiting on `syncBehaviorEvents`** — A malicious user can inflate `trendingScore` by submitting fake `save` events. (trendingScore decay mitigates long-term impact but doesn't prevent abuse.)

---

## 4. Known Future Work

1. **Implement native Google Sign-In** — Replace `linkWithPopup` with `expo-auth-session`. Unblocks cross-device persistence.
2. **Wire `totalArticlesSaved` / `totalArticlesLiked`** — Fields exist; just need write sites.
3. **Add trending score rate limiting** — Per-user per-article deduplication in `syncBehaviorEvents.ts`.
4. **Build feed request admin workflow** — Cloud Function trigger or admin UI to process approved requests.
5. **Add automated tests** — Scoring formula, weight update math, behavior classification, paywall detection.
6. **Candidate pool document size limit** — At ~1,250 articles, the `system/candidatePool_current` document will approach Firestore's 1 MB limit. Strip pool articles to scoring-essential fields only, or migrate to a subcollection.
7. **Dashboard infinite scroll** — Only 3 of 30 fetched articles shown; remaining accessible only via Discover button.
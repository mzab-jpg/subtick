# Tangent — Progress & Status

> **Last verified:** 30 July 2026 (post-refactoring Batches 1–3).
> All status claims are based on reading the actual code.

---

## 1. Fully Implemented & Working

### Security
- ✅ **XSS prevention in Reader** — `escapeHtml()` in ReaderScreen correctly escapes RSS metadata
- ✅ **User profile field whitelist (create + update)** — Firestore rules restrict both to safe fields (A4 + S2)
- ✅ **feed_requests / feedback schema validation** (S3/S4) — URL format, field schema, size caps
- ✅ **behavior_events full validation** (S5 + A4) — Path match, eventType enum, field whitelist, 2KB cap
- ✅ **Firestore indexes deployed** — `firebase.json` points to `firestore.indexes.json`
- ✅ **syncBehaviorEvents input cap** — Server-side 50-event limit prevents overflow (A4)
- ✅ **ErrorBoundary** (Batch 1) — Render crash safety net wrapping RootNavigator
- ✅ **Google Sign-In security** — `request.auth.uid` enforced; client userId ignored; lazy import in Expo Go

### Core Feed Pipeline
- ✅ **RSS ingestion** — `rssCollector.ts` every 3h, batch-checks existence with `db.getAll()` (C3)
- ✅ **Delta-driven archive update** — Queries only `rssStatus == 'current'` per feed (C4)
- ✅ **OG metadata fallback scraper** — `fetchOgMetadata()` extracts og:image/description/author (6s timeout)
- ✅ **Paywall detection** — Three-layer: keywords, CSS class patterns, script patterns
- ✅ **Dual candidate pool cron** — Random threshold R, 4 capped queries (~2,000 reads/run). Box 1 (current) + Box 2 (mixed)
- ✅ **random_score field** — Assigned on ingestion, refreshed daily at zero extra cost
- ✅ **Trending score decay cron** — Daily ×0.9057 for scores > 1.0 (C1, ~70% write reduction)
- ✅ **Old article cleanup cron** — Every 3 days: delete paywalled + bottom 3% by peakTrendingScore
- ✅ **peakTrendingScore tracking** — All-time high, never decays, same batch as trendingScore update
- ✅ **Like/Unlike and Save/Unsave toggle** — Negative increments + per-user per-article dedup
- ✅ **Normalized 5-component ranked feed** — All components [0,1]; two formulas (personalized + merit)
- ✅ **Tranche-based feed assembly** — 4 buckets: High/Mid random, Low/Discovery conditional
- ✅ **Dynamic publisher quality** — `publishers` collection, 10-min TTL cache (C5), atomic increments
- ✅ **Firestore fallback** — Client falls back to direct query with `isPaywalled == false` filter (C7)
- ✅ **Idempotent event sync** — `event.id` as Firestore doc ID
- ✅ **Firestore write optimizations** — Skip swipe_next, batch peakTrendingScore, aggregate publisher writes (~34–52% reduction)

### Personalization & Learning
- ✅ **Behavior event classification** — 8 types based on scroll depth + session duration with named constants
- ✅ **Quick-exit double-fire fix** — Shared `sessionSnapshotRef` (B2)
- ✅ **AsyncStorage behavior queue** — 500-item cap, mutex-serialized (via shared `asyncStorageMutex`) (B6)
- ✅ **Flush race condition fixed** — Same mutex for read/write; network outside mutex (B6)
- ✅ **Offline sync with retry** — `offlineManager.ts`, 30s cooldown
- ✅ **Watermark-based weight update** — `weightUpdatedAt`, no replay, daily decay at ≥23h intervals
- ✅ **Faster personalization** — FEEDBACK_DELTAS up to 0.55; noticeable within 1–2 sessions
- ✅ **WPM calibration** — Rolling 80/20 average [150, 750]; skipped for truncated feeds
- ✅ **Reading streak & weekly count** — `updateReadStats()` in weightUpdater

### Reader Experience
- ✅ **Live RSS article fetching** — `fetchAndExtractArticle()` with 15s timeout + Promise-level session cache
- ✅ **Two-mode rendering** — Clean (sanitized HTML) vs Raw (archived URL). Automatic based on `rssStatus`
- ✅ **RSS failure persistence** — AsyncStorage flag; future loads skip immediately
- ✅ **HTML injection prevention** — `escapeHtml()` on title, publicationName, author (S1)
- ✅ **Theme changes no reload** — CSS injected via `injectJavaScript()` (B9)
- ✅ **Real-time preloader** — Triggers at 5 remaining; non-blocking flush + parallel fetch
- ✅ **Background prefetcher** — 10-article sliding look-ahead window
- ✅ **HUD with auto-hide** — BlurView, 2.5s auto-hide, article title with `ellipsizeMode="tail"`, hidden on initial load (A5)
- ✅ **Edge-zone PanResponder swipes** — 45px zones, 40px threshold, 200ms pause detection
- ✅ **Right-swipe in history/saved modes** — Correctly calls `goToPrev()` (B5)
- ✅ **WebView navigation lock** — External links → OS browser; archived mode allows same-domain
- ✅ **Scroll progress bar** — Plain React state with percentage strings (Fabric-safe)
- ✅ **Per-publisher frontend rules** — `removeCss` + `injectCss` in both modes
- ✅ **Mock/Sandbox mode** — Reader accepts `mockArticle` + `mockHtml`

### Auth & Onboarding
- ✅ **Anonymous auth** — Reuses existing session
- ✅ **User profile bootstrap** — `ensureUserProfile()` creates default profile with neutral weights
- ✅ **Onboarding flow** — 3-state chip grid (uses shared `CategoryChipGrid`). Min 3 selected
- ✅ **`isOnboarded` gate** — Dashboard redirects to Onboarding
- ✅ **Sign-out preserves stability** — Clears AsyncStorage → new anonymous session → fresh profile

### Screens & Navigation
- ✅ **Dashboard** — Hero+row layout, stats pill, focus refetch guard (A5), queue shuffle (A5), `onSnapshot` listener
- ✅ **Settings** — ScrollView, __DEV__ gate for Developer Options, sections: Account / Library / Preferences / Support
- ✅ **History screen** — 24-line wrapper over `ArticleListScreen` + `getSeenArticleMetas(30)`
- ✅ **Saved Reads screen** — 24-line wrapper over `ArticleListScreen` + `getSavedArticleMetas`
- ✅ **CategoryPreferences** — Uses `CategoryChipGrid` + `useUser()`; auto-saves on tap
- ✅ **DashboardStats** — Select ≤3 stats for dashboard pill; uses `useUser()`
- ✅ **AccountScreen** — Google link/unlink, sign out, reset, delete; uses `useUser()`
- ✅ **Theme system** — Light/dark/system; pre-compiled WebView CSS; AsyncStorage + Firestore dual persistence
- ✅ **All 11 screens use safe area insets** — Dynamic `useSafeAreaInsets()` via `SafeAreaProvider`

### Category Reorganisation
- ✅ **6 legacy → 9 new categories** — Politics, Business, Finance, Technology, Science, History, Culture, Lifestyle, Entertainment
- ✅ **42 verified full-RSS feeds** — Stealth curl-validated, ≥70% full-article text
- ✅ **Cleanup script** — `firebase/scripts/oneoff/cleanupOldCategories.js`

### Build & Foundation
- ✅ **babel.config.js + metro.config.js** — Standard Expo SDK 57 configs
- ✅ **Functions tsconfig** — Standalone Node.js config (not extending expo base — F3)
- ✅ **.env.example** — Documents all `EXPO_PUBLIC_*` vars
- ✅ **Firebase config env-var support** — `firebase.ts` reads from env with hardcoded production fallback
- ✅ **SafeAreaProvider** — Wraps entire app tree

### Account Management
- ✅ **Native Google Sign-In** — `@react-native-google-signin/google-signin` with lazy import (Expo Go safe)
- ✅ **Cross-device seen article dedup** — AsyncStorage primary + Firestore `arrayUnion`
- ✅ **Sign Out** — Clears `@subtick_*` → signOut → anonymous → fresh profile
- ✅ **Reset Account** — `resetAccount` CF: deletes subcollections, resets profile, forces re-onboarding
- ✅ **Delete Account** — `deleteAccount` CF: requires `confirmation: 'DELETE'`, permanent
- ✅ **`isActive` soft-delete** — Default true; set false in Firestore console to disable
- ✅ **Credential recovery after sign-out** — Catches `auth/credential-already-in-use`, falls back to `signInWithCredential`
- ✅ **Mid-session UID change remount** — React key bump on RootNavigator
- ✅ **Orphan cleanup** — `deleteOrphanProfile` CF uses Admin SDK to bypass `allow delete: if false`

### Refactoring (Batches 1–3)
- ✅ **Fabric crash fix** — `cardStyleInterpolator` → `presentation: 'modal'` in RootNavigator (debug-only crash)
- ✅ **Shared AsyncStorage mutex** — `createStorageMutex()` factory in `asyncStorageMutex.ts`; used by behaviorSync + feedService
- ✅ **ErrorBoundary** — Class component wrapping RootNavigator; "Something went wrong" + Try Again
- ✅ **OnboardingScreen type fix** — Removed `any` navigation prop; uses typed `useNavigation`
- ✅ **DashboardStatsScreen header fix** — Added `paddingTop: topInset`
- ✅ **CategoryChipGrid** — Shared 3-state selector; used by Onboarding + CategoryPreferences
- ✅ **ArticleListScreen** — Shared offline list; used by History + SavedReads (24 lines each)
- ✅ **UserContext** — `useUser()` hook replaces per-screen `fetchUserProfile()` in Settings, Account, DashboardStats, CategoryPreferences
- ✅ **ReaderScreen decomposition** — 1,098 → 430 lines as orchestrator; 5 feature hooks/components under `src/features/reader/`

---

## 2. Designed / Partially Built — Incomplete

### Feed Request Review Workflow (Admin Side Only)
- **Status:** Submission complete. Review/approval not implemented. Requests accumulate as `status: 'pending'`.

---

## 3. Confirmed Absent (Gaps)

- **No automated tests** — No jest/vitest/testing-library
- **No push notifications** — No `expo-notifications` or FCM
- **No analytics / error tracking** — Console logging only
- **No cross-device saved HTML sync** — Saved article metadata syncs to Firestore, full HTML is device-local
- **No content moderation** — Paywall detection only
- **No rate limiting on `syncBehaviorEvents`** — Per-user per-article dedup only within single batch
- **No pull-to-refresh** — Feed refresh by navigation focus + queue depletion only

---

## 4. Known Future Work

1. **Configure Google Sign-In client IDs** — Native Google Sign-In is implemented. Needs OAuth client IDs from Google Cloud Console.
2. **Add trending score rate limiting** — Cross-session dedup for `syncBehaviorEvents`
3. **Build feed request admin workflow** — Cloud Function trigger or admin UI
4. **Add automated tests** — Scoring formula, weight update math, behavior classification, paywall detection
5. **Candidate pool document size limit** — At ~1,250 articles, `system/candidatePool_current` approaches 1 MB. Strip to essential fields or migrate to subcollection.
6. **Dashboard infinite scroll** — Only 3 of 30 fetched articles shown; rest via Discover button
7. **Run `backfillRandomScore.js` once** — Assign `random_score` to all pre-existing articles
8. **ReaderScreen decomposition** — ✅ Done (Batch 3)
9. **Shared component extraction** — ✅ Done (Batch 2: CategoryChipGrid, ArticleListScreen)
10. **UserContext** — ✅ Done (Batch 2)
11. **Service file splits** — Deferred (high risk, low benefit currently)
12. **Theme preference cross-device sync** — `themePreference` written to Firestore but ThemeContext only reads from AsyncStorage
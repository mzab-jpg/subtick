# Tangent — Progress & Status

> **Last verified:** 16 August 2026 (launch-ready recommendation attribution and personalization-health analytics update).
> All status claims are based on reading the actual code.

---

## 1. Fully Implemented & Working

### Security
- ✅ **XSS prevention in Reader** — `escapeHtml()` in ReaderScreen correctly escapes RSS metadata
- ✅ **User profile field whitelist (create + update)** — Firestore rules restrict both to safe fields (A4 + S2)
- ✅ **feed_requests / feedback schema validation** (S3/S4) — URL format, field schema, size caps
- ✅ **behavior-events validation** (S5 + A4) — Direct-write path match, 11-type whitelist, field whitelist, 2KB cap; callable also validates raw telemetry before persistence
- ✅ **Firestore indexes deployed** — `firebase.json` points to `firestore.indexes.json` (6 composite indexes)
- ✅ **Protected Control Dashboard mutations** — Server-held `CONTROL_DASHBOARD_SECRET` is required for live config changes, preview publishing, and feed addition; it is never stored by the browser
- ✅ **syncBehaviorEvents input cap** — Server-side 100-event limit prevents overflow (was 50, doubled to support larger batch tests) (A4)
- ✅ **ErrorBoundary** (Batch 1) — Render crash safety net wrapping RootNavigator
- ✅ **Google Sign-In security** — `request.auth.uid` enforced; client userId ignored; lazy import in Expo Go
- ✅ **Google Sign-In production log silence** — `console.log` calls gated behind `__DEV__` checks in `linkGoogleAccount()`
- ✅ **GA_API_SECRET** — Stored in Cloud Secret Manager; `.trim()` applied to strip trailing CRLF from Secret Manager values

### Core Feed Pipeline
- ✅ **RSS ingestion** — `rssCollector.ts` every 3h, batch-checks existence with `db.getAll()` (C3); protected dashboard feed-add validates HTTPS RSS/Atom input, rejects duplicates, writes an active directory record, and runs the same collector immediately
- ✅ **Delta-driven archive update** — Queries only `rssStatus == 'current'` per feed (C4)
- ✅ **OG metadata fallback scraper** — `fetchOgMetadata()` extracts og:image/description/author (6s timeout)
- ✅ **Paywall detection** — Three-layer: keywords, CSS class patterns, script patterns
- ✅ **Dual candidate pool cron** — Random threshold R, 4 capped queries (~2,000 reads/run). Box 1 (current) + Box 2 (mixed)
- ✅ **random_score field** — Assigned on ingestion, refreshed daily at zero extra cost
- ✅ **Trending score decay cron** — Daily ×0.9057 for scores > 1.0 (C1, ~70% write reduction)
- ✅ **Old article cleanup cron** — Every 3 days: delete paywalled + query 500 worst-scoring articles by peakTrendingScore ASC, delete bottom 3% (fixed 500-read ceiling, composite index)
- ✅ **peakTrendingScore tracking** — All-time high, never decays, same batch as trendingScore update
- ✅ **Like/Unlike and Save/Unsave toggle** — Negative increments + per-user per-article dedup
- ✅ **Normalized 4-component ranked feed** — All components [0,1]; two formulas (fullScore + tailScore). Diversity enforced by hard per-publisher cap of 5 during assembly.
- ✅ **Tranche-based feed assembly** — 3 buckets: High/Mid random, Tail sorted by T+R; configurable category maximum/minimum-distinct safeguards apply when eligible alternatives exist; final category-aware interleave avoids a third same-category card whenever an alternative remains.
- ✅ **Dynamic publisher quality** — `publishers` collection, 10-min TTL cache (C5), atomic increments
- ✅ **Archive-safe feed retrieval** — The archived-article preference is honored by the normal candidate pool, backend on-the-fly fallback and cache, final server filter, and phone-side Functions-outage fallback; current-only client fallback uses the `isPaywalled + rssStatus + publishDate` index
- ✅ **Idempotent event sync** — `event.id` as Firestore doc ID
- ✅ **Launch-ready recommendation attribution** — Each ranked article has a transient feed/impression ID; Reader actions retain it, allowing BigQuery to connect one exact recommendation appearance to its later outcome. Feed analytics also record reporting-only user stage, profile concentration, and discovery flags.
- ✅ **Firestore write optimizations** — Skip swipe_next, batch peakTrendingScore, aggregate publisher writes (~34–52% reduction)

### Personalization & Learning
- ✅ **Backend-authoritative reading sessions** — Client sends raw `read_session` telemetry; backend validates it, applies live Dashboard thresholds, and stores the final read outcome. Legacy read-family events are reclassified during rollout; explicit Like/Save/Not Interested actions are preserved.
- ✅ **Personalized server WPM classification** — Backend reads the authenticated profile's `averageWpm` once per sync batch rather than using fixed 200 WPM.
- ✅ **Quick-exit double-fire fix** — Shared `sessionSnapshotRef` prevents duplicate raw session reports; cleanup retains latest scroll depth and rendered word count.
- ✅ **Background pause protection** — React Native `AppState` excludes `inactive`/`background` intervals from normal, explicit-action, and cleanup session durations, preventing interruption time from corrupting WPM or reading-time statistics.
- ✅ **AsyncStorage behavior queue** — 500-item cap, mutex-serialized (via shared `asyncStorageMutex`) (B6)
- ✅ **Flush race condition fixed** — Same mutex for read/write; network outside mutex (B6)
- ✅ **Offline sync with retry** — `offlineManager.ts`, 30s cooldown
- ✅ **Watermark-based weight update** — `weightUpdatedAt` prevents replay; separate `weightsDecayedAt` applies the configured daily decay for every full elapsed day across category, length, and publisher preferences.
- ✅ **Repeated quick-exit learning** — A single quick exit remains neutral. Distinct quick exits in one category accumulate only within the configurable time window; meeting the configurable threshold applies the existing `feedback.quick_exit` value once to that category only. Positive reads/Likes/Saves clear pending evidence.
- ✅ **Publisher cold-start balance** — No stored interaction for a publisher uses configurable 90% category / 10% publisher personalization; any stored publisher weight uses normal 60% / 40% weighting. A known negative publisher remains known and is not treated as unknown.
- ✅ **WPM calibration** — Starts at 200; qualifying deep reads use rendered words first, safe stored-count fallback second, accept only 150–750 WPM, and update with an 80% old / 20% new rolling average. Stored-count fallback is skipped for truncated feeds.
- ✅ **Reading streak & weekly count** — `updateReadStats()` persists read/streak statistics; `UserContext` calculates the displayed weekly count from each user's actual rolling seven-day qualifying events so inactive users' old reads age out correctly.

### Reader Experience
- ✅ **Live RSS article fetching** — `fetchAndExtractArticle()` with 15s timeout + Promise-level session cache
- ✅ **Two-mode rendering** — Clean (sanitized HTML) vs Raw (archived URL). Automatic based on `rssStatus`
- ✅ **RSS failure persistence** — AsyncStorage flag; future loads skip immediately
- ✅ **HTML injection prevention** — `escapeHtml()` on title, publicationName, author (S1)
- ✅ **Theme changes no reload** — CSS injected via `injectJavaScript()` (B9)
- ✅ **Real-time preloader** — Triggers at 5 remaining; non-blocking behavior-event flush
- ✅ **Background prefetcher** — Short four-article look-ahead window processed sequentially, immediate-next first, with cancellation when the Reader moves or closes.
- ✅ **HUD with auto-hide** — BlurView, 2.5s auto-hide, article title with `ellipsizeMode="tail"`, hidden on initial load (A5)
- ✅ **Edge-zone PanResponder swipes** — 45px zones, 40px threshold, 200ms pause detection
- ✅ **Right-swipe in history/saved modes** — Correctly calls `goToPrev()` (B5)
- ✅ **WebView navigation lock** — External links → OS browser; archived mode allows same-domain
- ✅ **Scroll progress bar** — Plain React state with percentage strings (Fabric-safe)
- ✅ **Per-publisher frontend rules** — `removeCss` + `injectCss` in both modes
- ✅ **Mock/Sandbox mode** — Reader accepts `mockArticle` (loads live URL in WebView)
- ✅ **Swipe-back gesture on Reader** — `gestureEnabled: true` for horizontal edge-swipe dismiss (doesn't conflict with vertical article swipes)

### Auth & Onboarding
- ✅ **Anonymous auth** — Reuses existing session
- ✅ **User profile bootstrap** — `ensureUserProfile()` creates default profile with neutral weights
- ✅ **Onboarding flow** — 3-state chip grid (uses shared `CategoryChipGrid`). Users may select interests, mark dislikes, or skip for a broad first feed. Onboarding saves directly before navigation, shows a saving state, and remains available with a retry message if saving fails.
- ✅ **`isOnboarded` gate** — Dashboard redirects to Onboarding only when the centrally subscribed profile is not complete.
- ✅ **Sign-out preserves stability** — Clears AsyncStorage → new anonymous session → fresh profile

### Screens & Navigation
- ✅ **Dashboard** — Hero+row layout, stats pill, focus refetch guard (A5), queue shuffle (A5); receives one shared real-time profile source from `UserContext`.
- ✅ **Settings** — ScrollView, __DEV__ gate for Developer Options, sections: Account / Library / Preferences / Support
- ✅ **History screen** — 24-line wrapper over `ArticleListScreen` + `getSeenArticleMetas(30)`
- ✅ **Saved Reads screen** — 24-line wrapper over `ArticleListScreen` + `getSavedArticleMetas`
- ✅ **CategoryPreferences** — Uses `CategoryChipGrid` + `useUser()`; auto-saves on tap
- ✅ **DashboardStats** — Select ≤3 stats for dashboard pill; uses `useUser()`
- ✅ **AccountScreen** — Google link/unlink, sign out, reset, delete; uses `useUser()`
- ✅ **FeedbackScreen** — Thin wrapper over shared `FormScreen`; submit to Firestore `feedback`
- ✅ **FeedRequestScreen** — Thin wrapper over shared `FormScreen`; submit to Firestore `feed_requests`
- ✅ **Theme system** — Light/dark/system; pre-compiled WebView CSS; AsyncStorage + Firestore dual persistence
- ✅ **All 11 screens use safe area insets** — Manual `topInset` / `bottomInset` from `src/utils/safeArea.ts` (avoids `react-native-safe-area-context` Fabric crash on RN 0.86)

### Category Reorganisation
- ✅ **6 legacy → 9 new categories** — Politics, Business, Finance, Technology, Science, History, Culture, Lifestyle, Entertainment
- ✅ **42 verified full-RSS feeds** — Stealth curl-validated, ≥70% full-article text
- ✅ **Cleanup script** — `firebase/scripts/oneoff/cleanupOldCategories.js`

### Analytics Logging (GA4 via Measurement Protocol)
- ✅ **`firebase/functions/src/analytics.ts`** — `sendGAEvents()` + `sendGAUserProperties()` helpers targeting GA4 Web stream (`measurement_id` URL param, `client_id` body field). Auto-chunks at 25 events/request. `GA_DEBUG` mode hits `/debug/mp/collect` and logs `validationMessages`. API secret `.trim()` strips trailing CRLF from Secret Manager values (was silently dropping events).
- ✅ **`article_shown` event** — Logged per article in `getRankedFeed.ts`: tranche, dominant_component, all 4 component scores (P/T/R/Q), final_score, position.
- ✅ **`feed_generated` event** — Logged once per feed call: tranche counts, distinct publisher + category counts.
- ✅ **`weight_updated` event** — Logged per weight change in `weightUpdater.ts`: entity_type, entity_id, old_value, new_value, trigger.
- ✅ **`config_changed` event** — Logged in `updateScoringConfig` (index.ts) every time `system/scoringConfig` is written.
- ✅ **`updateScoringConfig` Cloud Function** — Writes to `system/scoringConfig` + logs `config_changed` analytics event.
- ✅ **User behavior events** — `read_thorough`, `quick_exit`, `swipe_not_interested`, `save` logged in `syncBehaviorEvents.ts`.
- ✅ **User properties** — `concentration_score`, `top_cat_weight`, `cats_at_ceiling` set after each weight update via Measurement Protocol.
- ✅ **`getClientId()`** (`src/services/firebase.ts`) — Generates/caches stable `XXXXXXXXXX.XXXXXXXXXX` dotted format per device install in AsyncStorage at `@subtick_app_instance_id`; passed as `client_id` in all callable payloads. Legacy 32-hex UUIDs converted deterministically on server by `resolveClientId()`.
- ✅ **`session_id`** — `Math.floor(Date.now() / 1000)` added to all events for Realtime compatibility.
- ✅ **Payload validated** — All chunks confirmed `validated OK (no issues)` via GA4 debug endpoint before production deploy.
- ✅ **Secrets management** — `GA_API_SECRET` in Google Cloud Secret Manager; `GA_MEASUREMENT_ID` in `firebase/functions/.env`. Neither hardcoded.
- ✅ **GA4 custom dimensions & metrics** — 9 dimensions (tranche, publisher_id, category_id, etc.) + 11 metrics (score_p, score_t, etc.) registered in GA4 Admin for Explore.
- ✅ **Personalization-health reporting contract** — Post-deployment production events carry exact recommendation IDs and a server-derived environment. `firebase/analytics/create_personalization_health_view.sql` supplies the one-row-per-impression BigQuery source; `docs/analytics-looker-guide.md` specifies the Looker setup.

### Build & Foundation
- ✅ **babel.config.js + metro.config.js** — Standard Expo SDK 57 configs
- ✅ **Functions tsconfig** — Standalone Node.js config (not extending expo base — F3)
- ✅ **.env.example** — Documents all `EXPO_PUBLIC_*` vars
- ✅ **Firebase config env-var support** — `firebase.ts` reads from env with hardcoded production fallback
- ✅ **SafeAreaProvider** — Wraps entire app tree
- ✅ **firebase/functions/.env** — `GA_MEASUREMENT_ID=G-4B3N8C8MR3`, `GA_DEBUG=false`
- ✅ **Unused package removed** — `react-native-safe-area-context` removed from `package.json` (replaced by manual `safeArea.ts`)

### Account Management
- ✅ **Native Google Sign-In** — `@react-native-google-signin/google-signin` with lazy import (Expo Go safe)
- ✅ **Cross-device seen article dedup** — AsyncStorage primary + Firestore `arrayUnion`
- ✅ **Sign Out** — Clears `@subtick_*` → signOut → anonymous → fresh profile
- ✅ **Reset Account** — Deletes known subcollections in retry-safe batches, resets profile, forces re-onboarding
- ✅ **Delete Account** — Requires `confirmation: 'DELETE'`; deletes known subcollections in retry-safe batches before profile/Auth deletion
- ✅ **`isActive` soft-disable** — Server/admin-only after initial profile creation; normal feed and behavior callables reject disabled profiles
- ✅ **Credential recovery after sign-out** — Catches `auth/credential-already-in-use`, falls back to `signInWithCredential`
- ✅ **Mid-session UID change remount** — React key bump on RootNavigator
- ✅ **Orphan cleanup** — `deleteOrphanProfile` CF uses Admin SDK to bypass `allow delete: if false`

### Refactoring (Batches 1–3 + Gap Fixes)
- ✅ **Fabric crash fix** — `cardStyleInterpolator` → `presentation: 'modal'` in RootNavigator (debug-only crash)
- ✅ **Shared AsyncStorage mutex** — `createStorageMutex()` factory in `asyncStorageMutex.ts`; used by behaviorSync + feedService
- ✅ **ErrorBoundary** — Class component wrapping RootNavigator; "Something went wrong" + Try Again
- ✅ **OnboardingScreen type fix** — Removed `any` navigation prop; uses typed `useNavigation`
- ✅ **DashboardStatsScreen header fix** — Added `paddingTop: topInset`
- ✅ **CategoryChipGrid** — Shared 3-state selector; used by Onboarding + CategoryPreferences
- ✅ **ArticleListScreen** — Shared offline list; used by History + SavedReads (24 lines each)
- ✅ **FormScreen** — Shared form wrapper; used by Feedback + FeedRequest (thin wrappers)
- ✅ **UserContext** — One authenticated real-time profile subscription shared by Dashboard, Settings, Account, DashboardStats, CategoryPreferences, and Reader; also owns the user-scoped rolling seven-day read count.
- ✅ **ReaderScreen decomposition** — 1,098 → 430 lines as orchestrator; 5 feature hooks/components under `src/features/reader/`
- ✅ **Cleanup cron sampling** — Fixed 500-read ceiling via `orderBy('peakTrendingScore', 'asc').limit(500)` + composite index
- ✅ **Dead code removal** — Removed unused `getSeenArticleIds()` from `feedService.ts`; removed unused `react-native-safe-area-context` from `package.json`
- ✅ **Reader swipe-back gesture** — Enabled `gestureEnabled: true` (horizontal edge-swipe dismiss)
- ✅ **Google Sign-In log silencing** — `console.log` calls in `linkGoogleAccount()` gated behind `__DEV__`

---

## 2. Designed / Partially Built — Incomplete

### Feed Request Review Workflow (Admin Side Only)
- **Status:** Submission complete. Review/approval not implemented. Requests accumulate as `status: 'pending'`.

### Personalization Health Reporting
- **Status:** GA4 → BigQuery export is linked at `analytics_545741262`. Existing dashboard views expose raw ranking fields. The new canonical recommendation-to-outcome view is supplied in `firebase/analytics/create_personalization_health_view.sql`; it needs a one-time run in BigQuery Console because the connected MCP service account is read-only. Looker instructions are in `docs/analytics-looker-guide.md`.

---

## 3. Confirmed Absent (Gaps)

- **No full automated test framework** — No Jest/Vitest/testing-library suite. Focused Node regression scripts exist for backend classification and the unified simulator, but emulator integration coverage remains limited.
- **No push notifications** — No `expo-notifications` or FCM
- ~~**No analytics / error tracking**~~ — ✅ GA4 analytics implemented via Measurement Protocol (see Analytics Logging section)
- **No cross-device saved HTML sync** — Saved article metadata syncs to Firestore, full HTML is device-local
- **No content moderation** — Paywall detection only
- **No rate limiting on `syncBehaviorEvents`** — Per-user per-article dedup only within single batch
- **No pull-to-refresh** — Feed refresh by navigation focus + queue depletion only

---

## 4. Known Future Work

1. **Configure Google Sign-In client IDs** — Native Google Sign-In is implemented. Needs OAuth client IDs from Google Cloud Console.
2. **Add trending score rate limiting** — Cross-session dedup for `syncBehaviorEvents`
3. **Build feed request admin workflow** — Cloud Function trigger or admin UI
4. **Expand automated tests** — Focused backend classification regression test exists (`firebase/scripts/test-classification.js`); broader scoring, weight-update, and paywall coverage is still needed.
5. **Candidate pool document size limit** — At ~1,250 articles, `system/candidatePool_current` approaches 1 MB. Strip to essential fields or migrate to subcollection.
6. **Dashboard infinite scroll** — Only 3 of 30 fetched articles shown; rest via Discover button
7. **Run `backfillRandomScore.js` once** — Assign `random_score` to all pre-existing articles
8. **ReaderScreen decomposition** — ✅ Done (Batch 3)
9. **Shared component extraction** — ✅ Done (Batch 2 + Gap #5: CategoryChipGrid, ArticleListScreen, FormScreen)
10. **UserContext** — ✅ Done (Batch 2)
11. **Service file splits** — Deferred (high risk, low benefit currently)
12. **Theme preference cross-device sync** — `themePreference` written to Firestore but ThemeContext only reads from AsyncStorage
13. **Link BigQuery export** — GA4 → BigQuery integration for SQL-queryable raw event data; streaming export recommended for rapid iteration (minimal cost)
14. **Build analytics dashboards** — Looker Studio or in-app dashboard once BigQuery data is flowing
15. **Short-term session mood** — Deferred design: recent meaningful behavior would modestly influence only the next newly generated feed, never reorder an existing Reader queue or overwrite long-term weights. It should reuse existing feedback strengths and later expose only a recent-window, minimum-signal, and capped-influence setting.
16. **Lightweight personalized fallback feed** — Deferred design: when the ranking callable fails, retain seen filtering and apply local category preference/variety plus recency tie-breaking. This must remain a small safety net, not a second client-side ranking engine.









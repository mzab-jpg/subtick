# Tangent — Technical Context

> **Last verified:** 17 August 2026 (audit hardening, reliable onboarding/startup flow, sequential Reader prefetch, rolling dashboard statistics, and highest-scoring opening-card update).
> All versions are from actual `package.json` files. All schema fields are from actual Firestore write operations in code.

---

## 0. Local Emulator Testing

A full user manual lives in [`docs/emulator/`](./emulator/README.md):

- `EMULATOR_GUIDE.md` — how to run Auth/Firestore/Functions emulators with a
  copy of production data (`firebase/start_emulators_fresh.bat` +
  `firebase/scripts/sync-prod-to-emulator.js`), and how to open the dashboard
  and matrix tools over HTTP.
- `TROUBLESHOOTING.md` — fixes for `auth/network-request-failed`,
  `Load failed: internal` (missing `GA_API_SECRET` in
  `firebase/functions/.env`), `0 articles ranked`, and wrong gcloud accounts.

---

## 1. Client Dependencies (`package.json`)

### Production Dependencies

| Package | Version | Purpose |
|---|---|---|
| `expo` | `~57.0.7` | Mobile framework (managed workflow; EAS Build) |
| `react` | `19.2.3` | UI framework (required by Expo 57) |
| `react-native` | `0.86.0` | Native bridge (required by Expo 57) |
| `firebase` | `^12.16.0` | Firestore + Auth + Functions client SDK |
| `@react-navigation/native` | `^7.3.8` | Navigation container |
| `@react-navigation/stack` | `^7.10.11` | Stack navigator |
| `react-native-webview` | `13.16.1` | In-app article rendering (sanitized HTML + raw URL modes) |
| `@react-native-async-storage/async-storage` | `2.2.0` | On-device key-value storage |
| `@react-native-community/netinfo` | `^12.0.1` | Network connectivity detection |
| `fast-xml-parser` | `^5.10.1` | JavaScript RSS XML fallback for iOS and Android builds made before the native module; Android Reader uses the local Kotlin streaming parser when available |
| `xss` | `^1.0.15` | HTML sanitization (lazy — applied to matched article only) |
| `expo-blur` | `~57.0.2` | Frosted-glass HUD effect |
| `expo-status-bar` | `~57.0.1` | Status bar control |
| `expo-modules-autolinking` | `^57.0.8` | Expo native module linking |
| `react-native-gesture-handler` | `~2.32.0` | Touch gesture system (required by React Navigation) |
| `react-native-screens` | `4.25.2` | Native screen primitives |
| `react-native-svg` | `15.15.4` | SVG rendering (required by lucide) |
| `lucide-react-native` | `^1.25.0` | Icon set |
| `@react-native-google-signin/google-signin` | `^16.x` | Native Google Sign-In for iOS/Android (used by `linkGoogleAccount()`) |

**Removed (D7 fix):** `rss-parser` was client-side dead weight — RSS parsing on the client uses `fast-xml-parser`. Removed from `package.json`.

**Removed (Gap #6b):** `react-native-safe-area-context` — replaced by manual `src/utils/safeArea.ts` constants. The package caused Fabric crashes on RN 0.86 when insets were undefined/NaN. Removed from `package.json`.

### Dev Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@types/react` | `~19.2.2` | TypeScript types |
| `typescript` | `~6.0.3` | TypeScript compiler |

### Build Config Files
- `babel.config.js` — Standard `babel-preset-expo` config
- `metro.config.js` — Standard `expo/metro-config` config

### Client Directory Structure Changes (post-refactoring)
- `src/contexts/` — Now includes `UserContext.tsx` alongside `ThemeContext.tsx`
- `src/components/` — Shared components: `ErrorBoundary.tsx`, `CategoryChipGrid.tsx`, `ArticleListScreen.tsx`, `FormScreen.tsx`, `ScreenHeader.tsx`
- `src/features/reader/` — ReaderScreen decomposition: `useArticleLoader.ts`, `useNavigationQueue.ts`, `useReaderHUD.ts`, `ReaderHUD.tsx`, `ReaderProgressBar.tsx`
- `src/services/asyncStorageMutex.ts` — Shared AsyncStorage concurrency mutex factory
- `src/services/accountTransition.ts` — Small app-wide transition coordinator that blocks old-account UI during sign-out, reset, and deletion
- `src/services/dashboardFeedCache.ts` — UID-scoped in-memory Dashboard feed cache; remounts restore current cards, and Reader removes only genuinely opened cards while background replenishment appends unseen replacements
- `modules/tangent-rss-parser/` — Source-controlled Android local Expo module. A dedicated Kotlin worker streams RSS/Atom XML, retains a bounded raw process-memory cache, and supports Reader’s rolling five-upcoming-article buffer without parsing on the React Native UI/JavaScript workload. It is autolinked by Expo; native changes require a new APK.
- `src/components/TangentToggle.tsx` — Reusable built-in-Animated, accessible binary-preference control
- Screens use `useUser()` from `UserContext`, which owns the single authenticated real-time profile subscription; Dashboard no longer retains a duplicate `onSnapshot` listener.
- `HistoryScreen.tsx` and `SavedReadsScreen.tsx` are 24-line wrappers over `ArticleListScreen`
- `FeedbackScreen.tsx` and `FeedRequestScreen.tsx` are thin wrappers over shared `FormScreen`
- `OnboardingScreen.tsx` uses shared `CategoryChipGrid` component
- `ReaderScreen.tsx` is a 430-line orchestrator delegating to 3 hooks + 2 components; Android maintains a rolling five-upcoming-article native RSS buffer using at most two speculative workers, retains only raw publisher data in process memory, and sanitizes article HTML only when displayed. The Dashboard-tapped/current article is fixed; only completed bodies inside the five unseen positions may be promoted ahead of waiting cards.
- Safe area insets via manual `topInset`/`bottomInset` constants (not `react-native-safe-area-context`)
- Dead code removed: `getSeenArticleIds()` from `feedService.ts` (replaced by `getSeenArticleIdsLocally()`)

---

## 2. Cloud Functions Dependencies (`firebase/functions/package.json`)

| Package | Confirmed by |
|---|---|
| `firebase-admin` | `index.ts:6` — `import * as admin from 'firebase-admin'` |
| `firebase-functions` | `rssCollector.ts` — `import { onSchedule } from 'firebase-functions/v2/scheduler'`; `getRankedFeed.ts` — `import { onCall } from 'firebase-functions/v2/https'` |

**Removed (D7 fix):** `sanitize-html` and `uuid` were listed but had zero imports in the functions codebase.

All functions use **Firebase Functions v2 API** (v2 `onCall`, v2 `onSchedule`), running on Cloud Run. TypeScript config targets ES2022 with NodeNext module resolution and strict mode enabled. The `tsconfig.json` no longer incorrectly extends `expo/tsconfig.base` (F3 fix).

---

## 3. Cloud Functions Exported

From `firebase/functions/src/index.ts`:

| Export | Type | Trigger | Description |
|---|---|---|---|
| `rssCollector` | Scheduled | Every 3 hours | Fetches 42 RSS feeds, batch-checks article existence, writes new articles to Firestore |
| `cronUpdateCandidatePool` | Scheduled | Every 6 hours | Builds `system/candidatePool_current` and `candidatePool_mixed` |
| `cronDecayTrendingScores` | Scheduled | Every 24 hours | Applies `trendingScore × 0.9057` to all articles with score **> 1.0** (raised from 0.1 — C1 fix) |
| `cronCleanupOldArticles` | Scheduled | Every 3 days | Step 1: Delete all paywalled articles. Step 2: Query 500 worst-scoring articles >3 months old by `peakTrendingScore` ASC (composite index), delete bottom 3% of sample. Fixed 500-read ceiling. |
| `getRankedFeed` | HTTPS Callable | On demand | Returns personalized 30-article feed for authenticated user. Sends `article_shown` + `feed_generated` analytics events via Measurement Protocol. |
| `syncBehaviorEvents` | HTTPS Callable | On demand | Validates a behavior-event batch; classifies raw `read_session` and legacy read-family telemetry server-side using active config plus authenticated profile WPM; stores final event types; then updates trendingScore, publisher quality, user weights, and peakTrendingScore. Publisher list cached with 10-min TTL. Sends final behavior, `weight_updated`, and user-property analytics. |
| `updateScoringConfig` | HTTPS Callable | On demand | Requires the server-held Control Dashboard secret; writes clamped configuration to `system/scoringConfig` and sends `config_changed` analytics. |
| `addRssFeed` | HTTPS Callable | On demand | Requires the Control Dashboard secret; validates a unique HTTPS RSS/Atom feed, creates an active `feeds` record, then runs immediate first collection through the normal collector path. |
| `setPreviewConfig` | HTTPS Callable | On demand | Requires the Control Dashboard secret; writes a non-live scoring-config preview for the High-Fidelity Matrix. |
| `getPreviewConfig` | HTTPS Callable | On demand | Returns the current Matrix preview configuration to an authenticated caller. |
| `getScoringConfig` | HTTPS Callable | On demand | Returns effective, stored, and default scoring configuration to an authenticated caller. |
| `resetAccount` | HTTPS Callable | On demand | Deletes known user subcollections in retry-safe pages; resets profile stats, weights, and category selections to defaults; sets `isOnboarded: false` |
| `deleteAccount` | HTTPS Callable | On demand | Requires `confirmation: 'DELETE'`; deletes known user subcollections in retry-safe pages, then the profile document and Firebase Auth account. Permanent. |
| `deleteOrphanProfile` | HTTPS Callable | On demand | Deletes a stale anonymous `users/{orphanUid}` Firestore document after Google credential recovery. Uses Admin SDK to bypass `allow delete: if false` security rule. Validates caller is authenticated and orphanUid ≠ caller's own UID. |

---

## 4. Firestore Collections & Document Schemas

### Collection: `users`
**Document ID:** Firebase `auth.currentUser.uid`
**Written by:** `auth.ts` (create/onboarding/sign-out), `weightUpdater.ts` (weight updates), `SettingsScreen.tsx` (prefs/theme)
**Client-writable fields (S2 fix):** `themePreference`, `dashboardMetricIds`, `isOnboarded`, `selectedCategoryIds`, `notInterestedCategoryIds`, `includeArchivedArticles`, `lastUpdated` — all other fields are server-only writes enforced by Firestore rules.

| Field | Type | Description |
|---|---|---|
| `userId` | `string` | Matches document ID |
| `isOnboarded` | `boolean` | False until `completeOnboarding()` called |
| `isActive` | `boolean?` | Defaults `true`; soft-delete flag — set to `false` in Firestore console to disable without deleting data |
| `selectedCategoryIds` | `string[]` | Categories user selected as interested |
| `notInterestedCategoryIds` | `string[]` | Categories user marked not interested |
| `categoryWeights` | `Record<string, number>` | Learned per-category weights [0.1, 5.0] — server-only write |
| `categoryLengthWeights` | `Record<string, number>` | Learned per-`"category::lengthStyle"` weights — server-only write |
| `publisherWeights` | `Record<string, number>` | Learned per-publisher weights — server-only write |
| `weightUpdatedAt` | `number?` | Unix ms watermark — last event timestamp processed by `updateWeights()` |
| `weightsDecayedAt` | `number?` | Unix ms of the last preference-decay application; separate from the event watermark |
| `quickExitCategorySignals` | `Record<string, Record<string, number>>?` | Server-owned category → distinct quick-exit article ID → timestamp evidence, pruned/cleared after inference or positive engagement |
| `themePreference` | `'system'|'light'|'dark'` | User theme choice |
| `linkedGoogleAccount` | `boolean` | True after `linkGoogleAccount()` completes successfully |
| `userEmail` | `string?` | Email from linked Google account; written by `linkGoogleAccount()` |
| `seenArticleIds` | `string[]?` | Cross-device seen article dedup array (capped at 1000); written via `arrayUnion` in `markArticleSeen()` |
| `totalArticlesRead` | `number` | Incremented by `weightUpdater.ts` on qualifying reads — server-only write. The phone may temporarily display a default-rule estimate immediately after Reader exit, but the next backend profile update is final. |
| `weeklyReadCount` | `number` | Historical server-updated counter retained for compatibility. The displayed Dashboard value is calculated from the user's actual `read_thorough`/`read_skim` events in the rolling last seven days, so it remains accurate as events age out. |
| `currentStreakDays` | `number` | Consecutive days with at least one read — server-only write |
| `lastReadDate` | `number` | Unix ms of last read event |
| `averageWpm` | `number` | Personalized rolling 80/20 reading-speed average; initialized to 200. Updated from positive article word count ÷ active foreground time on Reader exit, independent of scroll depth/read classification; server persists the final value. |
| `dashboardMetricIds` | `string[]` | Up to 3 metric IDs for Dashboard stats pill |
| `includeArchivedArticles` | `boolean?` | User opt-in to `candidatePool_mixed` and to the Reader's raw publication-WebView fallback after a current RSS extraction fails |
| `totalReadTimeMs` | `number?` | Cumulative active reading time (ms) — server-only write. Reader close immediately attempts normal session sync so this profile value normally updates before Dashboard returns; offline classification remains pending until reconnect. |
| `lastUpdated` | `number` | Unix ms of last profile write |

### WPM and Publisher Cold-Start Configuration

The server loads `system/scoringConfig`, merges it over compiled defaults, clamps numeric values, and caches the effective configuration for about 60 seconds per warm Function instance. Relevant defaults are:

| Setting | Default | Purpose |
|---|---:|---|
| `classification.quickExitDepth` | `0.20` | Below this depth plus a short session is a quick exit |
| `classification.quickExitTimeoutSec` | `15` | Quick-exit duration threshold in seconds |
| `classification.thoroughDepth` | `0.70` | Minimum deep-read depth used for classification and WPM eligibility |
| `classification.thoroughTimeFraction` | `0.60` | Fraction of WPM-based expected time required for thorough classification |
| `classification.shallowDepth` | `0.40` | Minimum depth for shallow classification |
| `scoring.publisherColdStartCategoryWeight` | `0.90` | Category share for a publisher with no stored user history |
| `scoring.publisherColdStartPublisherWeight` | `0.10` | Publisher share for a publisher with no stored user history |
| `learning.repeatedQuickExitThreshold` | `3` | Distinct quick exits in one category before weak category-only learning is inferred |
| `learning.repeatedQuickExitLookbackDays` | `14` | Recent window used to count those quick exits |
| `tranche.maxArticlesPerCategory` | `15` | Category selection cap when eligible alternatives can fill the feed |
| `tranche.minDistinctCategories` | `4` | Desired category variety when eligible alternatives exist |

The two cold-start shares are normalized to total 1.0. Once `publisherWeights` has any property for a publisher—including a negative one—the normal 0.60 category / 0.40 publisher blend applies.

Feed assembly reserves the highest-scoring eligible article in its normal tranche allocation and returns it at position 0 for the Dashboard hero. The remaining selected cards use the fixed display-order anti-fatigue guard after tranche selection: it avoids a third consecutive article from the same category whenever any other category remains. This is deliberately not a scoring-config slider; scoring, tranche membership, discovery allocation, and the publisher cap remain unchanged.

Reader timing uses the built-in React Native `AppState` API (no Expo package). `inactive` and `background` intervals are excluded from a Reader session; only `active` foreground time is sent as `sessionDuration`. This protects WPM calibration, server read classification, and total reading-time statistics from phone interruptions.


**Note:** `totalArticlesSaved` and `totalArticlesLiked` fields have been removed — they were initialized to 0 but never incremented anywhere in the codebase (A2 fix).

**Client-writable fields (create):** All 18 initial profile fields written by `ensureUserProfile()`.
**Client-writable fields (update):** `themePreference`, `dashboardMetricIds`, `isOnboarded`, `selectedCategoryIds`, `notInterestedCategoryIds`, `includeArchivedArticles`, `seenArticleIds`, `userEmail`, `linkedGoogleAccount`, `categoryWeights`, and `lastUpdated`. Stats and the administrative `isActive` flag are server-only.
**Security:** Owner-only read. Delete disabled (`allow delete: if false`). The server denies normal feed/behavior actions for profiles where `isActive` is false. Secure orphan-profile cleanup is deferred to the documented server-only retention design in `docs/audit-backlog.md`.

---

### Sub-collection: `users/{userId}/behavior_events`
**Document ID:** `event.id` (client-generated — used for idempotent retries)
**Written by:** `syncBehaviorEvents.ts`

| Field | Type | Description |
|---|---|---|
| `articleId` | `string` | Article the event relates to |
| `userId` | `string` | Owning user (overwritten server-side from `request.auth.uid`; validated by security rule to match path userId — S5 + A4 fix) |
| `eventType` | `BehaviorEventType` | Client may submit raw `read_session`; callable persists a final concrete outcome. The direct-write rules whitelist 11 types for schema parity. |
| `timestamp` | `number` | Unix ms |
| `articleCategory` | `string` | e.g. `"Politics"` |
| `lengthStyle` | `string` | `'short'|'medium'|'long'` |
| `sessionDuration` | `number` | Ms spent in article |
| `scrollDepth` | `number` | Max scroll 0.0–1.0 |
| `publicationName` | `string?` | Publisher name (for weight learning) |
| `actualWordCount` | `number?` | Live word count from WebView JS (for WPM) |
| `feedId` / `impressionId` | `string?` | Transient ranked-feed attribution IDs retained with Reader-originated actions; server-written and validated |

**Client-submittable event types:** `'read_session' | 'swipe_next' | 'swipe_not_interested' | 'like' | 'unlike' | 'save' | 'unsave' | 'read_thorough' | 'read_skim' | 'read_shallow' | 'quick_exit'`.

`read_session` is raw telemetry only: the callable validates it and writes a final `'quick_exit' | 'read_shallow' | 'read_skim' | 'read_thorough' | 'swipe_next'` type. On normal Reader close the app waits until this raw event is locally queued, then immediately attempts its usual authenticated flush; it never locally declares the session a completed read. Legacy read-family types are reclassified while old app versions remain in use; explicit action types are unchanged. `feedId` and `impressionId`, when supplied by the live Reader queue, are validated and persisted with the final event so GA4/BigQuery can attribute the outcome to one exact recommendation appearance.

**Security:** The normal mobile path is the authenticated callable, which overwrites userId and validates IDs, strings, finite timestamps/duration/depth, depth [0,1], duration ≤24h, and optional word count ≤1,000,000 before Admin-SDK persistence. Owner-only direct create/read remains rule-limited: path userId must match body userId, eventType is one of 11 whitelisted values, only approved fields are allowed, and size is capped at 2KB. Update/delete are disabled.

---

### Analytics Export and Personalization Health

**GA4 property:** `subtick-bbd55` (`545741262`). The GA4 → BigQuery export is connected at `subtick-bbd55.analytics_545741262`; it contains GA4 intraday `events_intraday_YYYYMMDD` tables and pre-existing Looker-oriented views.

For launch-ready recommendation analysis, run `firebase/analytics/create_personalization_health_view.sql` once in BigQuery Console. It creates `v_personalization_health`, a one-row-per-impression source which joins an exact `impression_id` to later outcomes. The MCP BigQuery service account is intentionally read-only, so it cannot create that view itself. See `docs/analytics-looker-guide.md` for the report setup.

New post-deployment analytics fields are `analytics_environment`, `feed_id`, `impression_id`, `user_stage`, `prior_qualifying_reads`, `days_since_last_read`, `profile_concentration`, `is_new_publisher`, and `is_new_category`. Only `analytics_environment = 'production'` belongs in real-user reporting. Existing pre-deployment events lack exact impression attribution and are suitable only for pipeline testing.

### Collection: `articles`
**Document ID:** `article_{sha256(url::title).slice(0,16)}`
**Written by:** `rssCollector.ts` (create + archive status), `syncBehaviorEvents.ts` (trendingScore increment), `cronDecayTrendingScores` (trendingScore decay)

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Matches document ID |
| `title` | `string` | Article title |
| `author` | `string` | Author (falls back to OG scrape or 'Unknown') |
| `publicationName` | `string` | Publication name from feed config |
| `publicationUrl` | `string` | Article-level URL (`item.link`) |
| `feedUrl` | `string` | RSS feed URL |
| `category` | `string` | Category from feed config |
| `lengthStyle` | `string` | `'short'`/`'medium'`/`'long'` |
| `guid` | `string` | RSS item GUID for live RSS matching at read time |
| `isTruncatedFeed` | `boolean` | True if description/body ratio > 0.9 |
| `description` | `string` | First 300 chars of RSS snippet or OG description |
| `publishDate` | `number` | Unix ms from RSS pubDate |
| `cacheTimestamp` | `number` | Unix ms when rssCollector ran |
| `isPaywalled` | `boolean` | Result of three-layer paywall check |
| `headerImageUrl` | `string?` | OG image URL |
| `wordCount` | `number?` | Estimated word count |
| `estimatedReadMinutes` | `number` | Generic ingestion-time `ceil(wordCount / 250)`, minimum 1; active Dashboard/Reader views calculate their own personalized estimate from `averageWpm` |
| `trendingScore` | `number` | Crowd engagement accumulator; decays daily × 0.9057 for scores > 1.0 |
| `peakTrendingScore` | `number` | All-time high trendingScore, never decays; used by cleanup cron for deletion ranking (sampled query with composite index) |
| `qualityScore` | `number` | Static feed-level quality from feeds.json (0.0–1.0) |
| `isSeed` | `boolean` | true for seedFirestore.js entries; false for rssCollector |
| `rssStatus` | `'current'|'archived'?` | 'archived' if GUID dropped from live feed or the source is explicitly webpage-only. When a user has Archived Articles off, all ranked and fallback paths restrict delivery to `'current'`. |
| `frontendRules` | `{removeCss?, injectCss?}?` | Per-publisher CSS overrides |
| `bodyHtml` | `string?` | **NOT POPULATED** — legacy field only |
| `random_score` | `number` | Uniformly distributed [0, 1) random float. Assigned on ingestion, refreshed daily by `cronDecayTrendingScores`. Used by `cronUpdateCandidatePool` for cheap random sampling without full collection scans. |

**Security:** Any authenticated user can read. Create/update/delete via Admin SDK only.

---

### Collection: `feeds`
**Document ID:** `feed_{slugified_publicationName}`
**Written by:** `seedFeeds.js` (one-time setup) and the protected `addRssFeed` callable from Control Dashboard

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Matches document ID |
| `url` | `string` | RSS feed URL |
| `category` | `string` | Category string |
| `publicationName` | `string` | Human-readable name |
| `qualityScore` | `number` | Static baseline quality 0.0–1.0 |
| `isActive` | `boolean` | If false, rssCollector skips this feed |
| `forceArchived` | `boolean` | If true, all articles get `rssStatus='archived'` |
| `frontendRules` | `{removeCss?, injectCss?}?` | CSS rules copied to articles |
| `addedAt`, `addedBy` | `number`, `string` (dashboard-added feeds) | Audit information for a protected dashboard feed addition |

**Security:** Admin SDK only (default deny for client).

---

### Collection: `publishers`
**Document ID:** `sanitized(publicationName)` — `/` replaced with `-`
**Written by:** `syncBehaviorEvents.ts`
**Read by:** `getRankedFeed.ts: getOrUpdatePublisherQualities()` (10-min memory cache) and `syncBehaviorEvents.ts: getExistingPublisherIds()` (10-min memory cache — C5 fix)

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Original publication name |
| `qualityScore` | `number` | Crowd-sourced quality [0.20, 1.00]; new publishers seeded at DEFAULT (0.8) + delta |
| `lastUpdated` | `number` | Unix ms of last write |

Quality increments: `save +0.010 / like +0.005 / read_thorough +0.005 / read_skim +0.001 / swipe_not_interested -0.010 / quick_exit -0.005`

**Security:** Admin SDK only.

---

### Collection: `system`
**Document IDs:** `candidatePool_current`, `candidatePool_mixed`
**Written by:** `cronUpdateCandidatePool` (every 6 hours)
**Read by:** `getRankedFeed.ts: getOrUpdateCandidatePool()` (10-min memory cache)

| Field | Type | Description |
|---|---|---|
| `articles` | `Article[]` | Up to 1000 article objects |
| `generatedAt` | `number` | Unix ms when pool was built |

**Note:** Each document approaches Firestore's 1 MB limit at ~1,250 articles. Future mitigation: strip articles to scoring-essential fields only or migrate to subcollection.

**Security:** Admin SDK only.

---

### Collection: `feed_requests`
**Document ID:** Auto-generated by `addDoc()`
**Written by:** `FeedRequestScreen.tsx` (via shared `FormScreen`)

| Field | Type | Description |
|---|---|---|
| `userId` | `string` | Submitting user's UID (must match `auth.uid` — S3 fix) |
| `url` | `string` | Feed URL submitted (must be non-empty string ≤ 500 chars — S3 fix) |
| `description` | `string?` | Optional note |
| `timestamp` | `number` | Unix ms |
| `status` | `'pending'|'approved'|'rejected'` | Always 'pending' on create |

**Security:** Authenticated users can create/read their own. Create rule validates `userId == auth.uid`, URL format, field schema, and 2KB document size cap (S3 fix). No update/delete.

---

### Collection: `feedback`
**Document ID:** Auto-generated
**Written by:** `FeedbackScreen.tsx` (via shared `FormScreen`)
**Read by:** Admin only (no client reads)

**Security:** Any authenticated user can create. Create rule validates field schema and 5KB document size cap (S4 fix). No reads from client.

---

## 5. Firestore Indexes

From `firebase/firestore.indexes.json` — now deployed on every `firebase deploy` via the `"indexes"` pointer in `firebase.json` (C2 fix):

| Collection | Fields | Order | Purpose |
|---|---|---|---|
| `articles` | `isPaywalled`, `publishDate` | ASC, DESC | Used by the archived-enabled `fallbackGetArticles()` path |
| `articles` | `isPaywalled`, `rssStatus`, `publishDate` | ASC, ASC, DESC | Used by the archived-disabled `fallbackGetArticles()` path to fetch current RSS articles only |
| `articles` | `feedUrl`, `rssStatus` | ASC, ASC | Used by `rssCollector.ts` post-sync archive update — queries `rssStatus == 'current'` articles only (C4 fix) |
| `articles` | `isPaywalled`, `rssStatus`, `random_score` | ASC, ASC, ASC | Used by `cronUpdateCandidatePool` Box 1 queries (active articles only) |
| `articles` | `isPaywalled`, `random_score` | ASC, ASC | Used by `cronUpdateCandidatePool` Box 2 queries (any-status articles) |
| `articles` | `publishDate`, `peakTrendingScore` | ASC, ASC | Used by `cronCleanupOldArticles` sampled query — returns worst 500 old articles without reading full collection |

`weightUpdater` queries `users/{id}/behavior_events` by `timestamp >` — Firestore auto-indexes single-field subcollection queries.

---

## 6. Firebase Security Rules Summary

From `firebase/firestore.rules` (updated with S2–S5 fixes):

| Collection | Read | Write | Notes |
|---|---|---|---|
| `users/{userId}` | Owner only | Owner-only preference updates; `isActive` is server/admin-only | Delete disabled (`allow delete: false`). Normal feed and behavior callables reject inactive profiles. |
| `users/{userId}/behavior_events` | Owner only | Direct create only (owner + body userId must match + 11-type event whitelist + field whitelist including optional feed/impression IDs + 2KB cap); normal mobile sync uses the authenticated callable, which independently validates telemetry before Admin-SDK writes | Update/delete disabled |
| `users/{userId}/saved_articles` | Owner only | Create/delete (owner) | Create validates article metadata schema and bounded fields; update disabled. |
| `articles/{articleId}` | Any authenticated user | Never (Admin SDK only) | Client cannot update articles |
| `feed_requests/{id}` | Owner only | Create (validated: userId, URL format, schema, 2KB cap — S3 fix) | Update/delete disabled |
| `feedback/{id}` | Never | Create (validated: authenticated owner, message, timestamp, schema, 5KB cap) | Admin-only reads |
| Everything else | Never | Never | Default deny — covers `feeds`, `publishers`, `system` |

---

## 7. Build Configuration

### EAS Build (`eas.json`)
| Profile | Platform | Output |
|---|---|---|
| `development` | Android | APK (`developmentClient: true, distribution: internal`) |
| `preview` | Android | APK (`buildType: "apk"`) |
| `production` | All | Default (AAB for Android, IPA for iOS) |

### App Config (`app.json`)
- **Display name:** `Tangent`
- **Version:** `1.0.0`
- **Orientation:** Portrait only
- **Android package:** `com.tangent.app`
- **EAS project ID:** `4bc8bbff-9b89-4baa-8353-7bf95bd36693`
- **Expo slug/owner:** `tangent` / `tangent_mb123`
- **Predictive back gesture:** Disabled
- **iOS tablet support:** Yes

---

## 8. Development Environment

### Environment Variables
Documented in `.env.example` (F4 fix — was undocumented):

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_USE_EMULATORS` | Set to `"true"` to connect to local Firebase Emulators instead of production. Only active in `__DEV__` builds. |
| `EXPO_PUBLIC_FIREBASE_API_KEY` | Optional override for Firebase config. Falls back to hardcoded production value if unset. |
| `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | Same as above |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | Same as above |
| `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` | Same as above |
| `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Same as above |
| `EXPO_PUBLIC_FIREBASE_APP_ID` | Same as above |

### Firebase Emulator Support
Detects `__DEV__` and `EXPO_PUBLIC_USE_EMULATORS === 'true'` before connecting to local emulators. Config in `src/utils/constants.ts`:
```typescript
export const FIREBASE_EMULATOR_CONFIG = {
  auth:      { host: 'localhost', port: 9099 },
  firestore: { host: 'localhost', port: 8080 },
  functions: { host: 'localhost', port: 5001 },
};
```

### Android native RSS module build workflow

`modules/tangent-rss-parser/` contains Android Kotlin code, so a JavaScript Fast Refresh cannot add or change it in an already-installed app.

- After changing **Kotlin**, `expo-module.config.json`, native module Gradle configuration, or `app.json`, create and install a fresh Android build. For internal debugging: `eas build --platform android --profile development`.
- After changing only TypeScript/React code, the existing development APK and normal Metro/Fast Refresh workflow remain sufficient.
- Before deciding Reader performance is release-ready, install and test a non-development internal APK: `eas build --platform android --profile preview`. Development-client warning/log tooling can make scrolling feel less representative than a release-style build.
- The module fetches directly from publishers; it does not use Firebase/Cloud Functions for article bodies. It keeps up to 16 ordinary-sized raw XML feeds in Android process memory (5 MB cache allowance each), plus extracted raw bodies only for the five upcoming Reader targets—not a parsed copy of every article body. A larger legitimate feed is stream-parsed directly to the requested target and not retained, so the cache allowance never blocks an article. Android discards all cache data when the app process ends.

### Required iOS release work — native RSS parser parity

The Kotlin implementation is **Android-only**. iOS currently falls back to JavaScript `fast-xml-parser`; do not describe iOS as having the smooth Android Reader preloader.

Before any iOS release:

1. Add `modules/tangent-rss-parser/ios/` with a Swift implementation exposing the same `preloadFeed`, `findArticle`, and `clearCache` API.
2. Use `URLSession` and Foundation `XMLParser` (or another maintained streaming parser) on a non-main queue. Do not restore whole-feed JavaScript parsing as iOS background preloading.
3. Match Android semantics exactly: HTTPS-only fetches, 15-second connect/read-equivalent timeouts, separate selected/preload serial lanes, raw-XML cache for ordinary-sized feeds plus extracted raw bodies for exactly the five-upcoming Reader targets, direct streaming extraction for larger legitimate feeds without retaining them, five-upcoming-article buffer, stale-target replacement after a swipe, and lazy sanitisation only for the displayed article.
4. Run `npx expo prebuild --clean`/Pods as required after adding the Swift files, then create fresh iOS development and production-style builds. Test on a physical iPhone with multiple RSS and Atom publishers, repeated publishers, a large feed, offline mode, archived-content preference both on/off, fast swipes, app backgrounding, and app termination.
5. Keep the JavaScript fallback only as a failure-safe path; do not enable iOS RSS preloading until physical-device performance/parity testing passes.

### Developer Options Gate
`DeveloperOptionsScreen.tsx` is accessible from Settings but only rendered when `__DEV__` is true. In production builds it is completely hidden. Contains: sandbox reader, AsyncStorage reset tools. Sandbox reader now passes `mockArticle` only (loads live URL in WebView — `mockHtml` param removed as it was never needed for live-URL testing).

### One-Time Admin Scripts
Moved to `firebase/scripts/oneoff/` (D6 fix). See `firebase/scripts/oneoff/README.md` for the full list, status, and warnings about out-of-date data in some scripts.

| Script (in `firebase/`) | What it does |
|---|---|
| `seedFirestore.js` | Fetches up to 10 articles per feed, writes to `articles` collection |
| `seedFeeds.js` | Writes 42 `FeedSource` documents to `feeds` collection |
| `cleanFeeds.js` | Deletes legacy hash-ID feed documents |

| Script (in `firebase/scripts/oneoff/`) | What it does |
|---|---|
| `cleanupOldCategories.js` | **July 2026.** Deletes all articles with old category strings, strips deprecated weights from user profiles, cleans candidate pools, removes stale publishers. Run once after category migration deployment. |
| `resetTrendingScores.js` | Resets all article trending scores to 0. Uses ADC authentication. |
| `resetPublisherQualities.js` | Resets all publisher quality scores to 0.80. Uses ADC authentication. |
| `backfillRandomScore.js` | Assigns `random_score: Math.random()` to all existing articles that lack the field. Run once after deploying cost-optimisation changes. Safe to re-run. |
| `cleanupArticles.js` | One-time cleanup of malformed/duplicate articles — **SPENT** |
| `resetAndFetch.js` | ⚠️ Uses a truncated feed list (9 vs 35) — **update before any re-use** |
| `forceFetchAll.js` | ⚠️ Uses a truncated paywall keyword list (8 vs 25) — **update before any re-use** |
| `migrateUsers.js` | Migrated legacy user profile schema — **SPENT** |
| `retroCategorize.js` | Back-filled `category` field on articles — **SPENT** |
| `retroClean.js` | Removed legacy fields from articles — **SPENT** |


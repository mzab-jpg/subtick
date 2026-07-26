# Tangent — Technical Context

> **Last verified:** July 2026 against current codebase (post-cost-optimisation + full audit/fix session).
> All versions are from actual `package.json` files. All schema fields are from actual Firestore write operations in code.

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
| `fast-xml-parser` | `^5.10.1` | Client-side RSS XML parsing |
| `xss` | `^1.0.15` | HTML sanitization (lazy — applied to matched article only) |
| `expo-blur` | `~57.0.2` | Frosted-glass HUD effect |
| `expo-status-bar` | `~57.0.1` | Status bar control |
| `expo-modules-autolinking` | `^57.0.8` | Expo native module linking |
| `react-native-gesture-handler` | `~2.32.0` | Touch gesture system (required by React Navigation) |
| `react-native-safe-area-context` | `~5.7.0` | Safe area insets |
| `react-native-screens` | `4.25.2` | Native screen primitives |
| `react-native-svg` | `15.15.4` | SVG rendering (required by lucide) |
| `lucide-react-native` | `^1.25.0` | Icon set |

**Removed (D7 fix):** `rss-parser` was client-side dead weight — RSS parsing on the client uses `fast-xml-parser`. Removed from `package.json`.

### Dev Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@types/react` | `~19.2.2` | TypeScript types |
| `typescript` | `~6.0.3` | TypeScript compiler |

### Build Config Files
- `babel.config.js` — Standard `babel-preset-expo` config (F2 fix — was missing)
- `metro.config.js` — Standard `expo/metro-config` config (F2 fix — was missing)

---

## 2. Cloud Functions Dependencies (`firebase/functions/package.json`)

| Package | Confirmed by |
|---|---|
| `firebase-admin` | `index.ts:6` — `import * as admin from 'firebase-admin'` |
| `firebase-functions` | `rssCollector.ts` — `import { onSchedule } from 'firebase-functions/v2/scheduler'`; `getRankedFeed.ts` — `import { onCall } from 'firebase-functions/v2/https'` |
| `rss-parser` | `rssCollector.ts` — `import Parser from 'rss-parser'` |

**Removed (D7 fix):** `sanitize-html` and `uuid` were listed but had zero imports in the functions codebase.

All functions use **Firebase Functions v2 API** (v2 `onCall`, v2 `onSchedule`), running on Cloud Run. TypeScript config targets ES2022 with NodeNext module resolution and strict mode enabled. The `tsconfig.json` no longer incorrectly extends `expo/tsconfig.base` (F3 fix).

---

## 3. Cloud Functions Exported

From `firebase/functions/src/index.ts`:

| Export | Type | Trigger | Description |
|---|---|---|---|
| `rssCollector` | Scheduled | Every 3 hours | Fetches 35 RSS feeds, batch-checks article existence, writes new articles to Firestore |
| `cronUpdateCandidatePool` | Scheduled | Every 6 hours | Builds `system/candidatePool_current` and `candidatePool_mixed` |
| `cronDecayTrendingScores` | Scheduled | Every 24 hours | Applies `trendingScore × 0.9057` to all articles with score **> 1.0** (raised from 0.1 — C1 fix) |
| `cronCleanupOldArticles` | Scheduled | Every 3 days | Deletes bottom 3% of articles older than 3 months by peakTrendingScore |
| `getRankedFeed` | HTTPS Callable | On demand | Returns personalized 30-article feed for authenticated user |
| `syncBehaviorEvents` | HTTPS Callable | On demand | Saves behavior events batch; updates trendingScore, publisher quality, user weights, peakTrendingScore. Publisher list cached with 10-min TTL (C5 fix). |

---

## 4. Firestore Collections & Document Schemas

### Collection: `users`
**Document ID:** Firebase `auth.currentUser.uid`
**Written by:** `auth.ts` (create/onboarding), `weightUpdater.ts` (weight updates), `SettingsScreen.tsx` (prefs/theme)
**Client-writable fields (S2 fix):** `themePreference`, `dashboardMetricIds`, `isOnboarded`, `selectedCategoryIds`, `notInterestedCategoryIds`, `includeArchivedArticles`, `lastUpdated` — all other fields are server-only writes enforced by Firestore rules.

| Field | Type | Description |
|---|---|---|
| `userId` | `string` | Matches document ID |
| `isOnboarded` | `boolean` | False until `completeOnboarding()` called |
| `selectedCategoryIds` | `string[]` | Categories user selected as interested |
| `notInterestedCategoryIds` | `string[]` | Categories user marked not interested |
| `categoryWeights` | `Record<string, number>` | Learned per-category weights [0.1, 5.0] — server-only write |
| `categoryLengthWeights` | `Record<string, number>` | Learned per-`"category::lengthStyle"` weights — server-only write |
| `publisherWeights` | `Record<string, number>` | Learned per-publisher weights — server-only write |
| `weightUpdatedAt` | `number?` | Unix ms watermark — last event timestamp processed by `updateWeights()` |
| `themePreference` | `'system'|'light'|'dark'` | User theme choice |
| `linkedGoogleAccount` | `boolean` | Google provider linked (always false on mobile currently) |
| `totalArticlesRead` | `number` | Incremented by `weightUpdater.ts` on qualifying reads — server-only write |
| `weeklyReadCount` | `number` | read_thorough/skim events in last 7 days — server-only write |
| `currentStreakDays` | `number` | Consecutive days with at least one read — server-only write |
| `lastReadDate` | `number` | Unix ms of last read event |
| `averageWpm` | `number` | Rolling 80/20 average WPM; initialized to 200 — server-only write |
| `dashboardMetricIds` | `string[]` | Up to 3 metric IDs for Dashboard stats pill |
| `includeArchivedArticles` | `boolean?` | User opt-in to `candidatePool_mixed` |
| `totalReadTimeMs` | `number?` | Cumulative active reading time (ms) — server-only write |
| `lastUpdated` | `number` | Unix ms of last profile write |

**Note:** `totalArticlesSaved` and `totalArticlesLiked` fields have been removed — they were initialized to 0 but never incremented anywhere in the codebase (A2 fix).

**Security:** Owner-only read. Client update restricted to 7 whitelisted fields (S2 fix). Delete disabled.

---

### Sub-collection: `users/{userId}/behavior_events`
**Document ID:** `event.id` (client-generated — used for idempotent retries)
**Written by:** `syncBehaviorEvents.ts`

| Field | Type | Description |
|---|---|---|
| `articleId` | `string` | Article the event relates to |
| `userId` | `string` | Owning user (overwritten server-side from `request.auth.uid`; validated by security rule to match path userId — S5 + A4 fix) |
| `eventType` | `BehaviorEventType` | One of 10 types (also validated by rules against enum — A4 fix) |
| `timestamp` | `number` | Unix ms |
| `articleCategory` | `string` | e.g. `"Technology & Innovation"` |
| `lengthStyle` | `string` | `'short'|'medium'|'long'` |
| `sessionDuration` | `number` | Ms spent in article |
| `scrollDepth` | `number` | Max scroll 0.0–1.0 |
| `publicationName` | `string?` | Publisher name (for weight learning) |
| `actualWordCount` | `number?` | Live word count from WebView JS (for WPM) |

**Valid `eventType` values:** `'swipe_next' | 'swipe_not_interested' | 'like' | 'unlike' | 'save' | 'unsave' | 'read_thorough' | 'read_skim' | 'read_shallow' | 'quick_exit'`

**Security:** Owner-only create/read. Update/delete disabled. Create rule enforces: path userId matches body userId, `eventType` is one of 10 valid values, only whitelisted fields can be written, and document size capped at 2KB (S5 + A4 fix).

---

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
| `estimatedReadMinutes` | `number` | `ceil(wordCount / 250)`, minimum 1 |
| `trendingScore` | `number` | Crowd engagement accumulator; decays daily × 0.9057 for scores > 1.0 |
| `peakTrendingScore` | `number` | All-time high trendingScore, never decays; used by cleanup cron for deletion ranking |
| `qualityScore` | `number` | Static feed-level quality from feeds.json (0.0–1.0) |
| `isSeed` | `boolean` | true for seedFirestore.js entries; false for rssCollector |
| `rssStatus` | `'current'|'archived'?` | 'archived' if GUID dropped from live feed. Post-sync archive pass now uses delta query (only `'current'` articles checked per feed — C4 fix). |
| `frontendRules` | `{removeCss?, injectCss?}?` | Per-publisher CSS overrides |
| `bodyHtml` | `string?` | **NOT POPULATED** — legacy field only |
| `random_score` | `number` | Uniformly distributed [0, 1) random float. Assigned on ingestion, refreshed daily by `cronDecayTrendingScores`. Used by `cronUpdateCandidatePool` for cheap random sampling without full collection scans. |

**Security:** Any authenticated user can read. Create/update/delete via Admin SDK only.

---

### Collection: `feeds`
**Document ID:** `feed_{slugified_publicationName}`
**Written by:** `seedFeeds.js` (one-time setup)

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
**Written by:** `FeedRequestScreen.tsx`

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
**Written by:** `FeedbackScreen.tsx`
**Read by:** Admin only (no client reads)

**Security:** Any authenticated user can create. Create rule validates field schema and 5KB document size cap (S4 fix). No reads from client.

---

## 5. Firestore Indexes

From `firebase/firestore.indexes.json` — now deployed on every `firebase deploy` via the `"indexes"` pointer in `firebase.json` (C2 fix):

| Collection | Fields | Order | Purpose |
|---|---|---|---|
| `articles` | `isPaywalled`, `publishDate` | ASC, DESC | Used by `fallbackGetArticles()` in `feedService.ts` (now includes `isPaywalled == false` filter — C7 fix) |
| `articles` | `feedUrl`, `rssStatus` | ASC, ASC | Used by `rssCollector.ts` post-sync archive update — queries `rssStatus == 'current'` articles only (C4 fix) |
| `articles` | `isPaywalled`, `rssStatus`, `publishDate`, `random_score` | ASC, ASC, ASC, ASC | Used by `cronUpdateCandidatePool` Box 1 queries (active articles only) |
| `articles` | `isPaywalled`, `publishDate`, `random_score` | ASC, ASC, ASC | Used by `cronUpdateCandidatePool` Box 2 queries (any-status articles) |

`weightUpdater` queries `users/{id}/behavior_events` by `timestamp >` — Firestore auto-indexes single-field subcollection queries.

---

## 6. Firebase Security Rules Summary

From `firebase/firestore.rules` (updated with S2–S5 fixes):

| Collection | Read | Write | Notes |
|---|---|---|---|
| `users/{userId}` | Owner only | Owner only — 7 whitelisted fields (update), 8 whitelisted fields (create) (S2 + A4 fix) | Delete disabled. Create rule tightened to match update rule. |
| `users/{userId}/behavior_events` | Owner only | Create only (owner + body userId must match + eventType validated + field whitelist + 2KB cap — S5 + A4 fix) | Update/delete disabled |
| `users/{userId}/saved_articles` | Owner only | Create/delete (owner) | Update disabled; persists even if global article is deleted |
| `articles/{articleId}` | Any authenticated user | Never (Admin SDK only) | Client cannot update articles |
| `feed_requests/{id}` | Owner only | Create (validated: userId, URL format, schema, 2KB cap — S3 fix) | Update/delete disabled |
| `feedback/{id}` | Never | Create (validated: field schema, 5KB cap — S4 fix) | Admin-only reads |
| Everything else | Never | Never | Default deny — covers `feeds`, `publishers`, `system` |

---

## 7. Build Configuration

### EAS Build (`eas.json`)
| Profile | Platform | Output |
|---|---|---|
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

### Developer Options Gate
`DeveloperOptionsScreen.tsx` is accessible from Settings but only rendered when `__DEV__` is true. In production builds it is completely hidden. Contains: sandbox reader, AsyncStorage reset tools.

### One-Time Admin Scripts
Moved to `firebase/scripts/oneoff/` (D6 fix). See `firebase/scripts/oneoff/README.md` for the full list, status, and warnings about out-of-date data in some scripts.

| Script (in `firebase/`) | What it does |
|---|---|
| `seedFirestore.js` | Fetches up to 10 articles per feed, writes to `articles` collection |
| `seedFeeds.js` | Writes 35 `FeedSource` documents to `feeds` collection |
| `cleanFeeds.js` | Deletes legacy hash-ID feed documents |

| Script (in `firebase/scripts/oneoff/`) | What it does |
|---|---|
| `backfillRandomScore.js` | Assigns `random_score: Math.random()` to all existing articles that lack the field. Run once after deploying cost-optimisation changes. Safe to re-run. |
| `cleanupArticles.js` | One-time cleanup of malformed/duplicate articles — **SPENT** |
| `resetAndFetch.js` | ⚠️ Uses a truncated feed list (9 vs 35) — **update before any re-use** |
| `forceFetchAll.js` | ⚠️ Uses a truncated paywall keyword list (8 vs 25) — **update before any re-use** |
| `migrateUsers.js` | Migrated legacy user profile schema — **SPENT** |
| `retroCategorize.js` | Back-filled `category` field on articles — **SPENT** |
| `retroClean.js` | Removed legacy fields from articles — **SPENT** |
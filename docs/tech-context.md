# SubTick — Technical Context

> **Last verified:** July 2026 against current codebase (post-bugfix session).
> All versions are from actual `package.json` files. All schema fields are from actual Firestore write operations in code.

---

## 1. Client Dependencies (`package.json`)

### Production Dependencies

| Package | Version | Purpose |
|---|---|---|
| `expo` | `~57.0.6` | Mobile framework (managed workflow; EAS Build) |
| `react` | `19.2.3` | UI framework (required by Expo 57) |
| `react-native` | `0.86.0` | Native bridge (required by Expo 57) |
| `firebase` | `^12.16.0` | Firestore + Auth + Functions client SDK |
| `@react-navigation/native` | `^7.3.8` | Navigation container |
| `@react-navigation/stack` | `^7.10.11` | Stack navigator |
| `react-native-webview` | `13.16.1` | In-app article rendering (sanitized HTML + raw URL modes) |
| `@react-native-async-storage/async-storage` | `2.2.0` | On-device key-value storage |
| `@react-native-community/netinfo` | `^12.0.1` | Network connectivity detection |
| `fast-xml-parser` | `^5.10.1` | Client-side RSS XML parsing |
| `xss` | `^1.0.15` | HTML sanitization |
| `expo-blur` | `~57.0.2` | Frosted-glass HUD effect |
| `expo-status-bar` | `~57.0.1` | Status bar control |
| `react-native-gesture-handler` | `~2.32.0` | Touch gesture system (required by React Navigation) |
| `react-native-safe-area-context` | `~5.7.0` | Safe area insets |
| `react-native-screens` | `4.25.2` | Native screen primitives |
| `react-native-svg` | `^15.15.5` | SVG rendering (required by lucide) |
| `lucide-react-native` | `^1.25.0` | Icon set |

### Dev Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@types/react` | `~19.2.2` | TypeScript types |
| `typescript` | `~6.0.3` | TypeScript compiler |

---

## 2. Cloud Functions Dependencies (`firebase/functions/package.json`)

| Package | Confirmed by |
|---|---|
| `firebase-admin` | `index.ts:6` — `import * as admin from 'firebase-admin'` |
| `firebase-functions` | `rssCollector.ts` — `import { onSchedule } from 'firebase-functions/v2/scheduler'`; `getRankedFeed.ts` — `import { onCall } from 'firebase-functions/v2/https'` |
| `rss-parser` | `rssCollector.ts` — `import Parser from 'rss-parser'` |

All functions use **Firebase Functions v2 API** (v2 `onCall`, v2 `onSchedule`), running on Cloud Run. TypeScript config targets ES2022 with NodeNext module resolution and strict mode enabled.

---

## 3. Cloud Functions Exported

From `firebase/functions/src/index.ts`:

| Export | Type | Trigger | Description |
|---|---|---|---|
| `rssCollector` | Scheduled | Every 3 hours | Fetches 35 RSS feeds, writes new articles to Firestore |
| `cronUpdateCandidatePool` | Scheduled | Every 10 minutes | Builds `system/candidatePool_current` and `candidatePool_mixed` |
| `cronDecayTrendingScores` | Scheduled | Every 24 hours | Applies `trendingScore × 0.9057` to all articles with score > 0.1 |
| `getRankedFeed` | HTTPS Callable | On demand | Returns personalized 30-article feed for authenticated user |
| `syncBehaviorEvents` | HTTPS Callable | On demand | Saves behavior events batch; updates trendingScore, publisher quality, user weights |

---

## 4. Firestore Collections & Document Schemas

### Collection: `users`
**Document ID:** Firebase `auth.currentUser.uid`
**Written by:** `auth.ts` (create/onboarding), `weightUpdater.ts` (weight updates), `SettingsScreen.tsx` (prefs/theme)

| Field | Type | Description |
|---|---|---|
| `userId` | `string` | Matches document ID |
| `isOnboarded` | `boolean` | False until `completeOnboarding()` called |
| `selectedCategoryIds` | `string[]` | Categories user selected as interested |
| `notInterestedCategoryIds` | `string[]` | Categories user marked not interested |
| `categoryWeights` | `Record<string, number>` | Learned per-category weights [0.1, 5.0] |
| `categoryLengthWeights` | `Record<string, number>` | Learned per-`"category::lengthStyle"` weights |
| `publisherWeights` | `Record<string, number>` | Learned per-publisher weights |
| `weightUpdatedAt` | `number?` | Unix ms watermark — last event timestamp processed by `updateWeights()` |
| `themePreference` | `'system'|'light'|'dark'` | User theme choice |
| `linkedGoogleAccount` | `boolean` | Google provider linked (always false on mobile currently) |
| `totalArticlesRead` | `number` | Incremented by `weightUpdater.ts` on qualifying reads |
| `totalArticlesSaved` | `number` | **Not incremented anywhere — initialized to 0** |
| `totalArticlesLiked` | `number` | **Not incremented anywhere — initialized to 0** |
| `weeklyReadCount` | `number` | read_thorough/skim events in last 7 days |
| `currentStreakDays` | `number` | Consecutive days with at least one read |
| `lastReadDate` | `number` | Unix ms of last read event |
| `averageWpm` | `number` | Rolling 80/20 average WPM; initialized to 200 |
| `dashboardMetricIds` | `string[]` | Up to 3 metric IDs for Dashboard stats pill |
| `includeArchivedArticles` | `boolean?` | User opt-in to `candidatePool_mixed` |
| `totalReadTimeMs` | `number?` | Cumulative active reading time (ms) |
| `lastUpdated` | `number` | Unix ms of last profile write |

**Security:** Owner-only read/write. Delete disabled.

---

### Sub-collection: `users/{userId}/behavior_events`
**Document ID:** `event.id` (client-generated — used for idempotent retries)
**Written by:** `syncBehaviorEvents.ts`

| Field | Type | Description |
|---|---|---|
| `articleId` | `string` | Article the event relates to |
| `userId` | `string` | Owning user (overwritten server-side from `request.auth.uid`) |
| `eventType` | `BehaviorEventType` | One of 8 types |
| `timestamp` | `number` | Unix ms |
| `articleCategory` | `string` | e.g. `"Technology & Innovation"` |
| `lengthStyle` | `string` | `'short'|'medium'|'long'` |
| `sessionDuration` | `number` | Ms spent in article |
| `scrollDepth` | `number` | Max scroll 0.0–1.0 |
| `publicationName` | `string?` | Publisher name (for weight learning) |
| `actualWordCount` | `number?` | Live word count from WebView JS (for WPM) |

**Valid `eventType` values:** `'swipe_next' | 'swipe_not_interested' | 'like' | 'save' | 'read_thorough' | 'read_skim' | 'read_shallow' | 'quick_exit'`

**Security:** Owner-only create/read. Update/delete disabled.

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
| `trendingScore` | `number` | Crowd engagement accumulator; decays daily × 0.9057 |
| `qualityScore` | `number` | Static feed-level quality from feeds.json (0.0–1.0) |
| `isSeed` | `boolean` | true for seedFirestore.js entries; false for rssCollector |
| `rssStatus` | `'current'|'archived'?` | 'archived' if GUID dropped from live feed |
| `frontendRules` | `{removeCss?, injectCss?}?` | Per-publisher CSS overrides |
| `bodyHtml` | `string?` | **NOT POPULATED** — legacy field only |

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
**Read by:** `getRankedFeed.ts: getOrUpdatePublisherQualities()` (10-min memory cache)

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
**Written by:** `cronUpdateCandidatePool` (every 10 minutes)
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
| `userId` | `string` | Submitting user's UID |
| `url` | `string` | Feed URL submitted |
| `description` | `string?` | Optional note |
| `timestamp` | `number` | Unix ms |
| `status` | `'pending'|'approved'|'rejected'` | Always 'pending' on create |

**Security:** Authenticated users can create/read their own. No update/delete.

---

### Collection: `feedback`
**Document ID:** Auto-generated
**Written by:** `FeedbackScreen.tsx`
**Read by:** Admin only (no client reads)

**Security:** Any authenticated user can create. No reads from client.

---

## 5. Firestore Indexes

From `firebase/firestore.indexes.json`:

| Collection | Fields | Order | Purpose |
|---|---|---|---|
| `articles` | `isPaywalled`, `publishDate` | ASC, DESC | Used by `fallbackGetArticles()` in `feedService.ts` |

`cronUpdateCandidatePool` does a full collection scan (no index). `weightUpdater` queries `users/{id}/behavior_events` by `timestamp >` — Firestore auto-indexes single-field subcollection queries.

---

## 6. Firebase Security Rules Summary

From `firebase/firestore.rules`:

| Collection | Read | Write | Notes |
|---|---|---|---|
| `users/{userId}` | Owner only | Owner only | Delete disabled |
| `users/{userId}/behavior_events` | Owner only | Create only (owner) | Update/delete disabled |
| `articles/{articleId}` | Any authenticated user | Never (Admin SDK only) | Client cannot update articles |
| `feed_requests/{id}` | Owner only | Create (any authenticated) | Update/delete disabled |
| `feedback/{id}` | Never | Create (any authenticated) | Admin-only reads |
| Everything else | Never | Never | Default deny — covers `feeds`, `publishers`, `system` |

**Key implication:** Client code cannot write `rssStatus` to Firestore. The previous `updateDoc(doc(db, 'articles', id), { rssStatus: 'archived' })` in `ReaderScreen.tsx` always silently failed. This is now fixed by writing to `AsyncStorage[@subtick_rss_failed_{id}]` instead.

---

## 7. Build Configuration

### EAS Build (`eas.json`)
| Profile | Platform | Output |
|---|---|---|
| `preview` | Android | APK (`buildType: "apk"`) |
| `production` | All | Default (AAB for Android, IPA for iOS) |

### App Config (`app.json`)
- **Display name:** `Tangent` (previously `2SubTick`)
- **Version:** `1.0.0`
- **Orientation:** Portrait only
- **Android package:** `com.subtick.app`
- **Predictive back gesture:** Disabled
- **iOS tablet support:** Yes

---

## 8. Development Environment

### Firebase Emulator Support
Detects `__DEV__` and connects to local emulators. Config in `src/utils/constants.ts`:
```typescript
export const FIREBASE_EMULATOR_CONFIG = {
  auth:      { host: 'localhost', port: 9099 },
  firestore: { host: 'localhost', port: 8080 },
  functions: { host: 'localhost', port: 5001 },
};
```

### Developer Options Gate
`DeveloperOptionsScreen.tsx` is accessible from Settings but only rendered when `__DEV__` is true. In production builds it is completely hidden. Contains: sandbox reader, AsyncStorage reset tools.

### One-Time Admin Scripts (in `firebase/`)
| Script | What it does |
|---|---|
| `seedFirestore.js` | Fetches up to 10 articles per feed, writes to `articles` collection |
| `seedFeeds.js` | Writes 35 `FeedSource` documents to `feeds` collection |
| `cleanFeeds.js` | Deletes legacy hash-ID feed documents |

### Additional Scripts in `firebase/functions/`
`cleanupArticles.js`, `forceFetchAll.js`, `migrateUsers.js`, `resetAndFetch.js`, `retroCategorize.js`, `retroClean.js` — one-time data migration/maintenance scripts.
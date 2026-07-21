# SubTick — Technical Context

> **Last verified:** July 2026 against commit `fb3b62ab`.  
> All versions are from actual `package.json` files. All schema fields are from actual Firestore write operations in code.

---

## 1. Client Dependencies (`package.json`)

### Production Dependencies

| Package | Version | Purpose | Why chosen |
|---|---|---|---|
| `expo` | `~57.0.6` | Mobile framework | Managed workflow; EAS Build for distribution |
| `react` | `19.2.3` | UI framework | Required by Expo 57 |
| `react-native` | `0.86.0` | Native bridge | Required by Expo 57 |
| `firebase` | `^12.16.0` | Firestore + Auth + Functions client SDK | Firebase backend integration |
| `@react-navigation/native` | `^7.3.8` | Navigation container | Standard RN navigation |
| `@react-navigation/stack` | `^7.10.11` | Stack navigator (slide-up for Reader) | Custom card transition for Reader screen |
| `react-native-webview` | `13.16.1` | In-app article rendering | Renders sanitized HTML; no full browser overhead |
| `@react-native-async-storage/async-storage` | `2.2.0` | On-device key-value storage | Seen/saved lists, behavior queue, theme preference |
| `@react-native-community/netinfo` | `^12.0.1` | Network connectivity detection | Auto-flush behavior queue on reconnect |
| `fast-xml-parser` | `^5.10.1` | Client-side RSS XML parsing | Pure JS, no native module needed; works in RN |
| `xss` | `^1.0.15` | HTML sanitization | Strips scripts/tracking pixels from RSS body HTML |
| `expo-blur` | `~57.0.2` | Frosted-glass HUD effect | Native BlurView for Reader HUD (iOS/Android native) |
| `expo-status-bar` | `~57.0.1` | Status bar control | Expo-managed status bar |
| `react-native-gesture-handler` | `~2.32.0` | Touch gesture system | Required by React Navigation; PanResponder alternative |
| `react-native-safe-area-context` | `~5.7.0` | Safe area insets | Required by React Navigation |
| `react-native-screens` | `4.25.2` | Native screen primitives | Required by React Navigation for performance |
| `react-native-svg` | `^15.15.5` | SVG rendering | Required by `lucide-react-native` |
| `lucide-react-native` | `^1.25.0` | Icon set | Consistent icon library (X, Bookmark, Heart, etc.) |

### Dev Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@types/react` | `~19.2.2` | TypeScript types for React |
| `typescript` | `~6.0.3` | TypeScript compiler |

---

## 2. Cloud Functions Dependencies (`firebase/functions/package.json`)

> The exact `package.json` for functions was not read directly, but the following are confirmed by imports in the source files:

| Package | Confirmed by |
|---|---|
| `firebase-admin` | `firebase/functions/src/index.ts:6` — `import * as admin from 'firebase-admin'` |
| `firebase-functions` | `firebase/functions/src/rssCollector.ts:6` — `import { onSchedule } from 'firebase-functions/v2/scheduler'`; `getRankedFeed.ts:8` — `import { onCall } from 'firebase-functions/v2/https'` |
| `rss-parser` | `firebase/functions/src/rssCollector.ts:8` — `import Parser from 'rss-parser'` |

The functions use **Firebase Functions v2 API** throughout (v2 `onCall`, v2 `onSchedule`), which runs on Cloud Run under the hood. The `tsconfig.json` targets `ES2022` with `NodeNext` module resolution.

---

## 3. Firestore Collections & Document Schemas

### Collection: `users`
**Document ID:** Firebase `auth.currentUser.uid` (anonymous UID or Google-linked UID)  
**Written by:** `auth.ts:ensureUserProfile()` (create), `auth.ts:completeOnboarding()` (update), `auth.ts:updateCategoryWeights()` (update), `weightUpdater.ts:updateWeights()` (update), `SettingsScreen.tsx` (metric/theme updates)

| Field | Type | Description | Source |
|---|---|---|---|
| `userId` | `string` | Matches the Firestore document ID | `auth.ts:66` |
| `isOnboarded` | `boolean` | False until `completeOnboarding()` is called | `auth.ts:67` |
| `selectedCategoryIds` | `string[]` | Category IDs user marked "Interested" | `auth.ts:68` |
| `notInterestedCategoryIds` | `string[]` | Category IDs user marked "Not Interested" | `auth.ts:69` |
| `categoryWeights` | `Record<string, number>` | Learned weights per category ID (e.g. `"Technology & Innovation": 1.5`) | `auth.ts:70` |
| `categoryLengthWeights` | `Record<string, number>` | Learned weights per `"category::lengthStyle"` composite key (e.g. `"Technology & Innovation::long": 1.7`) | `weightUpdater.ts:107-109` |
| `publisherWeights` | `Record<string, number>` | Learned weights per `publicationName` (e.g. `"Stratechery": 1.3`) | `weightUpdater.ts:113-121` |
| `themePreference` | `'system'|'light'|'dark'` | User's chosen theme | `auth.ts:73` |
| `linkedGoogleAccount` | `boolean` | Whether a Google provider is linked | `auth.ts:74` |
| `totalArticlesRead` | `number` | Incremented by `weightUpdater.ts` on qualifying read events | `auth.ts:75` |
| `totalArticlesSaved` | `number` | **Not incremented anywhere in current code** — initialized to 0 | `auth.ts:76` |
| `totalArticlesLiked` | `number` | **Not incremented anywhere in current code** — initialized to 0 | `auth.ts:77` |
| `weeklyReadCount` | `number` | Count of `read_thorough`/`read_skim` events in last 7 days | `weightUpdater.ts:286-292` |
| `currentStreakDays` | `number` | Consecutive days with at least one read | `weightUpdater.ts:294-309` |
| `lastReadDate` | `number` | Unix timestamp (ms) of last read event | `weightUpdater.ts:311` |
| `averageWpm` | `number` | Rolling 80/20 average words-per-minute; initialized to `200` | `auth.ts:79` |
| `dashboardMetricIds` | `string[]` | Up to 3 metric card IDs for Dashboard stats bar | `auth.ts:80` |
| `includeArchivedArticles` | `boolean?` | User opt-in to `candidatePool_mixed` (includes older articles) | `src/types/index.ts:24` |
| `totalReadTimeMs` | `number?` | Cumulative active reading time in milliseconds | `weightUpdater.ts:177-179` |
| `lastUpdated` | `number` | Unix timestamp (ms) of last profile write | `auth.ts:81` |

**Security rule:** Only `request.auth.uid == userId` can read/write. Delete is disabled. (`firestore.rules:7-21`)

---

### Sub-collection: `users/{userId}/behavior_events`
**Document ID:** Auto-generated by Firestore (`db.collection(...).doc()`)  
**Written by:** `syncBehaviorEvents.ts:85-104`

| Field | Type | Description | Source |
|---|---|---|---|
| `articleId` | `string` | Article the event relates to | `syncBehaviorEvents.ts:92` |
| `userId` | `string` | Owning user | `syncBehaviorEvents.ts:93` |
| `eventType` | `BehaviorEventType` | One of 8 event types (see below) | `syncBehaviorEvents.ts:94` |
| `timestamp` | `number` | Unix ms; falls back to `Date.now()` if missing | `syncBehaviorEvents.ts:95` |
| `articleCategory` | `string` | Category string (e.g. `"Technology & Innovation"`) | `syncBehaviorEvents.ts:96` |
| `lengthStyle` | `string` | `'short'|'medium'|'long'` | `syncBehaviorEvents.ts:97` |
| `sessionDuration` | `number` | Milliseconds spent in article | `syncBehaviorEvents.ts:98` |
| `scrollDepth` | `number` | Max scroll percentage 0.0–1.0 | `syncBehaviorEvents.ts:99` |
| `publicationName` | `string?` | Publisher name (optional; used for publisher weight learning) | `syncBehaviorEvents.ts:102` |
| `actualWordCount` | `number?` | Live word count from WebView JS (optional; used for WPM) | `syncBehaviorEvents.ts:103` |

**Valid `eventType` values** (`src/types/index.ts:73-81`):
```
'swipe_next' | 'swipe_not_interested' | 'like' | 'save' |
'read_thorough' | 'read_skim' | 'read_shallow' | 'quick_exit'
```

**Security rule:** Only owning user can create/read. Update and delete disabled. (`firestore.rules:14-20`)

---

### Collection: `articles`
**Document ID:** `article_{sha256(url::title).slice(0,16)}` — e.g. `article_a3f9b2c1d4e5f678`  
**Written by:** `rssCollector.ts:281` (create), `rssCollector.ts:batch.update` (archive status updates), `syncBehaviorEvents.ts:batch.update` (trendingScore increment), `ReaderScreen.tsx:173-174` (rssStatus self-heal)

| Field | Type | Description | Source |
|---|---|---|---|
| `id` | `string` | Matches document ID | `rssCollector.ts:251` |
| `title` | `string` | Article title | `rssCollector.ts:252` |
| `author` | `string` | Author name; falls back to OG scrape or `'Unknown'` | `rssCollector.ts:253` |
| `publicationName` | `string` | Publication name from feed config | `rssCollector.ts:254` |
| `publicationUrl` | `string` | `item.link || feedData.link || feed.url` (article-level URL) | `rssCollector.ts:255` |
| `feedUrl` | `string` | RSS feed URL for this publication | `rssCollector.ts:256` |
| `category` | `string` | Category string from feed config | `rssCollector.ts:257` |
| `lengthStyle` | `string` | `'short'` (<800w) / `'medium'` (800-2000w) / `'long'` (>2000w) | `rssCollector.ts:237-239` |
| `guid` | `string` | RSS item GUID used to match article in live feed at read time | `rssCollector.ts:259` |
| `isTruncatedFeed` | `boolean` | True if description length / body length > 0.9 | `rssCollector.ts:244` |
| `description` | `string` | First 300 chars of RSS snippet or OG description | `rssCollector.ts:261` |
| `publishDate` | `number` | Unix ms from RSS `pubDate` | `rssCollector.ts:262` |
| `cacheTimestamp` | `number` | Unix ms when the rssCollector ran | `rssCollector.ts:263` |
| `isPaywalled` | `boolean` | Result of `checkIsPaywalled()` keyword + CSS + script check | `rssCollector.ts:264` |
| `headerImageUrl` | `string?` | OG image URL (omitted if not found) | `rssCollector.ts:276-279` |
| `wordCount` | `number?` | Estimated word count of `bodyHtml` | `rssCollector.ts:265` |
| `estimatedReadMinutes` | `number` | `ceil(wordCount / 250)`, minimum 1 | `rssCollector.ts:266` |
| `trendingScore` | `number` | Cumulative engagement score; starts at 0; incremented atomically | `rssCollector.ts:267` |
| `qualityScore` | `number` | Static feed-level quality score (0.0–1.0) from `feeds.json` | `rssCollector.ts:268` |
| `isSeed` | `boolean` | `false` for all rssCollector articles; `true` for `seedFirestore.js` entries | `rssCollector.ts:269` |
| `rssStatus` | `'current'|'archived'?` | `'current'` if guid in latest RSS fetch; `'archived'` if dropped | `rssCollector.ts:270` |
| `frontendRules` | `{removeCss?: string[], injectCss?: string}?` | Per-publisher CSS overrides (omitted unless feed has rules) | `rssCollector.ts:273-275` |
| `bodyHtml` | `string?` | **NOT POPULATED by rssCollector** — legacy field only, always absent in current code | `types.ts:39` |

**Security rule:** Any authenticated user can read. Create, update, delete are all disabled (Cloud Functions admin SDK bypasses rules). (`firestore.rules:23-29`)

---

### Collection: `feeds`
**Document ID:** `feed_{slugified_publicationName}` — e.g. `feed_stratechery`  
**Written by:** `seedFeeds.js` (one-time setup script)

| Field | Type | Description | Source |
|---|---|---|---|
| `id` | `string` | Matches document ID | `seedFeeds.js:74` |
| `url` | `string` | RSS feed URL | `seedFeeds.js:75` |
| `category` | `string` | Category string | `seedFeeds.js:76` |
| `publicationName` | `string` | Human-readable publication name | `seedFeeds.js:77` |
| `qualityScore` | `number` | Static baseline quality 0.0–1.0 | `seedFeeds.js:78` |
| `isActive` | `boolean` | If `false`, rssCollector skips this feed | `seedFeeds.js:79` |
| `forceArchived` | `boolean` | If `true`, all articles from this feed get `rssStatus='archived'` | `seedFeeds.js:80` |
| `frontendRules` | `{removeCss?, injectCss?}?` | Optional CSS rules passed through to articles | `rssCollector.ts:273` |

**Security rule:** Not explicitly allowed in `firestore.rules` — falls through to default deny. Only accessible via Admin SDK (Cloud Functions). The client never reads `feeds` directly.

---

### Collection: `publishers`
**Document ID:** `sanitized(publicationName)` where `/` is replaced with `-`  
**Written by:** `syncBehaviorEvents.ts:batch.set(..., merge:true)` atomically on every sync  
**Read by:** `getRankedFeed.ts:getOrUpdatePublisherQualities()`

| Field | Type | Description | Source |
|---|---|---|---|
| `name` | `string` | Original publication name | `syncBehaviorEvents.ts:125` |
| `qualityScore` | `number` | Crowd-sourced; starts at 0.8 default; incremented/decremented atomically | `syncBehaviorEvents.ts:126-128` |
| `lastUpdated` | `number` | Unix ms of last write | `syncBehaviorEvents.ts:127` |

**Quality score increments** (`syncBehaviorEvents.ts:28-37`):
```
save:                +0.010
like:                +0.005
read_thorough:       +0.005
read_skim:           +0.001
swipe_not_interested: -0.010
quick_exit:          -0.005
```
Score is clamped to `[0.20, 1.00]` in `getRankedFeed.ts:284`.

**Security rule:** Falls through to default deny. Admin SDK only.

---

### Collection: `system`
**Document IDs:** `candidatePool_current`, `candidatePool_mixed`  
**Written by:** `getRankedFeed.ts:cronUpdateCandidatePool` (every 10 minutes)  
**Read by:** `getRankedFeed.ts:getOrUpdateCandidatePool()`

| Field | Type | Description | Source |
|---|---|---|---|
| `articles` | `Article[]` | Array of up to 1000 article objects (subset of articles collection fields) | `getRankedFeed.ts:149-157` |
| `generatedAt` | `number` | Unix ms when pool was built | `getRankedFeed.ts:150,155` |

**Security rule:** Falls through to default deny. Admin SDK only.

---

### Collection: `feed_requests`
**Document ID:** Auto-generated by `addDoc()`  
**Written by:** `SettingsScreen.tsx:handleSubmitFeedRequest()`  
**Read by:** Never read by the app — admin review only

| Field | Type | Description | Source |
|---|---|---|---|
| `userId` | `string` | Submitting user's UID | `SettingsScreen.tsx:301` |
| `url` | `string` | Feed URL submitted | `SettingsScreen.tsx:302` |
| `description` | `string?` | Optional user note | `SettingsScreen.tsx:303` |
| `timestamp` | `number` | Unix ms of submission | `SettingsScreen.tsx:304` |
| `status` | `'pending'|'approved'|'rejected'` | Always `'pending'` on create; updated manually by admin | `SettingsScreen.tsx:305` |

**Security rule:** Authenticated users can create and read their own. No update or delete. (`firestore.rules:31-37`)

---

## 4. Firestore Indexes

From `firebase/firestore.indexes.json`:

| Collection | Fields | Order | Purpose |
|---|---|---|---|
| `articles` | `isPaywalled`, `publishDate` | ASC, DESC | Used by `fallbackGetArticles()` in `feedService.ts` |

> **Note:** The `cronUpdateCandidatePool` function does a full collection scan (`db.collection('articles').get()`) with no index. The `fallbackGetArticles` client function uses the above index. The `weightUpdater` queries `users/{id}/behavior_events` ordered by `timestamp DESC` — Firestore auto-indexes subcollection single fields.

---

## 5. Firebase Security Rules Summary

From `firebase/firestore.rules`:

| Collection | Read | Write | Notes |
|---|---|---|---|
| `users/{userId}` | Owner only (`auth.uid == userId`) | Owner only | Delete disabled |
| `users/{userId}/behavior_events` | Owner only | Create only (owner) | Update/delete disabled |
| `articles/{articleId}` | Any authenticated user | Never (Admin SDK only) | Client can read article metadata |
| `feed_requests/{id}` | Owner only | Create (any authenticated) | Update/delete disabled |
| Everything else (`/**`) | Never | Never | Default deny — covers `feeds`, `publishers`, `system` |

---

## 6. Build Configuration

### EAS Build (`eas.json`)
| Profile | Platform | Output |
|---|---|---|
| `preview` | Android | APK (`buildType: "apk"`) |
| `production` | All | Default (AAB for Android, IPA for iOS) |

### App Config (`app.json`)
- **Name:** `2SubTick` (display name), slug `2SubTick`
- **Version:** `1.0.0`
- **Orientation:** Portrait only
- **Android package:** `com.subtick.app`
- **Predictive back gesture:** Disabled (`predictiveBackGestureEnabled: false`)
- **iOS tablet support:** Yes (`supportsTablet: true`)

### TypeScript (`tsconfig.json` — client)
Standard Expo TypeScript config. Strict mode not explicitly set (relies on `expo/tsconfig.base`).

### TypeScript (`firebase/functions/tsconfig.json`)
```json
{
  "module": "NodeNext",
  "moduleResolution": "NodeNext",
  "target": "ES2022",
  "strict": true,
  "esModuleInterop": true
}
```
Strict mode **is** enabled for Cloud Functions.

---

## 7. Development Environment

### Firebase Emulator Support
The app detects `__DEV__` and connects to local emulators. Config in `src/utils/constants.ts:112-116`:
```typescript
export const FIREBASE_EMULATOR_CONFIG = {
  auth:      { host: 'localhost', port: 9099 },
  firestore: { host: 'localhost', port: 8080 },
  functions: { host: 'localhost', port: 5001 },
};
```

### One-Time Admin Scripts (in `firebase/`)
| Script | Usage | What it does |
|---|---|---|
| `seedFirestore.js` | `cd firebase; node seedFirestore.js` | Fetches up to 10 articles per feed from 35 RSS feeds, writes to `articles` collection |
| `seedFeeds.js` | `cd firebase; node seedFeeds.js` | Writes 35 `FeedSource` documents to `feeds` collection |
| `cleanFeeds.js` | `cd firebase; node cleanFeeds.js` | Deletes legacy hash-ID feed documents, preserves slug-ID ones |

All three scripts support both service account key (`./serviceAccountKey.json`) and Firebase application default credentials, and respect `FIRESTORE_EMULATOR_HOST` environment variable.

### Additional Scripts in `firebase/functions/`
The following utility scripts exist at `firebase/functions/` but were not read in this audit:
- `cleanupArticles.js`
- `forceFetchAll.js`
- `migrateUsers.js`
- `resetAndFetch.js`
- `retroCategorize.js`
- `retroClean.js`

These appear to be one-time data migration/maintenance scripts based on naming convention.

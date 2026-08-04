# Tangent — Architecture

> **Last verified:** 4 August 2026 (post-analytics logging implementation).
> Every claim below is traced to a specific file and function.

---

## 1. System Overview

**Tangent** is a "TikTok for reading" mobile app — a personalized, swipe-driven RSS reader targeting Substack newsletters.

| Layer | Technology | Version | Source |
|---|---|---|---|
| Mobile framework | Expo (React Native) | `~57.0.7` | `package.json` |
| React | React 19 + React Native 0.86 | `19.2.3` / `0.86.0` | `package.json` |
| Navigation | React Navigation Stack | `^7.10.11` | `package.json` |
| Backend/DB | Firebase Firestore | JS SDK `^12.16.0` | `package.json` |
| Serverless | Firebase Cloud Functions v2 | 10 exported functions | `firebase/functions/src/index.ts` |
| Analytics | GA4 Measurement Protocol (web stream) | — | `firebase/functions/src/analytics.ts` |
| Auth | Firebase Anonymous Auth + optional Google link | — | `src/services/auth.ts` |
| Safe area | `react-native-safe-area-context` | `~5.7.0` | `App.tsx` (SafeAreaProvider) |
| In-app browser | `react-native-webview` | `13.16.1` | `package.json` |
| Offline storage | `@react-native-async-storage/async-storage` | `2.2.0` | `package.json` |
| RSS parsing (server) | `rss-parser` | `^3.13.0` | `firebase/functions/src/rssCollector.ts` |
| RSS parsing (client) | `fast-xml-parser` | `^5.10.1` | `src/services/feedService.ts` |
| HTML sanitization | `xss` | `^1.0.15` | `src/services/feedService.ts` |
| Icons | `lucide-react-native` | `^1.25.0` | `package.json` |
| Network detection | `@react-native-community/netinfo` | `^12.0.1` | `src/services/offlineManager.ts` |
| Build system | EAS Build (Expo) | — | `eas.json` |

**Firebase project ID:** `subtick-bbd55` (`firebase/.firebaserc`).
**EAS project ID:** `4bc8bbff-9b89-4baa-8353-7bf95bd36693` (`app.json`).
**Android package:** `com.tangent.app` (`app.json`).
**Expo slug/owner:** `tangent` / `tangent_mb123` (`app.json`).
**GA4 Measurement ID:** `G-4B3N8C8MR3` (`firebase/functions/.env`).
**GA_API_SECRET:** Stored in Google Cloud Secret Manager; accessed via `defineSecret('GA_API_SECRET')`.

---

## 2. Full Directory Tree

```
2SubTick/
├── index.ts                        # Expo entry point — calls registerRootComponent(App)
├── App.tsx                         # Root: init auth → ensureUserProfile → startOfflineManager → render;
│                                   #   wraps in SafeAreaProvider → UserProvider → ErrorBoundary;
│                                   #   lazy-requires GoogleSignin
├── app.json                        # Expo config (name: Tangent, package: com.tangent.app)
├── eas.json                        # EAS Build profiles (preview APK + production)
├── package.json                    # Client-side dependencies
├── tsconfig.json                   # Client TypeScript config
├── babel.config.js                 # Babel config: babel-preset-expo
├── metro.config.js                 # Metro bundler config: expo/metro-config
├── .env.example                    # EXPO_PUBLIC_* env var documentation
├── AGENTS.md                       # Developer instruction file
│
├── assets/                         # Static app icons and splash screens
│
├── firebase/
│   ├── feeds.json                  # 42 verified full-RSS Substack feed URLs with qualityScores
│   ├── firebase.json               # Firebase project config + indexes pointer
│   ├── .firebaserc                 # Project alias (default → subtick-bbd55)
│   ├── firestore.rules             # Security rules: field whitelists + schema validation
│   ├── firestore.indexes.json      # 4 composite indexes
│   ├── seedFirestore.js            # One-time: writes seed articles to Firestore
│   ├── seedFeeds.js                # One-time: writes feed documents
│   ├── cleanFeeds.js               # One-time: deletes legacy hash-ID feed docs
│   ├── scripts/
│   │   └── oneoff/                 # Spent migration scripts (READ BEFORE RE-RUNNING)
│   │       ├── README.md
│   │       ├── backfillRandomScore.js
│   │       └── ... (cleanupArticles, resetAndFetch, forceFetchAll, etc.)
│   └── functions/
│       ├── .env                    # GA_MEASUREMENT_ID=G-4B3N8C8MR3, GA_DEBUG=false
│       ├── package.json            # firebase-admin, firebase-functions, rss-parser
│       ├── tsconfig.json           # NodeNext, ES2022, strict mode
│       └── src/
│           ├── index.ts            # Exports all 10 Cloud Functions + updateScoringConfig
│           ├── types.ts            # Shared interfaces (UserProfile, Article, etc.)
│           ├── constants.ts        # Scoring constants, FEEDBACK_DELTAS, etc.
│           ├── analytics.ts        # GA4 Measurement Protocol (sendGAEvents, sendGAUserProperties)
│           ├── rssCollector.ts     # Scheduled every 3h: RSS ingestion
│           ├── getRankedFeed.ts    # Callable: ranked feed + cron jobs + analytics
│           ├── weightUpdater.ts    # Internal: watermark-based weight updates + analytics
│           └── syncBehaviorEvents.ts  # Callable: batch-save events + trending + analytics
│
└── src/
    ├── types/
    │   └── index.ts                # Client TypeScript interfaces + navigation params
    ├── utils/
    │   ├── constants.ts            # Client constants, storage keys, emulator config
    │   ├── safeArea.ts             # topInset / bottomInset re-exports
    │   └── validation.ts           # Onboarding selection + feed URL validation
    ├── contexts/
    │   ├── ThemeContext.tsx         # Light/dark/system + pre-compiled WebView CSS
    │   └── UserContext.tsx          # UserProfile provider → useUser() hook (replaces per-screen fetching)
    ├── components/
    │   ├── ErrorBoundary.tsx        # Crash resilience — wraps RootNavigator
    │   ├── CategoryChipGrid.tsx     # Shared 3-state category selector (onboarding + prefs)
    │   └── ArticleListScreen.tsx    # Shared offline list (history + saved reads)
    ├── features/
    │   └── reader/                  # ReaderScreen decomposition (Batch 3 refactoring)
    │       ├── useArticleLoader.ts  # Article fetching (Firestore + RSS) + prefetch caching
    │       ├── useNavigationQueue.ts # Queue management + preloader trigger (5 remaining)
    │       ├── useReaderHUD.ts      # HUD visibility + like/save state
    │       ├── ReaderHUD.tsx        # BlurView overlay component
    │       └── ReaderProgressBar.tsx # Bottom scroll progress indicator
    ├── navigation/
    │   └── RootNavigator.tsx        # Stack: Dashboard → Onboarding → Reader → ...
    ├── services/
    │   ├── firebase.ts              # Firebase client SDK init + getClientId() for GA4 (dotted format)
    │   ├── auth.ts                  # Anonymous auth, Google linking, profile management
    │   ├── feedService.ts           # Ranking, RSS fetch/sanitize, seen/saved storage, sends client_id
    │   ├── behaviorSync.ts          # Queue + flush behavior events (mutex-serialized), sends client_id
    │   ├── asyncStorageMutex.ts     # Shared concurrency-safe AsyncStorage queue factory
    │   └── offlineManager.ts        # NetInfo listener → auto-flush on reconnect
    ├── hooks/
    │   └── useBehaviorTracker.ts    # Session tracking, scroll depth, event classification
    └── screens/
        ├── AccountScreen.tsx        # Google link/unlink, sign out, reset, delete (uses useUser)
        ├── OnboardingScreen.tsx     # Category chip grid → writes selections on Continue
        ├── DashboardScreen.tsx      # Hero+row feed, stats pill, onSnapshot profile listener
        ├── ReaderScreen.tsx         # Orchestrator: PanResponder + WebView + hooks + components
        ├── SettingsScreen.tsx       # ScrollView: account, library, preferences, dev (uses useUser)
        ├── HistoryScreen.tsx        # 24-line wrapper: ArticleListScreen + getSeenArticleMetas
        ├── SavedReadsScreen.tsx     # 24-line wrapper: ArticleListScreen + getSavedArticleMetas
        ├── CategoryPreferencesScreen.tsx  # CategoryChipGrid + useUser (auto-save on tap)
        ├── DashboardStatsScreen.tsx # Select ≤3 stats for dashboard pill (uses useUser)
        ├── DeveloperOptionsScreen.tsx  # __DEV__ only: sandbox reader, data reset
        ├── FeedbackScreen.tsx       # Submit feedback to Firestore
        └── FeedRequestScreen.tsx    # Submit feed URL for admin review
```

---

## 3. Data Flow Trace

### 3a. Ingestion — RSS → Firestore

```
TRIGGER: Firebase Scheduler — "every 3 hours"
  └── rssCollector.ts: rssCollector = onSchedule('every 3 hours', ...)
        │
        ├── 1. db.collection('feeds').get()
        │      Reads active FeedSource documents.
        ├── 2. chunkArray(feedsList, 5) + Promise.allSettled(chunk.map(...))
        ├── 3. parser.parseURL(feed.url)  [rss-parser, 15s timeout]
        ├── 4. Per feed: generateArticleId, batch existence check (C3), OG scrape, paywall check
        ├── 5. db.collection('articles').doc(articleId).set(article) — bodyHtml NOT stored
        └── 6. Delta-driven archive update: query rssStatus='current' per feed → flip to 'archived' (C4)
```

### 3b. Candidate Pool Build + Trending Decay + Cleanup

```
cronUpdateCandidatePool (every 6h): Random threshold R, 4 capped queries (max 500 each)
  → Box 1: 500 fresh active + 500 old active (current articles)
  → Box 2: 500 fresh mixed  + 500 old mixed  (includes archived)

cronDecayTrendingScores (every 24h): trendingScore × 0.9057 for scores > 1.0 (C1)
  → Also refreshes random_score on every article

cronCleanupOldArticles (every 3 days):
  → Step 1: Delete ALL paywalled articles immediately
  → Step 2: Delete bottom 3% of articles >3 months old by peakTrendingScore
```

### 3c. Feed Request — Client → Cloud Function → Response (+ Analytics)

```
DashboardScreen → feedService.getRankedFeed(seenIds) — includes client_id from getClientId()
  → Cloud Function: getOrUpdateCandidatePool → filter seen → 5-component scoring
  → Tranche assembly: High 12 / Mid 8 / Low 4 / Discovery 6 (random <30 reads, merit otherwise)
  → Final shuffle → return { articles: Article[30] }
  → Client-side seen filter → slice(0,30) → setFeedArticles
  → [ANALYTICS] sendGAEvents(clientId, [feed_generated + 30× article_shown]) — fire-and-forget
```

### 3d. Article Read — Client fetches live RSS at read time

```
useArticleLoader.loadArticle(id):
  ├── isSavedMode → getSavedArticleHtml(id)
  ├── rssStatus='archived' → useDirectUri
  ├── has guid+feedUrl → fetchAndExtractArticle (lazy-sanitize — C6)
  │     On failure → markRssFailed(id) in AsyncStorage
  └── fallback → bodyHtml || ''
→ articleHTML built in ReaderScreen with escapeHtml + sanitized body (S1)
→ WebView renders client-side; theme CSS injects dynamically (no reload — B9)
```

### 3e. Behavior Event Pipeline (+ Analytics)

```
ReaderScreen → behaviorTracker.concludeSession() → queueBehaviorEvent()
  → AsyncStorage queue (mutex-serialized via asyncStorageMutex)
  → syncBehaviorEvents Cloud Function (sends client_id):
      Auth: request.auth.uid enforced
      Swipe_next skipped; trending + peakTrendingScore in single batch
      Publisher quality aggregated (10-min TTL cache — C5)
      → updateWeights(userId, clientId) [watermark-based, no replay]
      → [ANALYTICS] sendGAEvents for weight_updated events
      → [ANALYTICS] sendGAEvents for read_thorough, quick_exit, swipe_not_interested, save
      → [ANALYTICS] sendGAUserProperties for concentration_score, top_cat_weight, cats_at_ceiling
```

### 3f. Analytics Pipeline

```
Client → getClientId() → dotted format (XXXXXXXXXX.XXXXXXXXXX, cached in AsyncStorage)
  → Sent as client_id in callable payloads (feedService.ts, behaviorSync.ts)
  → Server resolves via resolveClientId() → sendGAEvents() / sendGAUserProperties()
  → Measurement Protocol POST → google-analytics.com/mp/collect?
      measurement_id=G-4B3N8C8MR3&api_secret=(trimmed secret)
  → Events: article_shown, feed_generated, weight_updated, config_changed,
     read_thorough, quick_exit, swipe_not_interested, save
  → User properties: concentration_score, top_cat_weight, cats_at_ceiling
  → session_id = Math.floor(Date.now() / 1000) added to all events
  → GA_DEBUG toggle in firebase/functions/.env for payload validation
```

### 3g. Sign-Out Flow

```
AccountScreen → signOutUser():
  clearAllLocalData() → signOut(auth) → signInAnonymouslyIfNeeded()
  → ensureUserProfile(newUser) → Dashboard redirects to Onboarding
```

### 3h. Google Account Recovery + Orphan Cleanup

```
AccountScreen → linkGoogleAccount():
  GoogleSignin.signIn() → linkWithCredential()
  If credential-already-in-use:
    Save oldAnonymousUid → signOut → signInWithCredential → ensureUserProfile
    → deleteOrphanProfile CF (Admin SDK — bypasses delete: false rule)
```

---

## 4. Security Architecture

### Security Fixes Applied
- **getRankedFeed / syncBehaviorEvents** — `request.auth.uid` enforced
- **Behavior event IDs** — Client-generated, used as document ID (idempotent retries)
- **deleteOrphanProfile CF** — Admin SDK deletes stale anonymous profiles
- **User profile field whitelist** (S2 + A4) — Create/update restricted to whitelisted fields
- **behavior_events validation** (S5 + A4) — Path match, eventType enum, 2KB cap
- **feed_requests / feedback validation** (S3/S4) — Schema + size caps
- **escapeHtml in ReaderScreen** (S1) — RSS metadata escaped before WebView injection
- **syncBehaviorEvents 50-event cap** (A4) — Server-side batch limit
- **ErrorBoundary** (Batch 1) — Crash resilience around RootNavigator
- **DashboardScreen focus refetch guard** (A5) — Only refetches when feed depleted
- **DashboardScreen queue shuffle** (A5) — Untapped cards scattered randomly
- **ReaderScreen HUD** (A5) — Title truncation + hidden on initial load
- **GA_API_SECRET** — Stored in Cloud Secret Manager; `.trim()` applied to strip trailing CRLF

---

## 5. What Is NOT Stored Server-Side

| What | Where it actually lives |
|---|---|
| Full article body HTML | Client-fetched live from RSS at read time |
| Seen article IDs | `AsyncStorage[@subtick_seen_articles]` — capped at 1000; synced to Firestore `seenArticleIds` |
| Seen article metadata | `AsyncStorage[@subtick_seen_articles_meta]` |
| Saved article IDs | `AsyncStorage[@subtick_saved_articles]` |
| Saved article HTML | `AsyncStorage[@subtick_saved_html_{id}]` |
| Saved article metadata | `AsyncStorage[@subtick_saved_articles_meta]` |
| Theme preference | `AsyncStorage[@subtick_theme_preference]` + Firestore `users/{uid}.themePreference` (dual) |
| Pending behavior events | `AsyncStorage[@subtick_behavior_queue]` until flushed |
| Failed RSS feed flags | `AsyncStorage[@subtick_rss_failed_{articleId}]` per device |
| GA4 client_id | `AsyncStorage[@subtick_app_instance_id]` — stable per-install dotted format UUID |
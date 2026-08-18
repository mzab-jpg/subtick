# Tangent — Architecture

> **Last verified:** 17 August 2026 (audit hardening, reliable onboarding/startup flow, sequential Reader prefetch, rolling dashboard statistics, and highest-scoring opening-card update).
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
| Serverless | Firebase Cloud Functions v2 | 14 exported functions | `firebase/functions/src/index.ts` |
| Analytics | GA4 Measurement Protocol (web stream) | — | `firebase/functions/src/analytics.ts` |
| Auth | Firebase Anonymous Auth + optional Google link | — | `src/services/auth.ts` |
| Safe area | Manual `src/utils/safeArea.ts` | — | `topInset` / `bottomInset` constants (avoids Fabric crash on RN 0.86) |
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

**Android Reader performance module:** `modules/tangent-rss-parser/` is a local Expo module compiled into Android custom builds. It keeps direct publisher fetching on-device while moving RSS/Atom streaming parse work from React Native JavaScript to one Kotlin worker. A fresh native APK is required after changing this module; iOS requires a separate Swift implementation before its Reader preloading can be enabled.

---

## 2. Full Directory Tree

```
2SubTick/
├── index.ts                        # Expo entry point — calls registerRootComponent(App)
├── README.md                       # Public project overview, setup, and validation commands
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
├── archive/legacy-tools/           # Preserved obsolete simulator tooling; not part of current workflow
│
├── firebase/
│   ├── feeds.json                  # 42 verified full-RSS Substack feed URLs with qualityScores
│   ├── firebase.json               # Firebase project config + indexes pointer
│   ├── .firebaserc                 # Project alias (default → subtick-bbd55)
│   ├── firestore.rules             # Security rules: field whitelists + schema validation
│   ├── firestore.indexes.json      # 5 composite indexes
│   ├── seedFirestore.js            # One-time: writes seed articles to Firestore
│   ├── seedFeeds.js                # One-time: writes feed documents
│   ├── cleanFeeds.js               # One-time: deletes legacy hash-ID feed docs
│   ├── analytics/
│   │   └── create_personalization_health_view.sql # One-time BigQuery view for Looker recommendation health
│   ├── scripts/
│   │   ├── test-classification.js  # Focused backend classification, diversity, and startup-anchor regression test
│   │   └── oneoff/                 # Spent migration scripts (READ BEFORE RE-RUNNING)
│   │       ├── README.md
│   │       ├── resetTrendingScores.js
│   │       ├── resetPublisherQualities.js
│   │       ├── backfillRandomScore.js
│   │       └── ... (cleanupArticles, resetAndFetch, forceFetchAll, etc.)
│   └── functions/
│       ├── .env                    # GA_MEASUREMENT_ID=G-4B3N8C8MR3, GA_DEBUG=false
│       ├── package.json            # firebase-admin, firebase-functions, rss-parser
│       ├── tsconfig.json           # NodeNext, ES2022, strict mode
│       └── src/
│           ├── index.ts            # Exports 14 Cloud Functions, protected dashboard actions, and addRssFeed
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
    │   ├── safeArea.ts             # topInset / bottomInset (manual, avoids safe-area-context Fabric crash)
    │   └── validation.ts           # Onboarding selection + feed URL validation
    ├── contexts/
    │   ├── ThemeContext.tsx         # Light/dark/system + pre-compiled WebView CSS
    │   └── UserContext.tsx          # UserProfile provider → useUser() hook (replaces per-screen fetching)
    ├── components/
    │   ├── ErrorBoundary.tsx        # Crash resilience — wraps RootNavigator
    │   ├── CategoryChipGrid.tsx     # Shared 3-state category selector (onboarding + prefs)
    │   ├── ArticleListScreen.tsx    # Shared offline list (history + saved reads)
    │   ├── FormScreen.tsx           # Shared form wrapper (Feedback + FeedRequest)
    │   └── ScreenHeader.tsx         # Shared header with back button
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
        ├── DashboardScreen.tsx      # Hero+row feed, stats pill; consumes shared UserContext profile state
        ├── ReaderScreen.tsx         # Orchestrator: PanResponder + WebView + hooks + components
        ├── SettingsScreen.tsx       # ScrollView: account, library, preferences, dev (uses useUser)
        ├── HistoryScreen.tsx        # 24-line wrapper: ArticleListScreen + getSeenArticleMetas
        ├── SavedReadsScreen.tsx     # 24-line wrapper: ArticleListScreen + getSavedArticleMetas
        ├── CategoryPreferencesScreen.tsx  # CategoryChipGrid + useUser (auto-save on tap)
        ├── DashboardStatsScreen.tsx # Select ≤3 stats for dashboard pill (uses useUser)
        ├── DeveloperOptionsScreen.tsx  # __DEV__ only: sandbox reader, data reset
        ├── FeedbackScreen.tsx       # Submit feedback (uses shared FormScreen)
        └── FeedRequestScreen.tsx    # Submit feed URL for admin review (uses shared FormScreen)
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
  → Step 2: Query 500 worst-scoring articles >3 months old by peakTrendingScore ASC,
    delete bottom 3% of sample. Fixed 500-read ceiling regardless of collection size.
    Uses composite index (publishDate, peakTrendingScore).
```

### 3c. Feed Request — Client → Cloud Function → Response (+ Analytics)

```
DashboardScreen → feedService.getRankedFeed(seenIds) — includes client_id from getClientId()
  → Cloud Function: getOrUpdateCandidatePool → filter seen → 4-component scoring (P, T, R, Q)
  → Tranche assembly: High 12 / Mid 8 / Tail 10; the highest-scoring eligible article is reserved in its own tranche, remaining High/Mid slots are random, and Tail is sorted by tailScore for established users
  → Archived Articles off → current-RSS-only candidate pool; on → mixed current/archived pool
  → Backend final safety filter again removes archived items when the setting is off
  → Hard per-publisher cap of 5 and configurable category maximum applied during picking; overflow cascades
  → Configurable minimum distinct categories is filled with eligible alternatives when available
  → Category-aware final interleave: avoids a third same-category card when another category remains
  → Highest eligible article is reserved and returned first for the Dashboard hero; the remaining cards retain their varied order
  → return { articles: Article[30] }
  → Phone retains the active 30-card Dashboard feed in a UID-scoped in-memory cache; screen remounts restore it instead of silently requesting a replacement feed
  → Client-side seen filter → slice(0,30) → setFeedArticles
  → When Reader opens an article, only that article is removed from the mounted Dashboard cache; background replenishment appends unseen replacements after remaining unread cards.
  → Each returned article carries transient `{ feedId, impressionId }` context
  → [ANALYTICS] `feed_generated` + 30× `article_shown` include feed/impression IDs,
    user-stage snapshot, discovery flags, ranking fields, and server-derived environment
  → Later read/Like/Save/Not Interested actions carry that same impression ID — fire-and-forget
```

### 3d. Article Read — Client fetches live RSS at read time

```
useArticleLoader.loadArticle(id):
  ├── isMockMode → setArticle(mockArticle), resolvedHtml = '' (loads live URL in WebView)
  ├── isSavedMode → getSavedArticleHtml(id)
  ├── rssStatus='archived' → useDirectUri
  ├── has guid+feedUrl → returns its native-prepared raw body when it is one of the next five Reader targets; otherwise finds it in raw in-memory RSS XML, then lazily sanitizes only this displayed article (C6)
  │     Confirmed absent from a successfully loaded feed → remembered for this Reader session;
  │       Archived Articles on → raw publication WebView, off → mark seen and silently advance
  │     Current/tapped article network/native/timeout failure → retryable error UI; never persisted as failed
  │     Future lookahead network/native/timeout failure → remove only that future card from the current Reader and mounted Dashboard cache before display; it is not written to History/seen state and may retry in a later session
  └── fallback → bodyHtml || ''
→ articleHTML built in ReaderScreen with escapeHtml + sanitized body (S1)
→ WebView renders client-side; theme CSS injects dynamically (no reload — B9). On a new article request, the prior WebView unmounts immediately behind an opaque theme surface; a spinner appears only after 180 ms, preventing old publisher content from flashing beneath the transition.
→ **Android native RSS pipeline:** `modules/tangent-rss-parser` downloads and streams RSS/Atom XML outside the React Native/Reader JavaScript workload. Lookahead caches raw XML for up to 16 ordinary-sized publisher feeds (5 MB cache allowance per feed) and separately extracts raw bodies for exactly the next five Reader targets (articles 2–6 while article 1 is open). It never prebuilds unrelated entries from a publisher feed. When an article is opened, native code returns its prepared raw body when available; otherwise it scans cached raw XML and returns only that matching item to JavaScript. A legitimate feed larger than the cache allowance remains readable: the selected-article lane stream-parses it directly without retaining the full feed. A selected active article uses its own serial native lane, while lookahead uses at most two bounded native workers, so the selected article never waits behind speculative work and one slow publisher does not block every later target. The tapped Dashboard/current Reader article and all past Reader articles are fixed. Reader preserves the ranked queue's normal sequential order; preparation never visibly rearranges cards. If a future lookahead request genuinely fails before display, only that future card is removed from the current Reader and mounted Dashboard cache, and preparation continues with later targets. A selected/current article remains exact and retryable. For a matching exact article, an active request joins any in-progress native lookahead preparation, including a large-feed direct scan, rather than starting a second download/scan. Reader targets a rolling five upcoming articles: opening article 1 queues 2–6; each advance adds only the newly exposed sixth position. JavaScript sanitises only the displayed article. The cache is never written to disk and is discarded when Android closes the app. iOS and pre-native development builds retain the JavaScript parser fallback. If Archived Articles is off and a live-RSS item is unavailable, Reader records it as seen and silently advances rather than exposing a raw webpage or browser escape.
```

### 3e. Behavior Event Pipeline (+ Analytics)

```
ReaderScreen → behaviorTracker records foreground-only duration, maximum scroll, and rendered word count
  → AppState inactive/background intervals are excluded before raw-session telemetry is queued
  → Any normal Reader exit (HUD close, Android/system back, or queue-exhausted exit) uses one guarded finish path:
    queue raw session + write local History → navigate immediately; behavior sync continues in the background
  → Phone applies a provisional default-rule stat estimate for instant display; the next server profile update replaces it with the authoritative live-config classification
  → A valid edge swipe requires horizontal direction and 40px distance; holding the finger still for more than 200 ms before release deliberately cancels it without navigating or recording behaviour
  → Behavior events remain locally queued during active Reader use; backend batch sync occurs on Reader exit, reconnect, or other lifecycle flushes rather than at the 20-event threshold
  → Concurrent lifecycle flush requests share one in-progress upload, preventing duplicate sends of the same queued batch
  → Swipe navigation stays non-blocking; AsyncStorage queue remains mutex-serialized and preserves offline sessions
  → syncBehaviorEvents Cloud Function (sends client_id):
      Auth: request.auth.uid enforced; request fields are validated
      Reads the authenticated user's stored averageWpm once per batch
      Loads active scoringConfig (per-instance cache: about 60s)
      Reclassifies raw and legacy read events server-side as quick_exit, shallow,
      skim, thorough, or swipe_next; explicit Like/Save/Not Interested actions stay unchanged
      Stores the final event type; trending + peakTrendingScore update in one batch
      Publisher quality aggregated (10-min TTL cache — C5)
      → updateWeights(userId, clientId, cfg) [watermark-based, no replay]
      → repeated quick exits from distinct articles may create one category-only weak signal after live threshold/window; positive category engagement clears pending evidence
      → server-classified qualifying reads update completion/read-time statistics
      → WPM is independent of read classification: positive article word count ÷ active foreground time,
        then an 80% old / 20% new rolling average
      → [ANALYTICS] final event types + weight_updated/user-property events
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
AccountScreen → begin account transition (blocking shell; old profile/stats hidden)
  → signOutUser(): clearAllLocalData() → signOut(auth) → signInAnonymouslyIfNeeded()
  → ensureUserProfile(newUser) → root navigation remounts at Onboarding

Reset / Delete follow the same transition shell. Reset keeps its UID but still forces
that root remount, so it cannot leave the old Account/Dashboard stack visible.
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
- **deleteOrphanProfile CF** — Admin SDK deletes stale anonymous profiles (security hardening deferred; see audit-backlog.md)
- **User profile field whitelist** (S2 + A4) — Create/update restricted to whitelisted fields
- **behavior_events validation** (S5 + A4) — Direct-write path match, 11-type event whitelist, field whitelist, 2KB cap; callable additionally validates raw telemetry before persistence
- **feed_requests / feedback validation** (S3/S4) — Schema + size caps
- **escapeHtml in ReaderScreen** (S1) — RSS metadata escaped before WebView injection
- **syncBehaviorEvents 100-event cap (A4)** — Server-side batch limit (was 50, doubled to support larger batch tests); FieldValue.increment replaced with absolute writes; missing articles skipped to prevent batch failure
- **ErrorBoundary** (Batch 1) — Crash resilience around RootNavigator
- **DashboardScreen focus refetch guard** (A5) — Only refetches when feed depleted
- **DashboardScreen queue shuffle** (A5) — Untapped cards remain intentionally randomized; ranked-order preservation is deferred
- **ReaderScreen HUD** (A5) — Title truncation + hidden on initial load
- **ReaderScreen gestureEnabled** — Enabled (horizontal edge-swipe to dismiss; doesn't conflict with vertical article swipes)
- **Google Sign-In logs** — Gated behind `__DEV__` checks (production logs are clean)
- **GA_API_SECRET** — Stored in Cloud Secret Manager; `.trim()` applied to strip trailing CRLF
- **Control Dashboard mutations** — Saving live/preview scoring configuration and adding feeds require the server-held `CONTROL_DASHBOARD_SECRET`; read-only dashboard/matrix access remains available to authenticated users
- **Archived-content preference** — Enforced in normal ranking, backend emergency pool construction, a final server filter, and the phone-side Functions-outage fallback

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











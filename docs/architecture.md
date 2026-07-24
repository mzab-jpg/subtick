# SubTick — Architecture

> **Last verified:** July 2026 against current codebase (post-bugfix session).
> Every claim below is traced to a specific file and function. If a claim cannot be traced, it is explicitly flagged as unknown.

---

## 1. System Overview

SubTick (displayed as **Tangent**) is a "TikTok for reading" mobile app — a personalized, swipe-driven RSS reader targeting Substack newsletters.

| Layer | Technology | Version | Source |
|---|---|---|---|
| Mobile framework | Expo (React Native) | `~57.0.6` | `package.json:6` |
| React | React 19 + React Native 0.86 | `19.2.3` / `0.86.0` | `package.json:12-13` |
| Navigation | React Navigation Stack | `^7.10.11` | `package.json:9` |
| Backend/DB | Firebase Firestore | JS SDK `^12.16.0` | `package.json:14` |
| Serverless | Firebase Cloud Functions v2 | (firebase-functions in functions pkg) | `firebase/functions/src/index.ts` |
| Auth | Firebase Anonymous Auth + optional Google link | — | `src/services/auth.ts` |
| In-app browser | `react-native-webview` | `13.16.1` | `package.json:23` |
| Offline storage | `@react-native-async-storage/async-storage` | `2.2.0` | `package.json:6` |
| RSS parsing (server) | `rss-parser` | `^3.13.0` | `firebase/functions/src/rssCollector.ts:8` |
| RSS parsing (client) | `fast-xml-parser` | `^5.10.1` | `src/services/feedService.ts:13` |
| HTML sanitization | `xss` | `^1.0.15` | `src/services/feedService.ts:14` |
| Icons | `lucide-react-native` | `^1.25.0` | `package.json:15` |
| Network detection | `@react-native-community/netinfo` | `^12.0.1` | `src/services/offlineManager.ts:7` |
| Build system | EAS Build (Expo) | — | `eas.json` |

**Firebase project ID:** `subtick-bbd55` (confirmed in `firebase/seedFeeds.js:33` and `firebase/seedFirestore.js:42`).
**EAS project ID:** `566a329b-3f0e-4f05-ba8c-6440c4ce2e99` (`app.json:27`).
**Android package:** `com.subtick.app` (`app.json:21`).

---

## 2. Full Directory Tree

```
2SubTick/
├── index.ts                        # Expo entry point — calls registerRootComponent(App)
├── App.tsx                         # Root component: init auth → ensureUserProfile → startOfflineManager → render
├── app.json                        # Expo config (name, icons, package IDs)
├── eas.json                        # EAS Build profiles (preview APK + production)
├── package.json                    # Client-side dependencies
├── tsconfig.json                   # Client TypeScript config
├── AGENTS.md                       # Developer instruction file
│
├── assets/                         # Static app icons and splash screens
│
├── firebase/
│   ├── feeds.json                  # Master list of 35 Substack feed URLs with qualityScores
│   ├── firebase.json               # Firebase project config (hosting/functions deploy)
│   ├── .firebaserc                 # Firebase project alias (default → subtick-bbd55)
│   ├── firestore.rules             # Security rules: users own-read-write, articles read-only, feed_requests create-only
│   ├── firestore.indexes.json      # Composite index: articles(isPaywalled ASC, publishDate DESC)
│   ├── seedFirestore.js            # One-time script: parses feeds.json, writes seed articles to Firestore (isSeed:true)
│   ├── seedFeeds.js                # One-time script: writes 35 feed documents to Firestore 'feeds' collection
│   ├── cleanFeeds.js               # One-time script: deletes legacy hash-ID feed docs, preserving slug-ID ones
│   └── functions/
│       ├── package.json            # Cloud Functions dependencies (firebase-admin, firebase-functions, rss-parser)
│       ├── tsconfig.json           # Functions TS config: NodeNext modules, ES2022 target
│       └── src/
│           ├── index.ts            # Cloud Functions entry: exports rssCollector, getRankedFeed, cronUpdateCandidatePool,
│           │                       #   cronDecayTrendingScores, syncBehaviorEvents
│           ├── types.ts            # Shared TypeScript interfaces: UserProfile, Article, BehaviorEvent, FeedSource, RankedFeedResult
│           ├── constants.ts        # Scoring constants, FEEDBACK_DELTAS, SCORE_WEIGHTS, SCORE_WEIGHTS_MERIT,
│           │                       #   TRENDING_DECAY_RATE, MAX_TRENDING_SCORE, 35 static feed list, paywall keywords
│           ├── rssCollector.ts     # Scheduled Cloud Function (every 3h): fetch feeds → write articles to Firestore
│           ├── getRankedFeed.ts    # HTTPS Callable: normalized 5-component scoring → per-tranche assembly → 30 articles
│           │                       # Also exports: cronUpdateCandidatePool (every 10 min), cronDecayTrendingScores (daily)
│           ├── weightUpdater.ts    # Internal helper: update user weights using watermark-based event processing
│           └── syncBehaviorEvents.ts  # HTTPS Callable: batch-save behavior events, increment trendingScore + publisherQualityScore
│
└── src/
    ├── types/
    │   └── index.ts                # Client-side TypeScript interfaces (UserProfile, Article, BehaviorEvent, navigation params)
    ├── utils/
    │   ├── constants.ts            # Client constants: categories, scoring weights, storage keys, FIREBASE_EMULATOR_CONFIG
    │   └── validation.ts           # Validates onboarding selection (min 3 categories), feed URL format
    ├── contexts/
    │   └── ThemeContext.tsx         # Global theme state: light/dark/system + pre-compiled WebView CSS injection string
    ├── navigation/
    │   └── RootNavigator.tsx        # React Navigation Stack: Dashboard → Onboarding → Reader → Settings → History → SavedReads
    ├── services/
    │   ├── firebase.ts              # Firebase client SDK init; conditionally connects to emulators in __DEV__
    │   ├── auth.ts                  # Firebase anonymous sign-in, ensureUserProfile, completeOnboarding, linkGoogleAccount
    │   ├── feedService.ts           # getRankedFeed callable, fetchAndExtractArticle (live RSS),
    │   │                            #   seen/saved AsyncStorage management, markRssFailed/isRssFailed
    │   ├── behaviorSync.ts          # queueBehaviorEvent (AsyncStorage), flushBehaviorQueue (Cloud Function call)
    │   └── offlineManager.ts        # NetInfo listener: auto-flush behavior queue on reconnect, 30s retry cooldown
    ├── hooks/
    │   └── useBehaviorTracker.ts    # React hook: tracks session duration, scroll depth, classifies read quality on swipe-away
    └── screens/
        ├── OnboardingScreen.tsx     # Category chip grid (3-state toggle), writes selections to Dashboard on Continue
        ├── DashboardScreen.tsx      # Hero+row feed layout, stats pill bar, triggers getRankedFeed on mount and focus
        ├── ReaderScreen.tsx         # WebView shell + PanResponder edge swipes + HUD + real-time preloader (trigger at 5 remaining)
        ├── SettingsScreen.tsx       # ScrollView layout; category prefs, stats, theme, Google link; Dev Options in __DEV__ only
        ├── HistoryScreen.tsx        # Offline list from AsyncStorage metadata; no Firestore read
        ├── SavedReadsScreen.tsx     # Offline list from AsyncStorage metadata; loads on mount + focus
        ├── CategoryPreferencesScreen.tsx  # 3-state category preference editor
        ├── DashboardStatsScreen.tsx # Select up to 3 stats to show on Dashboard pill bar
        ├── DeveloperOptionsScreen.tsx  # Dev-only: sandbox reader, data reset; hidden in production (__DEV__ gate)
        ├── FeedbackScreen.tsx       # Submit feedback to feed_requests collection
        └── FeedRequestScreen.tsx    # Submit new feed URL for admin review
```

---

## 3. Data Flow Trace

### 3a. Ingestion — RSS → Firestore

```
TRIGGER: Firebase Scheduler — "every 3 hours"
  └── rssCollector.ts: rssCollector = onSchedule('every 3 hours', ...)
        │
        ├── 1. db.collection('feeds').get()
        │      Reads active FeedSource documents. Falls back to static SUBSTACK_FEEDS array.
        │
        ├── 2. chunkArray(feedsList, 5) + Promise.allSettled(chunk.map(...))
        │      Processes feeds in batches of 5 concurrently.
        │
        ├── 3. parser.parseURL(feed.url)  [rss-parser, 15s timeout]
        │
        ├── 4. For each item:
        │      a. generateArticleId(link, title) → SHA-256 hash prefix "article_"
        │      b. Skip if article already exists in Firestore
        │      c. fetchOgMetadata(link) if missing image/author/description [6s timeout]
        │      d. calculateWordCount, lengthStyle, checkIsPaywalled, isTruncatedFeed
        │
        └── 5. db.collection('articles').doc(articleId).set(article)
                 bodyHtml intentionally NOT stored. Post-sync: mark dropped GUIDs as 'archived'.
```

### 3b. Candidate Pool Build + Trending Score Decay

```
TRIGGER: Firebase Scheduler — "every 10 minutes"
  └── cronUpdateCandidatePool
        ├── Full scan of 'articles' collection
        ├── Box 1 (candidatePool_current): 500 fresh (≤4 weeks) + 500 old, all shuffled
        └── Box 2 (candidatePool_mixed): 500 current-status + 500 archived, all shuffled

TRIGGER: Firebase Scheduler — "every 24 hours"
  └── cronDecayTrendingScores
        ├── Query all articles where trendingScore > 0.1
        └── Apply: trendingScore = trendingScore × 0.9057  (halves every 7 days)
```

### 3c. Feed Request — Client → Cloud Function → Response

```
CLIENT: DashboardScreen.tsx → loadFeedArticles()
  └── feedService.ts: getRankedFeed(seenArticleIds)
        └── httpsCallable('getRankedFeed')({ seenArticleIds })
              │
              └── getRankedFeed Cloud Function (request.auth.uid verified — never trusts client userId)
                    │
                    ├── STAGE 1: getOrUpdateCandidatePool(includeArchivedArticles)
                    │      10-min memory cache → Firestore read → on-the-fly fallback
                    │
                    ├── STAGE 1.5: getOrUpdatePublisherQualities()
                    │      10-min memory cache → db.collection('publishers').get()
                    │
                    ├── STAGE 2: Filter seenArticleIds
                    │
                    ├── STAGE 3: Score each article with normalized components
                    │      P = normalizeP(catWeight, pubWeight)     → [0, 1]
                    │      T = normalizeT(trendingScore)             → [0, 1]
                    │      R = normalizeR(daysOld)  [two-phase]      → [0, 1]
                    │      Q = normalizeQ(publisherQuality)          → [0, 1]
                    │      U = normalizeU(articlesInSamePub)         → [0, 1]
                    │
                    ├── STAGE 4: assembleFeedWithTranches(scored, 30, totalArticlesRead)
                    │      High (P≥0.40): 12 — random (always)
                    │      Mid  (P≥0.20): 8  — random (always)
                    │      Low  (P≥0.10): 4  — random if <30 reads, else merit-sorted (R+T+Q)
                    │      Discovery:     6  — random if <30 reads, else merit-sorted (R+T+Q)
                    │      Final shuffle of all 30
                    │
                    └── Returns: { articles: Article[30], generatedAt, remainingCount }

CLIENT:
  └── Client-side seen filter (dedup) → slice(0,30) → DashboardScreen sets feedArticles
```

### 3d. Article Read — Client fetches live RSS at read time

```
ReaderScreen.tsx: loadArticle(id)
  ├── Check AsyncStorage @subtick_rss_failed_{id} — if set, skip RSS fetch (P1-C fix)
  ├── getDoc(db, 'articles', id) — fetch metadata from Firestore
  ├── Decision tree:
  │     isSavedMode    → getSavedArticleHtml(id) from AsyncStorage
  │     rssStatus='archived' → contentHtml='', useDirectUri=true
  │     has guid+feedUrl → fetchAndExtractArticle(feedUrl, guid)
  │       On failure   → markRssFailed(id) in AsyncStorage (replaces old Firestore write)
  │     fallback       → data.bodyHtml || ''
  │
  └── articleHTML = useMemo(escapeHtml(title/author/pub) + sanitized body + scripts)
      WebView renders entirely client-side
```

### 3e. Behavior Event Pipeline — Swipe → Firestore → Weight Update

```
ReaderScreen → behaviorTracker.concludeSession() → queueBehaviorEvent()
  └── AsyncStorage[@subtick_behavior_queue] (mutex-serialized)
        └── On flush: syncBehaviorEvents Cloud Function
              ├── Auth: request.auth.uid — client userId IGNORED
              ├── event.id used as Firestore document ID (idempotent retries)
              ├── batch.set(users/{uid}/behavior_events/{event.id}, event)
              ├── batch.update(articles/{id}, { trendingScore: increment(Δ) })
              ├── Publishers: new publishers seeded at DEFAULT_PUBLISHER_QUALITY (0.8) + delta
              │             existing publishers use increment atomically
              └── updateWeights(userId) [weightUpdater.ts]
                    ├── Reads only events AFTER weightUpdatedAt watermark (no replay)
                    ├── Applies Δ × LEARNING_RATE per dimension
                    ├── Daily decay applied ONLY if ≥23h since last update
                    ├── Advances weightUpdatedAt to latest processed event timestamp
                    └── Syncs selectedCategoryIds / notInterestedCategoryIds arrays
```

---

## 4. Security Architecture

### P0 Changes Applied
- **`getRankedFeed` and `syncBehaviorEvents`** both enforce `request.auth` — client-supplied `userId` in payload is ignored and overwritten with `request.auth.uid`. Unauthenticated calls throw immediately.
- **Behavior event document IDs** use the client-generated `event.id` so retries after network timeouts don't create duplicate events (idempotent writes).

---

## 5. What Is NOT Stored Server-Side

| What | Where it actually lives |
|---|---|
| Full article body HTML | Client-fetched live from RSS at read time |
| Seen article IDs | `AsyncStorage[@subtick_seen_articles]` — capped at 1000 |
| Seen article metadata | `AsyncStorage[@subtick_seen_articles_meta]` |
| Saved article IDs | `AsyncStorage[@subtick_saved_articles]` |
| Saved article HTML | `AsyncStorage[@subtick_saved_html_{id}]` |
| Saved article metadata | `AsyncStorage[@subtick_saved_articles_meta]` |
| Theme preference | `AsyncStorage[@subtick_theme_preference]` + Firestore `users/{uid}.themePreference` (dual) |
| Pending behavior events | `AsyncStorage[@subtick_behavior_queue]` until flushed |
| Failed RSS feed flags | `AsyncStorage[@subtick_rss_failed_{articleId}]` per device |
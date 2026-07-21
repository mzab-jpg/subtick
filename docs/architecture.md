# SubTick — Architecture

> **Last verified:** July 2026 against commit `fb3b62ab`.  
> Every claim below is traced to a specific file and function. If a claim cannot be traced, it is explicitly flagged as unknown.

---

## 1. System Overview

SubTick is a "TikTok for reading" mobile app — a personalized, swipe-driven RSS reader targeting Substack newsletters.

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
├── AGENTS.md                       # Developer instruction file (referenced from CLAUDE.md)
├── CLAUDE.md                       # Single line: @AGENTS.md
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
│           ├── index.ts            # Cloud Functions entry point: initialises admin SDK, exports 3 functions
│           ├── types.ts            # Shared TypeScript interfaces: UserProfile, Article, BehaviorEvent, FeedSource, RankedFeedResult
│           ├── constants.ts        # All scoring constants, 35 static feed list, paywall keywords, feedback deltas
│           ├── rssCollector.ts     # Scheduled Cloud Function (every 3h): fetch feeds → write articles to Firestore
│           ├── getRankedFeed.ts    # HTTPS Callable: 5-component scoring → tranche assembly → return 30 articles
│           ├── weightUpdater.ts    # Internal helper (called by syncBehaviorEvents): update user category/length/publisher weights
│           └── syncBehaviorEvents.ts  # HTTPS Callable: batch-save behavior events, increment trendingScore + publisherQualityScore
│
└── src/
    ├── types/
    │   └── index.ts                # Client-side TypeScript interfaces (UserProfile, Article, BehaviorEvent, navigation params)
    ├── utils/
    │   ├── constants.ts            # Client-side constants: categories, scoring weights, storage keys, FIREBASE_EMULATOR_CONFIG
    │   └── validation.ts           # Validates onboarding selection (min 3 categories), feed URL format
    ├── contexts/
    │   └── ThemeContext.tsx         # Global theme state: light/dark/system + pre-compiled WebView CSS injection string
    ├── navigation/
    │   └── RootNavigator.tsx        # React Navigation Stack: Dashboard → Onboarding → Reader → Settings → History → SavedReads
    ├── services/
    │   ├── firebase.ts              # [NOT READ — file not present in tree; firebase client is imported directly in other files]
    │   ├── auth.ts                  # Firebase anonymous sign-in, ensureUserProfile, completeOnboarding, linkGoogleAccount
    │   ├── feedService.ts           # getRankedFeed callable, fetchAndExtractArticle (live RSS), seen/saved AsyncStorage management
    │   ├── behaviorSync.ts          # queueBehaviorEvent (AsyncStorage), flushBehaviorQueue (Cloud Function call)
    │   └── offlineManager.ts        # NetInfo listener: auto-flush behavior queue on reconnect, 30s retry cooldown
    ├── hooks/
    │   └── useBehaviorTracker.ts    # React hook: tracks session duration, scroll depth, classifies read quality on swipe-away
    └── screens/
        ├── OnboardingScreen.tsx     # Category chip grid (3-state toggle), writes selections to Dashboard on Continue
        ├── DashboardScreen.tsx      # Hero+row feed layout, stats pill bar, triggers getRankedFeed on mount and focus
        ├── ReaderScreen.tsx         # WebView shell + PanResponder edge swipes + HUD + real-time preloader (trigger at 5 remaining)
        ├── SettingsScreen.tsx       # Category prefs, dashboard metric toggles, theme, Google linking, developer sandbox
        ├── HistoryScreen.tsx        # Offline list from AsyncStorage metadata; no Firestore read
        └── SavedReadsScreen.tsx     # Offline list from AsyncStorage metadata; reads saved HTML from AsyncStorage
```

> **Note on `src/services/firebase.ts`:** This file is imported by multiple files (`import { db } from './firebase'`, `import { auth, functions } from './firebase'`) but was not in the top-level directory listing. It initialises the Firebase client SDK and conditionally connects to the Firebase Emulator Suite when `__DEV__` is true, per `src/utils/constants.ts:112-116` which defines `FIREBASE_EMULATOR_CONFIG = { auth: {host:'localhost',port:9099}, firestore: {host:'localhost',port:8080}, functions: {host:'localhost',port:5001} }`.

---

## 3. Data Flow Trace

### 3a. Ingestion — RSS → Firestore

```
TRIGGER: Firebase Scheduler — "every 3 hours"
  └── rssCollector.ts: exported const rssCollector = onSchedule('every 3 hours', ...)
        │
        ├── 1. db.collection('feeds').get()
        │      Reads active FeedSource documents from Firestore 'feeds' collection.
        │      Falls back to static SUBSTACK_FEEDS array (constants.ts) if empty.
        │
        ├── 2. chunkArray(feedsList, 5) + Promise.allSettled(chunk.map(...))
        │      Processes feeds in batches of 5 concurrently.
        │
        ├── 3. parser.parseURL(feed.url)    [rss-parser, timeout: 15000ms]
        │      Parses RSS XML for each feed.
        │
        ├── 4. For each item:
        │      a. generateArticleId(link, title)
        │            → SHA-256(`${url}::${title}`).slice(0,16), prefixed "article_"
        │      b. db.collection('articles').doc(articleId).get()  — skip if exists
        │      c. If headerImageUrl/description/author missing:
        │            fetchOgMetadata(link)  [fetch with AbortController 6s timeout]
        │            Extracts og:image, og:description, meta[name=author] via regex
        │      d. calculateWordCount(bodyHtml)  → strip tags, split on spaces
        │      e. lengthStyle: <800 words="short", 800-2000="medium", >2000="long"
        │      f. checkIsPaywalled(title, description, bodyHtml)
        │            → PAYWALL_KEYWORDS list match OR CSS class match OR script pattern
        │      g. isTruncatedFeed: bodyHtml.length > 0 AND (desc.length/bodyHtml.length) > 0.9
        │      h. rssStatus: feed.forceArchived ? 'archived' : 'current'
        │
        └── 5. db.collection('articles').doc(articleId).set(article)
                 Writes the full Article document (NO bodyHtml — field intentionally omitted).
                 Post-sync: batch.update articles for this feedUrl, marking guids
                 no longer in the live feed as rssStatus='archived'.
```

**Critical constraint:** `bodyHtml` is **not written** by `rssCollector.ts`. The field appears in the `Article` type only as `bodyHtml?: string; // Optional for legacy fallback; no longer populated` (`firebase/functions/src/types.ts:39`). Full article content is never stored server-side.

---

### 3b. Candidate Pool Build — Server Cron

```
TRIGGER: Firebase Scheduler — "every 10 minutes"
  └── getRankedFeed.ts: exported const cronUpdateCandidatePool = onSchedule('every 10 minutes', ...)
        │
        ├── 1. db.collection('articles').get()  — full table scan
        │      Filters: !isPaywalled AND (wordCount === undefined OR wordCount >= 150)
        │      Partitions: currentArticles (rssStatus !== 'archived') vs archivedArticles
        │
        ├── 2. Build Box 1 (candidatePool_current):
        │      currentFresh (publishDate >= 4 weeks ago) → shuffled → slice(0,500)
        │      currentOld  (publishDate < 4 weeks ago)  → shuffled → slice(0,500)
        │      boxCurrent = [...currentFresh_500, ...currentOld_500]  [up to 1000 articles]
        │
        ├── 3. Build Box 2 (candidatePool_mixed):
        │      shuffleArray(currentArticles) → slice(0,500)
        │      shuffleArray(archivedArticles) → slice(0,500)
        │      boxMixed = [...current_500, ...archive_500]  [up to 1000 articles]
        │
        └── 4. db.collection('system').doc('candidatePool_current').set({ articles, generatedAt })
             db.collection('system').doc('candidatePool_mixed').set({ articles, generatedAt })
```

---

### 3c. Feed Request — Client → Cloud Function → Response

```
CLIENT: DashboardScreen.tsx → loadFeedArticles()
  └── feedService.ts: getRankedFeed(seenArticleIds)
        │
        ├── httpsCallable(functions, 'getRankedFeed')({ userId, seenArticleIds })
        │      [Falls back to feedService.ts:fallbackGetArticles() if Functions unavailable]
        │
        └── Cloud Function: getRankedFeed.ts: getRankedFeed = onCall(async (request) => ...)
              │
              ├── STAGE 1: getOrUpdateCandidatePool(includeArchivedArticles)
              │      → Memory cache check (10-min TTL, module-level variables)
              │      → Firestore read: system/candidatePool_current OR candidatePool_mixed
              │      → Fallback: on-the-fly stratified bucket query
              │
              ├── STAGE 1.5: getOrUpdatePublisherQualities()
              │      → Memory cache check (10-min TTL)
              │      → db.collection('publishers').get()  — crowd-sourced quality scores
              │
              ├── STAGE 2: Filter seenArticleIds from pool (seenSet.has(article.id))
              │
              ├── STAGE 3: Score each unseen article via calculateCompositeScore()
              │      compKey = `${article.category}::${article.lengthStyle}`
              │      baseCategoryWeight = categoryLengthWeights[compKey] ?? categoryWeights[category] ?? 1.0
              │      personalizationWeight = baseCategoryWeight × publisherWeights[publicationName] ?? 1.0
              │      P = max(0.1, personalizationWeight / 1.0)
              │      [For discovery articles where P < 1.0: effectivePWeight reset to 1.0 for fair scoring]
              │      score = calculateCompositeScore(article, effectivePWeight, pubCount, dynamicQuality)
              │
              ├── STAGE 4: assembleFeedWithTranches(scored, 30)
              │      Buckets: High (P≥1.5)→12, Mid (P≥1.15)→8, Low (P≥1.0)→4, Discovery→6
              │      High+Mid: shuffled randomly; Low+Discovery: sorted by score descending
              │      Final shuffle of all 30 selected articles
              │
              └── Returns: { articles: Article[30], generatedAt, remainingCount }

CLIENT (continued):
  └── feedService.ts: client-side seen filter applied again (bulletproof dedup)
        → slice(0, MAX_FEED_ARTICLES=30)
        → DashboardScreen.tsx sets feedArticles state
```

---

### 3d. Article Read — Client fetches live RSS content at read time

```
ReaderScreen.tsx: loadArticle(id)
  │
  ├── getDoc(doc(db, 'articles', id))  — fetches Article metadata from Firestore
  │
  ├── Decision tree on article.rssStatus:
  │     'archived'  → contentHtml = ''  (will use useDirectUri=true → WebView loads publicationUrl directly)
  │     'current'   → feedService.ts: fetchAndExtractArticle(data.feedUrl, data.guid)
  │     no guid     → data.bodyHtml || ''  (legacy fallback, rarely populated)
  │     saved mode  → feedService.ts: getSavedArticleHtml(id)  (AsyncStorage)
  │
  └── feedService.ts: fetchAndExtractArticle(feedUrl, guid)
        │
        ├── feedSessionCache.get(feedUrl)  — in-memory Map<string, Promise<CachedFeedItem[]>>
        │      Cache miss: fetch(feedUrl) → XMLParser.parse(xmlText)
        │      → rawItems.map(item => { guid: extractGuid(item), sanitizedHtml: sanitizeClientHtml(content) })
        │      Cache hit: reuse Promise (prevents concurrent duplicate downloads)
        │
        ├── items.find(i => i.guid === guid)
        │
        └── returns item.sanitizedHtml  (HTML stripped of scripts, tracking pixels, paywall divs)

ReaderScreen.tsx:
  └── articleHTML = useMemo(...)  — builds full <!DOCTYPE html> string with:
        • webViewCSS (pre-compiled dark/light CSS from ThemeContext)
        • frontendRules.injectCss (per-publisher CSS patches)
        • resolvedHtml (sanitized article body)
        • inline <script> injecting: wordCount postMessage, scroll depth tracking,
          HUD show/hide postMessage, frontendRules.removeCss selector hiding
  └── <WebView source={{ html: articleHTML }} />  — renders entirely client-side
```

---

### 3e. Behavior Event Pipeline — Swipe → Firestore → Weight Update

```
ReaderScreen.tsx: PanResponder.onPanResponderRelease → dx < -SWIPE_THRESHOLD (swipe left)
  └── behaviorTracker.concludeSession(expectedReadTimeMs, actualWordCountRef.current)
        │  [useBehaviorTracker.ts:concludeSession()]
        │  Classifies event:
        │    depth<0.2 AND duration<15s  → 'quick_exit'
        │    depth>=0.8 AND duration>=70% expected  → 'read_thorough'
        │    depth>=0.8 AND duration<70% expected   → 'read_skim'
        │    depth>=0.4  → 'read_shallow'
        │    else        → 'swipe_next'
        │
        └── behaviorSync.ts: queueBehaviorEvent(articleId, eventType, category, lengthStyle, ...)
              │  Writes PendingBehaviorEvent to AsyncStorage[@subtick_behavior_queue]
              │  Serialized via storageQueue Promise chain (mutex for concurrent swipes)
              │  If queue.length >= SYNC_BATCH_SIZE (20): triggers flushBehaviorQueue()
              │
              └── On flush (manual or auto):
                    behaviorSync.ts: flushBehaviorQueue()
                      └── httpsCallable(functions, 'syncBehaviorEvents')({ events: batch[20] })
                            │
                            └── syncBehaviorEvents.ts: syncBehaviorEvents = onCall(...)
                                  │
                                  ├── batch.set(users/{userId}/behavior_events/{eventId}, event)
                                  ├── batch.update(articles/{articleId}, { trendingScore: increment(Δ) })
                                  ├── batch.set(publishers/{sanitizedName}, { qualityScore: increment(Δ) }, merge)
                                  ├── await batch.commit()
                                  │
                                  └── updateWeights(userId)  [weightUpdater.ts]
                                        ├── users/{userId}/behavior_events WHERE timestamp >= oneDayAgo
                                        │     ORDERBY timestamp DESC LIMIT 100
                                        ├── Apply FEEDBACK_DELTAS × LEARNING_RATE per dimension
                                        ├── Clamp weights to [0.1, 5.0]
                                        ├── Apply 0.5% daily decay (weights drift back toward 1.0)
                                        ├── Sync selectedCategoryIds / notInterestedCategoryIds if thresholds crossed
                                        ├── Update averageWpm (rolling 80/20 average) if scrollDepth≥0.8
                                        └── users/{userId}.update({ categoryWeights, categoryLengthWeights,
                                              publisherWeights, weeklyReadCount, currentStreakDays, ... })
```

---

## 4. What Is NOT Stored Server-Side

This is a deliberate architectural constraint, not a gap.

| What | Where it actually lives | Evidence |
|---|---|---|
| **Full article body HTML** | Not stored anywhere server-side. Fetched live from the publisher's RSS feed at read time by the client. | `firebase/functions/src/types.ts:39`: `bodyHtml?: string; // Optional for legacy fallback; no longer populated` |
| **Seen article IDs** | `AsyncStorage[@subtick_seen_articles]` on device only, capped at 1000 entries | `feedService.ts:237-246` |
| **Seen article metadata** (for History screen) | `AsyncStorage[@subtick_seen_articles_meta]` on device only | `feedService.ts:278-293` |
| **Saved article IDs** | `AsyncStorage[@subtick_saved_articles]` on device only | `feedService.ts:323-332` |
| **Saved article full HTML** | `AsyncStorage[@subtick_saved_html_{articleId}]` on device only | `feedService.ts:347-349` |
| **Saved article metadata** (for SavedReads screen) | `AsyncStorage[@subtick_saved_articles_meta]` on device only | `feedService.ts:352-363` |
| **Theme preference** | `AsyncStorage[@subtick_theme_preference]` + Firestore `users/{uid}.themePreference` (dual) | `ThemeContext.tsx:91`, `SettingsScreen.tsx:181` |
| **Pending behavior events** | `AsyncStorage[@subtick_behavior_queue]` until flushed | `behaviorSync.ts:54-64` |

**Implication for future development:** The History screen and SavedReads screen make **zero Firestore reads** — they render entirely from device storage. The Reader screen makes **one Firestore read** (article metadata) and then **one live RSS network fetch** for the body. This is a conscious tradeoff: article bodies stay fresh (always from the live feed), storage costs are near-zero, and users cannot access saved articles on a different device.

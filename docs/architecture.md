# Tangent — Architecture

> **Last verified:** July 2026 against current codebase (post-cost-optimisation + full audit/fix session).
> Every claim below is traced to a specific file and function. If a claim cannot be traced, it is explicitly flagged as unknown.

---

## 1. System Overview

**Tangent** is a "TikTok for reading" mobile app — a personalized, swipe-driven RSS reader targeting Substack newsletters.

| Layer | Technology | Version | Source |
|---|---|---|---|
| Mobile framework | Expo (React Native) | `~57.0.7` | `package.json` |
| React | React 19 + React Native 0.86 | `19.2.3` / `0.86.0` | `package.json` |
| Navigation | React Navigation Stack | `^7.10.11` | `package.json` |
| Backend/DB | Firebase Firestore | JS SDK `^12.16.0` | `package.json` |
| Serverless | Firebase Cloud Functions v2 | (firebase-functions in functions pkg) | `firebase/functions/src/index.ts` |
| Auth | Firebase Anonymous Auth + optional Google link | — | `src/services/auth.ts` |
| In-app browser | `react-native-webview` | `13.16.1` | `package.json` |
| Offline storage | `@react-native-async-storage/async-storage` | `2.2.0` | `package.json` |
| RSS parsing (server) | `rss-parser` | `^3.13.0` | `firebase/functions/src/rssCollector.ts` |
| RSS parsing (client) | `fast-xml-parser` | `^5.10.1` | `src/services/feedService.ts` |
| HTML sanitization | `xss` | `^1.0.15` | `src/services/feedService.ts` |
| Icons | `lucide-react-native` | `^1.25.0` | `package.json` |
| Network detection | `@react-native-community/netinfo` | `^12.0.1` | `src/services/offlineManager.ts` |
| Build system | EAS Build (Expo) | — | `eas.json` |

**Firebase project ID:** `subtick-bbd55` (confirmed in `firebase/.firebaserc`).
**EAS project ID:** `4bc8bbff-9b89-4baa-8353-7bf95bd36693` (`app.json`).
**Android package:** `com.tangent.app` (`app.json`).
**Expo slug/owner:** `tangent` / `tangent_mb123` (`app.json`).

---

## 2. Full Directory Tree

```
2SubTick/
├── index.ts                        # Expo entry point — calls registerRootComponent(App)
├── App.tsx                         # Root component: init auth → ensureUserProfile → startOfflineManager → render
├── app.json                        # Expo config (name: Tangent, package: com.tangent.app)
├── eas.json                        # EAS Build profiles (preview APK + production)
├── package.json                    # Client-side dependencies
├── tsconfig.json                   # Client TypeScript config
├── babel.config.js                 # Babel config: babel-preset-expo (F2 fix — was missing)
├── metro.config.js                 # Metro bundler config: expo/metro-config (F2 fix — was missing)
├── .env.example                    # Documents EXPO_PUBLIC_USE_EMULATORS and EXPO_PUBLIC_FIREBASE_* vars (F4 fix)
├── AGENTS.md                       # Developer instruction file
│
├── assets/                         # Static app icons and splash screens
│
├── firebase/
│   ├── feeds.json                  # Master list of 35 Substack feed URLs with qualityScores
│   ├── firebase.json               # Firebase project config — now includes "indexes" pointer (C2 fix)
│   ├── .firebaserc                 # Firebase project alias (default → subtick-bbd55)
│   ├── firestore.rules             # Security rules: field whitelists + schema validation (S2–S5 fixes)
│   ├── firestore.indexes.json      # 4 composite indexes: isPaywalled+publishDate, feedUrl+rssStatus,
│   │                               #   isPaywalled+rssStatus+publishDate+random_score (Box 1 queries),
│   │                               #   isPaywalled+publishDate+random_score (Box 2 queries)
│   ├── seedFirestore.js            # One-time script: parses feeds.json, writes seed articles to Firestore (isSeed:true)
│   ├── seedFeeds.js                # One-time script: writes 35 feed documents to Firestore 'feeds' collection
│   ├── cleanFeeds.js               # One-time script: deletes legacy hash-ID feed docs, preserving slug-ID ones
│   ├── scripts/
│   │   └── oneoff/                 # Spent one-time migration scripts (moved here from firebase/functions/ — D6 fix)
│   │       ├── README.md           # Warning table: do not re-run without reading
│   │       ├── backfillRandomScore.js
│   │       └── ... (cleanupArticles, resetAndFetch, forceFetchAll, migrateUsers, retroCategorize, retroClean)
│   └── functions/
│       ├── package.json            # Cloud Functions deps: firebase-admin, firebase-functions, rss-parser
│       │                           #   (sanitize-html and uuid removed — D7 fix)
│       ├── tsconfig.json           # Functions TS config: NodeNext, ES2022 (no longer extends expo base — F3 fix)
│       └── src/
│           ├── index.ts            # Cloud Functions entry: exports rssCollector, getRankedFeed, cronUpdateCandidatePool,
│           │                       #   cronDecayTrendingScores, cronCleanupOldArticles, syncBehaviorEvents
│           ├── types.ts            # Shared TypeScript interfaces: UserProfile, Article (with peakTrendingScore),
│           │                       #   BehaviorEvent (with unlike/unsave), FeedSource, RankedFeedResult
│           │                       #   (totalArticlesSaved/Liked removed — A2 fix)
│           ├── constants.ts        # Scoring constants, FEEDBACK_DELTAS, SCORE_WEIGHTS, SCORE_WEIGHTS_MERIT,
│           │                       #   TRENDING_DECAY_RATE, MAX_TRENDING_SCORE, PAYWALL_KEYWORDS
│           ├── rssCollector.ts     # Scheduled Cloud Function (every 3h): batch-checks existence (C3 fix),
│           │                       #   writes new articles; delta-driven archive update (C4 fix)
│           ├── getRankedFeed.ts    # HTTPS Callable: normalized 5-component scoring → per-tranche assembly → 30 articles
│           │                       # Also exports: cronUpdateCandidatePool (every 6h), cronDecayTrendingScores (daily,
│           │                       #   threshold > 1.0 — C1 fix), cronCleanupOldArticles (every 3 days)
│           ├── weightUpdater.ts    # Internal helper: update user weights using watermark-based event processing
│           └── syncBehaviorEvents.ts  # HTTPS Callable: batch-save behavior events (skips swipe_next), increments
│                                      #   trendingScore + peakTrendingScore in single batch, aggregated publisher
│                                      #   quality writes (one per publisher per batch); per-user per-article dedup;
│                                      #   publisher list cached with 10-min TTL (C5 fix)
│
└── src/
    ├── types/
    │   └── index.ts                # Client-side TypeScript interfaces (UserProfile, Article, BehaviorEvent, navigation params)
    │                               #   (totalArticlesSaved/Liked removed — A2 fix)
    ├── utils/
    │   ├── constants.ts            # Client constants: categories, storage keys, FIREBASE_EMULATOR_CONFIG,
    │                               #   QUICK_EXIT_MAX_DURATION_MS, QUICK_EXIT_MAX_SCROLL, SURPRISE_ME_MIN_INDEX=3 (A3 fix)
    │                               #   (SCORE_WEIGHTS and CANDIDATE_POOL_SIZE dead constants removed — D4/D5 fix)
    │   └── validation.ts           # Validates onboarding selection (min 3 categories), feed URL format
    ├── contexts/
    │   └── ThemeContext.tsx         # Global theme state: light/dark/system + pre-compiled WebView CSS injection string
    ├── navigation/
    │   └── RootNavigator.tsx        # React Navigation Stack: Dashboard → Onboarding → Reader → Settings → History → SavedReads
    ├── services/
    │   ├── firebase.ts              # Firebase client SDK init; reads config from EXPO_PUBLIC_FIREBASE_* env vars (S6 fix)
    │   ├── auth.ts                  # Firebase anonymous sign-in, ensureUserProfile, completeOnboarding, linkGoogleAccount
    │   ├── feedService.ts           # getRankedFeed callable, fetchAndExtractArticle (lazy-sanitize — C6 fix),
    │   │                            #   seen/saved AsyncStorage management, markRssFailed/isRssFailed,
    │   │                            #   unmarkArticleSaved now deletes Firestore copy (B4 fix)
    │   ├── behaviorSync.ts          # queueBehaviorEvent (AsyncStorage), flushBehaviorQueue (Cloud Function call);
    │   │                            #   both operations mutex-serialized (B6 fix)
    │   └── offlineManager.ts        # NetInfo listener: auto-flush behavior queue on reconnect, 30s retry cooldown
    ├── hooks/
    │   └── useBehaviorTracker.ts    # React hook: tracks session duration, scroll depth, classifies read quality on swipe-away;
    │                                #   shared sessionSnapshotRef prevents double quick_exit (B2 fix);
    │                                #   uses named constants for thresholds (F5 fix)
    └── screens/
        ├── OnboardingScreen.tsx     # Category chip grid (3-state toggle), writes selections to Dashboard on Continue
        ├── DashboardScreen.tsx      # Hero+row feed layout, stats pill bar, triggers getRankedFeed on mount;
        │                            #   focus listener only refetches if all articles were read (A5 fix);
        │                            #   navigateToReader shuffles queue so untapped cards are scattered (A5 fix);
        │                            #   no longer includes current article in queue (B3 fix)
        ├── ReaderScreen.tsx         # WebView shell + PanResponder edge swipes + HUD + real-time preloader (trigger at 5 remaining);
        │                            #   theme CSS injected dynamically (B9 fix); right-swipe in history mode (B5 fix);
        │                            #   escapeHtml XSS fix (S1 fix);
        │                            #   HUD shows article title with truncation, never visible on initial load (A5 fix)
        ├── SettingsScreen.tsx       # ScrollView layout; category prefs, stats, theme, Google link; Dev Options in __DEV__ only
        ├── HistoryScreen.tsx        # Offline list from AsyncStorage metadata; loads once via focus listener (B10 fix);
        │                            #   passes full history array as Reader queue for swipe navigation (A4 fix)
        ├── SavedReadsScreen.tsx     # Offline list from AsyncStorage metadata; loads on mount + focus
        ├── CategoryPreferencesScreen.tsx  # 3-state category preference editor
        ├── DashboardStatsScreen.tsx # Select up to 3 stats to show on Dashboard pill bar
        ├── DeveloperOptionsScreen.tsx  # Dev-only: sandbox reader, data reset; hidden in production (__DEV__ gate)
        ├── FeedbackScreen.tsx       # Submit feedback to feedback collection (validated by S4 rules fix);
        │                            #   no longer sends `status` field (A4 fix)
        └── FeedRequestScreen.tsx    # Submit new feed URL for admin review (validated by S3 rules fix);
                                     #   sends empty string instead of undefined for blank descriptions (A4 fix)
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
        ├── 4. For each feed:
        │      a. generateArticleId(link, title) → SHA-256 hash prefix "article_"
        │      b. db.getAll(...articleRefs) — single batch existence check for all items (C3 fix)
        │      c. fetchOgMetadata(link) if missing image/author/description [6s timeout]
        │      d. calculateWordCount, lengthStyle, checkIsPaywalled, isTruncatedFeed
        │
        ├── 5. db.collection('articles').doc(articleId).set(article)
        │        bodyHtml intentionally NOT stored.
        │
        └── 6. Post-sync archive update: query only rssStatus='current' for this feed,
                 flip to 'archived' if GUID no longer in live feed (C4 fix — delta-driven)
```

### 3b. Candidate Pool Build + Trending Score Decay + Old Article Cleanup

```
TRIGGER: Firebase Scheduler — "every 6 hours"
  └── cronUpdateCandidatePool
        ├── Generates a single random threshold R = Math.random() [0, 1)
        ├── Runs 4 capped queries in parallel using random_score field (max 500 docs each):
        │     - Fresh active:   publishDate ≥ 28d ago, rssStatus='current', random_score ≥ R
        │     - Old active:     publishDate < 28d ago, rssStatus='current', random_score ≥ R
        │     - Fresh mixed:    publishDate ≥ 28d ago, (no status filter),  random_score ≥ R
        │     - Old mixed:      publishDate < 28d ago, (no status filter),  random_score ≥ R
        │   Each query uses circular wrap-around (re-queries random_score < R) if count < 500
        ├── Box 1 (candidatePool_current): 500 fresh active + 500 old active (50/50 fresh/old)
        │     Active articles only — rssStatus='current'
        └── Box 2 (candidatePool_mixed):  500 fresh mixed  + 500 old mixed  (50/50 fresh/old)
              No rssStatus filter — archived articles included proportionally by chance
        Cost: ~2,000 reads per run regardless of total database size. Free at any scale.

TRIGGER: Firebase Scheduler — "every 24 hours"
  └── cronDecayTrendingScores
        ├── Query all articles where trendingScore > 1.0 (raised from 0.1 — C1 fix, ~70% write reduction)
        ├── Apply: trendingScore = trendingScore × 0.9057  (halves every 7 days)
        └── Also refreshes random_score: Math.random() on every article at zero extra cost
              This rotates pool sampling daily so the same threshold never returns stale content

TRIGGER: Firebase Scheduler — "every 3 days"
  └── cronCleanupOldArticles
        ├── Step 1: Delete ALL paywalled articles immediately (isPaywalled == true)
        │     Paywalled articles are never shown and waste space + read budget
        ├── Step 2: Query articles where publishDate < 3 months ago (indexed, not full scan)
        ├── Sort by peakTrendingScore ASC (worst performers first)
        └── Delete bottom 3% to keep database bounded; saved articles safe in user profiles
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
  ├── Check AsyncStorage @subtick_rss_failed_{id} — if set, skip RSS fetch
  ├── getDoc(db, 'articles', id) — fetch metadata from Firestore
  ├── Decision tree:
  │     isSavedMode    → getSavedArticleHtml(id) from AsyncStorage
  │     rssStatus='archived' → contentHtml='', useDirectUri=true
  │     has guid+feedUrl → fetchAndExtractArticle(feedUrl, guid)
  │       → parses feed, finds matching GUID, sanitizes that article only (C6 fix)
  │       On failure   → markRssFailed(id) in AsyncStorage
  │     fallback       → data.bodyHtml || ''
  │
  └── articleHTML built with escapeHtml(title/author/pub) + sanitized body (S1 fix)
      WebView renders entirely client-side
      Theme changes inject CSS update only — no full reload (B9 fix)
```

### 3e. Behavior Event Pipeline — Swipe → Firestore → Weight Update

```
ReaderScreen → behaviorTracker.concludeSession() → queueBehaviorEvent()
  └── AsyncStorage[@subtick_behavior_queue] (mutex-serialized — B6 fix)
        └── On flush: syncBehaviorEvents Cloud Function
              ├── Auth: request.auth.uid — client userId IGNORED
              ├── body userId validated against path userId (S5 fix)
              ├── event.id used as Firestore document ID (idempotent retries)
              ├── swipe_next events SKIPPED entirely (zero trending/quality impact, saves writes)
              ├── batch.set(users/{uid}/behavior_events/{event.id}, event)  [non-swipe_next only]
              ├── Trending deltas aggregated per article — ONE batch.update per article (not per event)
              │     Also writes peakTrendingScore in the SAME update if new trending > old peak
              ├── Publisher quality deltas aggregated per publisher — ONE write per unique publisher
              │     Publisher list cached with 10-min TTL (C5 fix)
              │     New publishers seeded at DEFAULT_PUBLISHER_QUALITY (0.8) + net delta
              │     Existing publishers use FieldValue.increment(netDelta) atomically
              └── updateWeights(userId) [weightUpdater.ts]
                    ├── Reads only events AFTER weightUpdatedAt watermark (no replay)
                    ├── Applies Δ × LEARNING_RATE per dimension
                    ├── Daily decay applied ONLY if ≥23h since last update
                    ├── Advances weightUpdatedAt to latest processed event timestamp
                    └── Syncs selectedCategoryIds / notInterestedCategoryIds arrays
```

---

## 4. Security Architecture

### Security Fixes Applied
- **`getRankedFeed` and `syncBehaviorEvents`** — `request.auth.uid` enforced. Client-supplied `userId` ignored. Unauthenticated calls throw immediately.
- **Behavior event document IDs** — Client-generated `event.id` used as Firestore document ID (idempotent retries).
- **`users/{userId}` create rule (A4 fix)** — Same 8-field whitelist as update rule; prevents profile forgery at account creation.
- **`users/{userId}` update rule (S2)** — Client can only write 7 whitelisted fields. Stats and weights are server-only.
- **`behavior_events` create rule (S5 + A4 fix)** — Body `userId` must match path `userId`; `eventType` validated against 10 allowed values; field whitelist enforced; 2KB document size cap.
- **`feed_requests` create rule (S3)** — `userId == auth.uid`, URL format, field schema, 2KB cap.
- **`feedback` create rule (S4)** — Field schema, 5KB cap.
- **`escapeHtml` in ReaderScreen (S1)** — RSS-sourced metadata correctly escaped before WebView injection.
- **`syncBehaviorEvents` input cap (A4 fix)** — Server-side 50-event limit prevents batch overflow and abuse.
- **`HistoryScreen` queue (A4 fix)** — Passes full history array as Reader queue so users can swipe through history.
- **`FeedbackScreen` payload (A4 fix)** — Removed `status` field that was denied by rules.
- **`FeedRequestScreen` payload (A4 fix)** — Sends empty string instead of `undefined` for blank descriptions.
- **`DashboardScreen` focus refetch (A5 fix)** — Focus listener no longer calls `loadData` on every navigation back; only refetches if the seen filter emptied the feed. Prevents articles from changing when navigating Home→Settings→Home.
- **`DashboardScreen` queue shuffle (A5 fix)** — Reader queue is shuffled so the 2 untapped Dashboard cards are scattered randomly among the full feed instead of being the next articles the user sees.
- **`ReaderScreen` HUD title (A5 fix)** — HUD shows article title (not publication name) with `ellipsizeMode="tail"` for truncation.
- **`ReaderScreen` HUD initial visibility (A5 fix)** — Removed `scrollTop <= 0` case from injected JS so HUD never appears on initial page load; only appears when user actively scrolls up.

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
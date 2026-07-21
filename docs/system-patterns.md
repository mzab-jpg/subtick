# SubTick — System Patterns

> **Last verified:** July 2026 against commit `fb3b62ab`.  
> All values, formulas, and constants are pulled directly from source code — no estimates.

---

## 1. State Management

### Global State (React Context)
| State | Provider | Consumers | Persistence |
|---|---|---|---|
| Theme (light/dark/system) + computed color palette | `ThemeContext.tsx: ThemeProvider` | All screens via `useTheme()` | `AsyncStorage[@subtick_theme_preference]` + Firestore `users/{uid}.themePreference` |
| Pre-compiled WebView CSS string | `ThemeContext.tsx: webViewCSS` computed in `useMemo` | `ReaderScreen.tsx` | Recomputed on theme change, never persisted |

### Local Component State
- `DashboardScreen.tsx`: `feedArticles: Article[]`, `userProfile: UserProfile | null`, `loading: boolean` — fetched fresh on every screen focus
- `ReaderScreen.tsx`: `article`, `resolvedHtml`, `currentIndex`, `activeQueueIds`, `articleCache` (in-memory sliding window), `isLiked`, `isSaved`, `hudVisible`, `queueExhausted`, `preloading`
- `OnboardingScreen.tsx`: `chipStates: Record<string, 'selected'|'not_interested'|'neutral'>` — pure local, never synced until Continue is pressed
- `SettingsScreen.tsx`: `profile: UserProfile | null` — fetched once on mount, optimistically updated on category changes

### On-Device-Only State (AsyncStorage — never sent to server)
| Key | Content | Max Size |
|---|---|---|
| `@subtick_seen_articles` | `string[]` of article IDs | 1000 entries (oldest dropped) |
| `@subtick_seen_articles_meta` | `Record<string, {id,title,publicationName,category,estimatedReadMinutes}>` | Unbounded (mirrors seen IDs) |
| `@subtick_saved_articles` | `string[]` of saved article IDs | Unbounded |
| `@subtick_saved_articles_meta` | `Record<string, ArticleMeta>` | Unbounded |
| `@subtick_saved_html_{articleId}` | Full sanitized HTML string for offline reading | One key per saved article |
| `@subtick_behavior_queue` | `PendingBehaviorEvent[]` pending sync | 500 max (oldest dropped first) |
| `@subtick_theme_preference` | `'system'|'light'|'dark'` | Tiny |

Sources: `src/utils/constants.ts:119-127`, `src/services/feedService.ts`, `src/contexts/ThemeContext.tsx:70`

### AsyncStorage Mutex (Concurrency Safety)
All AsyncStorage operations in `feedService.ts` that involve read-modify-write (seen/saved lists) are serialized through a **Promise chain mutex**:

```typescript
// feedService.ts:42-48
let storageQueue = Promise.resolve();

async function enqueueStorageOperation<T>(operation: () => Promise<T>): Promise<T> {
  const nextInLine = storageQueue.then(operation);
  storageQueue = nextInLine.then(() => {}).catch(() => {});
  return nextInLine;
}
```

This prevents rapid-swipe race conditions where two concurrent writes would both read the same stale array and each overwrite the other's changes. All `markArticleSeen`, `markArticleSaved`, `unmarkArticleSaved`, `getSeenArticleIds`, `getSavedArticleIds` calls go through this queue.

---

## 2. The Ranking / Scoring Algorithm

### 2a. 5-Component Composite Score Formula

Source: `firebase/functions/src/getRankedFeed.ts:50-76`, constants from `firebase/functions/src/constants.ts:47-53`

```
Score = (0.30 × P) + (0.20 × T) + (0.25 × R) + (0.15 × Q) + (0.10 × U)
```

| Component | Symbol | Weight | Formula | Source |
|---|---|---|---|---|
| Personalization Boost | P | 0.30 | `max(0.1, personalizationWeight / 1.0)` | `getRankedFeed.ts:58` |
| Trending Boost | T | 0.20 | `max(0.1, 1.0 + article.trendingScore / 2.5)` | `getRankedFeed.ts:59` |
| Recency Boost | R | 0.25 | `2.0 / (1.0 + daysOld / 7)` | `getRankedFeed.ts:60` |
| Quality Boost | Q | 0.15 | `dynamicPublisherQualityScore` (clamped [0.20, 1.00]) | `getRankedFeed.ts:61,283` |
| Cross-User Collaboration (Diversity) | U | 0.10 | `1.0 - (min(1.0, (articlesInSamePub - 1) / 15) * 0.6)` | `getRankedFeed.ts:67` |

**SCORE_WEIGHTS** in `constants.ts:47-53`:
```typescript
export const SCORE_WEIGHTS = {
  categoryBoost: 0.3,
  trendingBoost: 0.2,
  recencyBoost: 0.25,
  qualityBoost: 0.15,
  crossUserCollab: 0.1,
};
```

### 2b. Personalization Weight (P) — 3D Matrix

Source: `getRankedFeed.ts:441-464`

```typescript
const compKey = `${article.category}::${article.lengthStyle}`;
const baseCategoryWeight = categoryLengthWeights[compKey]
  ?? categoryWeights[article.category]
  ?? 1.0;
const basePublisherWeight = publisherWeights[article.publicationName] ?? 1.0;
const personalizationWeight = baseCategoryWeight * basePublisherWeight;
const P = Math.max(0.1, personalizationWeight / 1.0);

// Discovery articles (P < 1.0) compete on quality alone, not negative personalization
if (P < 1.0) { effectivePWeight = 1.0; }
```

Three dimensions, multiplied together:
1. **Category weight** (e.g., `"Technology & Innovation"` → `1.5`)
2. **Category+Length composite weight** (e.g., `"Technology & Innovation::long"` → `1.7`) — overrides category-only weight
3. **Publisher weight** (e.g., `"Stratechery"` → `1.3`)

### 2c. Recency Boost (R) — Half-Life Logic

`R = 2.0 / (1.0 + daysOld / 7)`

| Age | R Value |
|---|---|
| 0 days | 2.00 (maximum) |
| 7 days | 1.00 |
| 14 days | 0.67 |
| 28 days | 0.44 |
| 56 days | 0.27 |

### 2d. Diversity Penalty (U) — Inverted Publisher Score

`U = 1.0 - (min(1.0, (articlesInSamePub - 1) / 15) * 0.6)`

| Articles from same publisher in pool | U Value | Notes |
|---|---|---|
| 1 | 1.00 | No penalty |
| 8 | 0.72 | Moderate penalty |
| 16+ | 0.40 | Maximum 60% penalty floor |

### 2e. Trending Score Increments

Source: `firebase/functions/src/syncBehaviorEvents.ts:17-26`

```typescript
function getTrendingIncrement(eventType: string): number {
  switch (eventType) {
    case 'save':          return 3.0;
    case 'like':          return 2.0;
    case 'read_thorough': return 1.5;
    case 'read_skim':     return 0.5;
    case 'read_shallow':  return 0.2;
    default:              return 0.0;  // swipe_next, quick_exit, swipe_not_interested
  }
}
```

`trendingScore` is a raw accumulator on the `articles/{id}` Firestore document, incremented atomically with `FieldValue.increment()`. There is no decay or normalization logic currently applied to `trendingScore` on the server — it grows unboundedly. The T component in scoring divides it by 2.5 (`1.0 + trendingScore / 2.5`) to moderate impact.

### 2f. Tranche-Based Feed Assembly

Source: `getRankedFeed.ts:302-397`

After scoring, articles are sorted into 4 buckets by P value, then exact counts are picked per bucket:

| Tranche | P threshold | Target count | Selection method |
|---|---|---|---|
| High | P ≥ 1.5 | 12 | **Random shuffle** |
| Mid | P ≥ 1.15 | 8 | **Random shuffle** |
| Low | P ≥ 1.0 | 4 | Sorted by score DESC |
| Discovery | P < 1.0 | 6 | Sorted by score DESC |

**Overflow/fallback:** If a higher tranche has fewer articles than its target, the shortfall is cascaded down to the next tranche's target. Final feed of 30 is shuffled entirely before return (`shuffleArray(finalFeed)`).

**Total feed size:** `RETURN_FEED_SIZE = 30` (`getRankedFeed.ts:19`), `MAX_FEED_ARTICLES = 30` (client, `constants.ts:84`).

---

## 3. Weight Learning System

### 3a. Feedback Delta Multipliers (Δ)

Source: `firebase/functions/src/constants.ts:56-65` (server) and `src/utils/constants.ts:62-71` (client — identical values)

```typescript
export const FEEDBACK_DELTAS: Record<string, number> = {
  save:                +0.40,
  like:                +0.30,
  read_thorough:       +0.20,
  read_skim:           +0.05,
  read_shallow:        +0.00,
  swipe_next:          +0.00,
  quick_exit:          -0.20,
  swipe_not_interested: -0.40,
};
```

### 3b. Dimension-Specific Learning Rates

Source: `firebase/functions/src/weightUpdater.ts:90-93`

```typescript
const categoryL  = LEARNING_RATE * 1.0;  // 0.08 × 1.0 = 0.08
const lengthL    = LEARNING_RATE * 1.5;  // 0.08 × 1.5 = 0.12
const publisherL = LEARNING_RATE * 2.0;  // 0.08 × 2.0 = 0.16
```

`LEARNING_RATE = 0.08` (`constants.ts:68`)

### 3c. Weight Update Formula

For each behavior event processed:
```
newWeight[category]   += Δ × 0.08
newWeight[cat::style] += Δ × 0.12
newWeight[pub::name]  += Δ × 0.16
```

### 3d. Clamping

```
weight = max(MIN_CATEGORY_WEIGHT, min(MAX_CATEGORY_WEIGHT, weight))
MIN_CATEGORY_WEIGHT = 0.1   (constants.ts:69)
MAX_CATEGORY_WEIGHT = 5.0   (constants.ts:70)
```

### 3e. Daily Decay

Source: `weightUpdater.ts:255-263`

```typescript
function applyDecay(weights: Record<string, number>): Record<string, number> {
  // Move weight towards 1.0 by the decay rate
  decayed[cat] = 1.0 + (weight - 1.0) * DAILY_DECAY_RATE;
}
// DAILY_DECAY_RATE = 0.995  (constants.ts:71)
```

Effect: each day, a weight's distance from 1.0 is reduced by 0.5%. A weight of 5.0 decays toward 1.0 over ~139 days if no further feedback occurs.

### 3f. UI Sync Thresholds

When `weightUpdater.ts` runs after syncing events, it also updates `selectedCategoryIds` and `notInterestedCategoryIds` arrays to stay in sync with the learned weights:

```typescript
// Source: weightUpdater.ts:152-170
if (val <= DEFAULT_NOT_INTERESTED_WEIGHT)  // 0.2 — add to notInterested, remove from selected
if (val >= DEFAULT_SELECTED_WEIGHT)        // 1.5 — add to selected, remove from notInterested
if (val > 0.2 && val < 1.5 && wasNotInterested) // remove from notInterested (re-neutralized)
```

Constants: `DEFAULT_SELECTED_WEIGHT = 1.5`, `DEFAULT_NOT_INTERESTED_WEIGHT = 0.2`, `DEFAULT_NEUTRAL_WEIGHT = 1.0` (`constants.ts:48-50`)

### 3g. Reading Stats Updates (WPM, Articles Finished)

Source: `weightUpdater.ts:172-225`

- **`totalArticlesRead`** incremented when: `(read_thorough OR read_skim) AND scrollDepth >= 0.8 AND sessionDuration > 10000ms`
- **`averageWpm`** rolling average: `newWpm = round((oldWpm × 0.8) + (sessionWpm × 0.2))`
  - `sessionWpm = wordCount / minutesSpent`
  - Bounds check: discards sessions where `sessionWpm < 150` or `sessionWpm > 750`
  - Uses `event.actualWordCount` (reported live from WebView JavaScript) first; falls back to Firestore `articles/{id}.wordCount`
  - **Skips WPM calculation if `article.isTruncatedFeed === true`** (word count from DB would be wrong for truncated feeds)
- **`totalReadTimeMs`** accumulates `event.sessionDuration` for any non-exit event
- **`weeklyReadCount`** and **`currentStreakDays`** recomputed from subcollection query in `updateReadStats()`

---

## 4. Behavior Event Classification

Source: `useBehaviorTracker.ts:114-146`

Called on swipe-left (next article). Decision tree:

```
if (scrollDepth < 0.2 AND sessionDuration < 15000ms):
    → 'quick_exit'
else if (scrollDepth >= 0.8):
    if (sessionDuration >= expectedReadTimeMs × 0.7):
        → 'read_thorough'
    else:
        → 'read_skim'
else if (scrollDepth >= 0.4):
    → 'read_shallow'
else:
    → 'swipe_next'
```

Right-swipe always emits `'swipe_not_interested'` (`ReaderScreen.tsx:416`).

**Quick exit fallback on unmount** (`useBehaviorTracker.ts:56-85`): If the user closes the Reader without swiping, the `useEffect` cleanup fires a `'quick_exit'` event only if `duration < 15000ms AND scrollDepth < 0.2` and the session was not already `concluded`.

**Tracking is fully disabled** (`enabled: false`) in modes: `'history'`, `'saved'`, mock/sandbox mode. Source: `ReaderScreen.tsx:119`.

---

## 5. Async / Failure Handling

### 5a. RSS Collector (Cloud Function)
| Operation | Timeout | Failure behavior |
|---|---|---|
| `parser.parseURL(feed.url)` | `15000ms` (rss-parser config, `rssCollector.ts:14`) | Caught per-feed; `totalErrors++`; other feeds continue |
| `fetchOgMetadata(link)` | `6000ms` (AbortController, `rssCollector.ts:36`) | `catch` returns empty `{}` metadata; article still written without image/description |
| Feed processing batches | `Promise.allSettled()` | One feed failure never blocks others |
| Post-collection archive sync | Separate try/catch per feed | Errors logged, not rethrown |

### 5b. Client RSS Fetch (feedService.ts)
| Operation | Timeout | Failure behavior |
|---|---|---|
| `fetch(feedUrl)` | No explicit timeout set | Network error throws; `feedSessionCache.delete(feedUrl)` clears cache so next request retries; error rethrown to `loadArticle` |
| Article not found in parsed feed | — | Throws `'Article not found in recent feed items.'`; `ReaderScreen.tsx` catches → sets `needsFallback=true` → writes `rssStatus='archived'` to Firestore → `useDirectUri=true` (raw WebView) |

### 5c. getRankedFeed Cloud Function
| Operation | Failure behavior |
|---|---|
| Firestore `system/candidatePool` read fails | Falls back to on-the-fly stratified bucket query (`getRankedFeed.ts:201`) |
| On-the-fly query also fails | Returns expired in-memory cache if available (`getRankedFeed.ts:257-260`); throws if cache is empty |
| Publisher quality scores fail | Returns expired/empty cache; articles fall back to `article.qualityScore` baseline (`getRankedFeed.ts:455`) |

### 5d. Client getRankedFeed Call (feedService.ts)
| Failure | Fallback |
|---|---|
| Cloud Function call fails | `fallbackGetArticles()`: direct Firestore query `articles` ORDER BY `publishDate DESC` LIMIT 90, filter non-paywalled, filter seen (`feedService.ts:186-217`) |

### 5e. Behavior Sync (offlineManager.ts + behaviorSync.ts)
| Scenario | Behavior |
|---|---|
| No network | Events remain in `@subtick_behavior_queue` |
| Network restored | `offlineManager.ts` NetInfo listener fires `attemptFlush()` |
| Sync fails | `lastFailureTime = Date.now()`; **30-second cooldown** before retry (`RETRY_COOLDOWN_MS = 30_000`, `offlineManager.ts:13`) |
| Concurrent flush already running | `isSyncing` guard prevents double-flush (`offlineManager.ts:52`) |
| `syncBehaviorEvents` batch commit fails | Logged; events remain in queue with `synced: false`; will retry on next flush |
| Flush on Reader exit | `useEffect` cleanup in `ReaderScreen.tsx:651-657` calls `flushBehaviorQueue().catch(() => {})` — silently fails, events stay queued |
| Queue overflow | `MAX_QUEUE_SIZE = 500`; oldest events dropped when exceeded (`behaviorSync.ts:58-61`) |
| Synced events cleanup | Events older than 5 minutes with `synced: true` are pruned after each flush (`behaviorSync.ts:113-116`) |

### 5f. WebView Navigation Lock
Source: `ReaderScreen.tsx:614-648`

In sanitized HTML mode: any `http` link click intercepted by `handleShouldStartLoadWithRequest` → `Linking.openURL(url); return false` (opens in OS browser).

In raw URI (archived) mode: same-domain navigations allowed (for redirects, slug changes); cross-domain links sent to OS browser. Initial load fully allowed for redirects (`webViewInitialLoadRef.current`).

WebView HTTP errors (status >= 400) or load errors set `webViewLoadError=true` → error UI with "Open in Browser" fallback link.

---

## 6. Functions with Legal / Compliance Significance

> ⚠️ **Future editors: do not modify these without understanding the implications.**

### 6a. Paywall Detection — `checkIsPaywalled()` (`rssCollector.ts:132-147`)

This function determines whether an article is paywalled and therefore excluded from the feed. Articles marked `isPaywalled: true` are filtered out at:
- Candidate pool build time (`cronUpdateCandidatePool`: `!data.isPaywalled`, `getRankedFeed.ts:102`)
- On-the-fly fallback query (`getRankedFeed.ts:224`)
- Client fallback query (`feedService.ts:201`)

**The paywall check has three mechanisms:**
1. Keyword match against `PAYWALL_KEYWORDS` list (23 phrases, `constants.ts:82-107`)
2. CSS class match: `class="*paywall*"`, `class="*subscriber-only*"`, `class="*locked-content*"`
3. Script pattern: body contains both `/paywall/i` and `<script`

Distributing paywalled content would be a terms-of-service violation with publishers. The `isPaywalled` flag being `false` should not be changed manually without verifying the article is actually free.

### 6b. `isTruncatedFeed` Flag (`rssCollector.ts:244`)

```typescript
const isTruncatedFeed = bodyHtml.length > 0 && (description.length / bodyHtml.length) > 0.9;
```

This flag is used in `weightUpdater.ts:203-206` to **skip WPM calibration** for articles where the RSS body is truncated (the word count in the DB would be falsely low). Removing this guard would corrupt all users' `averageWpm` statistics for publications that publish truncated feeds.

### 6c. Article ID Generation — `generateArticleId()` (`rssCollector.ts:100-103`)

```typescript
function generateArticleId(url: string, title: string): string {
  const hash = createHash('sha256').update(`${url}::${title}`).digest('hex');
  return `article_${hash.substring(0, 16)}`;
}
```

This deterministic hash-based ID is the **sole deduplication mechanism** preventing the same article from being written to Firestore twice across different `rssCollector` runs. The client-side `validation.ts:56` explicitly states: "Article ID generation is handled exclusively by the Cloud Function (rssCollector.ts) using SHA-256 hashing. Any client-side ID would use a different algorithm and would never match server-generated IDs." The ID format must remain stable across deployments.

### 6d. `rssStatus` Lifecycle (`rssCollector.ts:291-320`)

The `rssStatus` field (`'current'` | `'archived'`) determines whether the Reader fetches live RSS content or loads the raw webpage. Changing an article's `rssStatus` to `'archived'` means the app will load the full Substack webpage directly in a WebView (including publisher headers, ads, subscription prompts). The `forceArchived` flag on feed documents gives admins per-feed control. The client (`ReaderScreen.tsx:169-176`) also self-heals by writing `rssStatus='archived'` to Firestore when a live RSS fetch fails at read time.

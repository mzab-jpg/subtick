# Tangent — Deferred Audit Backlog

> **Created:** 17 August 2026 from the code, security, cost, Android-release, and user-experience audit.
>
> This document explains deliberately deferred items in plain language: what is happening, why it matters, what could happen if it stays unchanged, and what a future fix must achieve. The completed section records audit findings that have since been addressed; all other entries remain deferred.

## How to use this document

- For a **small, private Android test**, the high-priority items can normally wait while you learn whether people enjoy the product.
- Before **broad public growth**, revisit every high-priority item.
- If an item creates a real user problem now, bring it forward regardless of its suggested timing.

---

## Completed from this backlog

### 17 August 2026 — Startup, onboarding, Reader prefetch, and dashboard-stat batch

The following audit items are no longer deferred:

- **M1 — Reader RSS warming:** The performance diagnostic confirmed that full RSS parsing on React Native’s JavaScript workload caused Reader jank. Android now uses the source-controlled local Expo module at `modules/tangent-rss-parser`. A serial active lane serves the article the person selected, while at most two bounded workers prepare speculative future targets; the selected article therefore does not wait behind an unrelated preload, and one slow publisher does not hold every later target behind it. Lookahead retains bounded raw XML (16 ordinary-sized feeds; 5 MB cache allowance per feed) and extracts raw bodies for exactly the five upcoming Reader targets, never every entry from a publisher feed. A larger legitimate feed remains readable through direct selected-item streaming and is simply not retained. Reader holds a rolling five-upcoming-article target buffer: opening article 1 targets 2–6; each advance adds one new target. The Dashboard-tapped/current article and every article already shown are fixed. Within only the five unseen positions, a future article moves earlier only after its body is actually ready; the same recommendations remain and original order breaks ties. Repeat publishers/in-flight requests share one operation, a harmless readiness reorder does not restart the same five targets, genuine stale queued targets are replaced after a swipe, no cleaned article HTML is preloaded, and nothing is written to disk. Only an article confirmed absent from a successfully loaded feed is silently skipped when raw archived pages are disabled; temporary network/native/timeout errors remain retryable and are never stored as permanent failed articles. This keeps direct phone-to-publisher fetching while moving parse work away from Reader interaction. Android still needs physical debug and preview APK validation across representative feeds; iOS native parity remains required before enabling iOS preloading.
- **M4 — Duplicate profile sources:** `UserContext` now owns one authenticated real-time profile listener used by Dashboard, Reader, Settings, Account, preferences, and stats. Dashboard's separate listener and focus-time profile refresh were removed.
- **M6 — Dashboard stat limit and accuracy:** The stats picker prevents a fourth selection, removes duplicate old selections, and the dashboard consistently displays at most three metrics. The shown Weekly Reads value is calculated from the user's actual qualifying events in the rolling last seven days, so it falls as older reads age out. The stored historical counter remains only for compatibility.
- **M8 reliability portion — repeat onboarding:** Onboarding now saves `isOnboarded` and the choices before navigating. The screen shows Saving, blocks double taps, and leaves the user in place with a retry message if saving fails. This removes the prior Dashboard handoff/race that could cause onboarding to reappear after restart.

The remaining M8 entry below concerns only product copy and later tutorial design.

### 17 August 2026 — Universal Reader exit, stable cards, provisional stats, and category-style metric selection batch

- **History now covers every ordinary exit:** Reader owns one guarded finish route shared by the close button, Android/system back action, and queue-exhausted return. It prevents a duplicate session, writes History once, then navigates. Saved/history/sandbox browsing remains excluded.
- **Dashboard cards survive a remount:** The active feed and shown IDs are now held in a UID-scoped memory cache. If Dashboard is recreated while the app remains on the same account, it restores the same cards instead of making a replacement feed call. The cache is cleared for sign-out, reset, and deletion. Shuffle, Discover, retry, and a new account/session remain deliberate replacement paths.
- **Immediate local stat display with server correction:** The phone applies immediate display estimates after Reader exit. WPM is deliberately simple—positive article words divided by active foreground time—while completion/weekly-read metrics remain subject to server classification. Cloud Functions persist the final values and the next profile update replaces any local estimate, including after an offline delay.
- **Metric selection now matches category preferences:** Dashboard Stats uses full-row state changes plus explicit “Shown on Dashboard” / “Not shown” labels, rather than a detached tick box. It remains a maximum-three multi-select control, so it is visually related to but not identical to the category preference control.
- **Settings flash reduction:** The redundant focus-time profile refresh was removed. A zero-duration transition experiment was reverted because it worsened the visible Android flash. Settings, Account, Category Preferences, Dashboard Stats, History, and Saved Reads now keep their normal themed page shell/header mounted while data settles, showing only a small inline spinner instead of replacing the entire screen with a full-page loader.
- **Shuffle replenishment preserves remaining cards:** When the card queue becomes short, Tangent appends unseen articles after the remaining cards. It does not use the background request to replace those cards.
- **Reader visual isolation and duplicate sync:** Loading, unavailable, slow-loading, and error states now paint an opaque theme surface; the clean RSS WebView also uses that surface, so an old native webpage cannot show beneath a spinner or error. Concurrent lifecycle sync callers now join one in-progress behavior upload, preventing repeated uploads of the same queued 20-event batch.

### 17 August 2026 — Account-transition, immediate-stat, and toggle-consistency batch

- **Account changes no longer expose stale screens:** Sign out, reset, and deletion now begin an app-wide transition screen, clear old profile/stat state, then the root app remounts navigation directly to onboarding once the fresh/reset account is ready. AccountScreen no longer races a stale manual profile refresh after those operations.
- **Stats update without an avoidable queue delay:** Closing a live-feed Reader now waits for its raw session to be saved locally, immediately attempts the normal authenticated backend sync, and only then returns to Dashboard. The backend remains the source of truth for whether a session qualifies, so Tangent does not invent a finished-read count while offline or before classification.
- **Consistent binary control:** Archived Articles now uses the reusable accessible `TangentToggle`, with the same controlled colours and short native animated thumb movement in every theme. It disables while its preference write is in progress and restores the previous visual value if saving fails.

### 17 August 2026 — Reader close, stable Dashboard cards, and archive-preference batch

- **Stable Dashboard return:** Opening Reader no longer treats its entire shuffled queue as consumed. Returning without using Shuffle/Discover leaves the visible hero and row cards in place; only the article actually opened is excluded from a later explicitly requested feed.
- **History on close:** Closing a live-feed article now concludes its reading session and waits for its local History/seen metadata to be written before dismissing Reader. Browsing History, Saved Reads, and sandbox content remains excluded from this path.
- **Archived Articles respected at display time:** If extraction of an otherwise current RSS article fails, Tangent records the device-local RSS failure. It loads a raw in-app publication webpage only when Archived Articles is enabled; otherwise it silently records the unavailable item as seen and advances without exposing a raw webpage or browser escape.
- **Scroll-depth rule confirmed:** Tangent intentionally retains maximum depth reached for read classification. Scrolling back upward does not erase that reading evidence; CSS theme updates use injected JavaScript, not a WebView reload.

### 17 August 2026 — Highest-ranked opening-card batch

- **Startup-card ranking:** Tangent now reserves the highest-scoring eligible article in its original High, Mid, or Tail tranche allocation and returns it as position 0 for the Dashboard hero. This gives the opening screen a strong personalised first impression without removing the deliberately mixed discovery allocation.
- **Variety remains intentional:** The remaining cards continue through the existing random/tranche-balanced and category-aware ordering. Publisher caps, category caps, minimum-category variety, Tail discovery, and the no-avoidable-third-same-category rule remain in place. The reserved opening article is protected from later category-variety replacement.
- **Regression coverage:** The backend regression script now verifies the opening anchor for High-only, Mid-only, and Tail-only candidate situations, alongside existing size, uniqueness, category-cap, and diversity checks.

---


## High priority before broad public growth

### H1 — Private recommendation-testing controls are reachable through the normal app endpoint

**What is happening:** Tangent has a private High-Fidelity Matrix tool. It tests “what if?” recommendation settings, such as how strongly Tangent values personal interests, trends, freshness, and publication quality. It can also ask for detailed explanations of article scores. This tool currently uses the same backend entrance as the normal phone app.

A signed-in person who knows how to communicate directly with that entrance can ask for a feed using made-up test settings or ask for detailed score explanations. They cannot save settings or change everyone else’s feed. Live recommendation settings remain safe.

**Why it matters:** Think of it as an internal test panel behind the same entrance used by customers. Most people will never know it exists. A determined person can make extra backend requests, inspect more recommendation detail than a normal user needs, and create analytics activity that does not represent the live algorithm. The risk is cost/noise and less trustworthy analytics, not an immediate app takeover.

**Why deferred:** Simply blocking it would break the Matrix preview workflow you use to safely test ranking changes. The right answer is a separate protected test/admin route, which changes the internal tool’s login and connection design.

**Future outcome:** Normal phone users receive only normal live feeds. The Matrix/control tool uses a separately protected route for experimental settings and score breakdowns. Do not rely on “people probably will not find it” as protection.

**Timing:** Before sharing the Matrix widely, before broad public growth, or when analytics accuracy/cost becomes important.

### C2 — Google recovery can ask the backend to delete an arbitrary old profile

**What is happening:** If someone connects Google to an anonymous Tangent account but that Google account already belongs to an older Tangent account, Tangent recovers the older account. It then tries to clean up the unused anonymous profile by sending its internal ID to the backend.

The backend checks that someone is signed in, but cannot reliably prove the old profile belongs to that same person.

**Why it matters:** Normal users do not see other people’s internal IDs. However, if a bad actor obtained one through logs, a shared screenshot, a compromised device, a future feature, or a mistake elsewhere, they could ask the backend to delete that person’s profile data. This would not take over the account, but could remove preferences, history, and saved-reading metadata.

**Why deferred:** The current cleanup keeps Google recovery tidy and avoids unused anonymous profiles. Replacing it safely needs a deliberate ownership-proof or server-only retention design. Removing it now would change recovery behaviour.

**Future outcome:** Replace client-requested deletion with a server-only cleanup process. It should wait a defined retention period, prove a profile is genuinely abandoned, delete related data safely in pages, and never accept an arbitrary profile ID from a phone as proof of ownership.

**Timing:** Before broad public growth. Treat as urgent sooner if Firebase IDs appear in external logs, support tools, exports, or user-visible screens.

### H2 — Reading signals can be artificially manufactured

**What is happening:** Tangent learns from reading, saving, liking, and rejecting articles. These actions affect what is trending and a publication’s quality score for everyone. At present, someone can create anonymous accounts and send made-up activity more easily than is desirable at scale.

**What this could look like:** A publisher could try to make its own articles look popular. A competitor could try to push another publication down. A script could create many anonymous accounts and produce fake activity. This is unlikely to matter during small testing, but matters more as the audience, publicity, and value of being recommended grow.

**Why deferred:** The solution needs Android device verification, limits on how often actions count, and proof that feedback relates to an article Tangent actually showed the user. This is valuable but more involved than the immediate fixes.

**Future outcome:** Require real Android app/device verification, reject excessive or implausible activity, remember when a person has already affected an article recently, and count feedback only when linked to a genuine Tangent recommendation.

**Timing:** Before broad public growth, before publicity, or before making trending/publication-quality results important to publishers.

### H6 — Analytics can become expensive, overly detailed, and harder to trust

**What is happening:** Each 30-article feed records about 31 analytics events: one for the feed and one for each article shown. Tangent also records reads, saves, likes, and learning events. This helps measure recommendation quality, but grows quickly as usage grows. Some events include Tangent’s internal account ID. It is not a password, but it is a stable identifier connected to activity.

**Why it matters:** More events mean more data stored and analysed in Google systems, possible BigQuery cost, and more noise when answering product questions. Fake or Matrix-generated activity can make reports less representative of real users. Privacy notices and retention choices should match the data actually sent.

**Why deferred:** The current analytics are useful while you learn whether recommendations work. Reducing them without a measurement plan could remove useful information. This needs a product decision, not blind cost cutting.

**Future outcome:** Define the exact questions analytics must answer. Keep only events needed to answer them, avoid raw internal account IDs in GA4, consider sampling/summarising article impressions, set retention limits/budgets, and make privacy disclosures accurately describe the data.

**Timing:** Before broad public launch, substantial paid acquisition, or reliance on BigQuery dashboards for business decisions.

---

## Deferred architecture and release work

### Large-feed single-stream extraction — requires a dedicated native redesign

**What is happening:** For an RSS file that exceeds the 5 MB raw-memory allowance, Android currently stops retaining the raw file and then opens a stream to find the one requested article. A massive feed with several selected articles can therefore be downloaded/scanned more than once during one Reader session.

**Current mitigation:** Reader keeps the ranked order sequential and prepares the next five targets with at most two native workers. If a future lookahead request genuinely fails before display, its card is omitted from only that Reader session and the mounted Dashboard cache; it is not marked seen or recorded in History. Most importantly, background preparation and active display of the same exact article now join one native operation. If a large feed scan is already underway when the person reaches that article, the active request waits for the existing scan instead of opening a second identical download.

**Why it still matters:** A publisher such as Dan Luu can still produce a multi-second wait when its first large-feed scan has not finished and there is no cached raw XML to reuse. The mitigation removes duplicated work but cannot make an uncompleted first remote download instantaneous or safely retain a huge full archive.

**Required future outcome:** Replace the native RSS path with one counted, streaming connection. While the stream remains small, retain raw XML normally. If it crosses the allowance, discard the partial raw copy but continue parsing that same open response; extract only article bodies whose metadata appears in the current selected 30-card Reader session, hold those bodies temporarily under a total phone-memory budget, and discard the huge XML itself. Concurrent requests for that publisher must join the same scan. No article body may be stored on Tangent's backend or disk.

**Why deferred:** This replaces the central Android stream/cache coordination and needs dedicated native test coverage for feeds with and without content-length headers, repeated selected articles, cancellation, errors, and memory limits. Do not implement it as an incremental patch to the present raw-cache fallback.

**Timing:** Prioritise before broad Android release if massive publishers remain in the active feed directory.

### C4 — Android build setup must remain reproducible

**What is happening:** The local `android` folder is generated by Expo and intentionally not saved in Git. That is fine only if tracked Expo configuration can recreate the same Android app every time.

**Why it matters:** If a setting exists only in a local generated folder, a clean cloud build or a new computer can create a different app from the one tested. This can affect permissions, signing, Google login, and release behaviour.

**Current direction:** Tangent uses Expo-managed builds: generated Android files stay out of Git while reproducible settings live in `app.json` and Expo plugins. The permission/backup changes from this audit follow that approach.

**Future outcome:** Before Android production release, create and test a clean EAS production build. Confirm package name, signing identity, Google sign-in certificate, permissions, and backup behaviour. If native customisation outgrows Expo configuration, deliberately switch to tracking the Android folder.

**Timing:** Required before Google Play production release.

### M3 — The recommendation cache can eventually become too large

Tangent periodically builds two large shortlists of possible articles so it can make feeds quickly. Each shortlist is stored as one Firestore document, which has a hard size maximum. If the shortlist becomes too large, its refresh job fails.

**Why it matters:** Tangent would fall back to slower, more expensive emergency queries. Users could see slower loading or empty feeds if that fallback also struggles. This is a growth problem, not something expected during a small launch.

**Future outcome:** Store only fields needed for recommendation selection, reduce shortlist size, or store the shortlist as many smaller records rather than one large record.

**Timing:** Monitor before the article collection or stored fields expand significantly; fix before the cache approaches the size limit.

---

## Medium-priority product, reliability, and UX work

### M2 — Scheduled background work needs real cost measurement

Tangent collects feeds, builds shortlists, decays popularity, and cleans old content. The code has useful limits, but comments suggesting some work is effectively free are too optimistic. At scale, database reads/writes, server time, logs, and analytics can all cost money.

**Future outcome:** Measure daily usage, set billing alerts, identify busy jobs, and remove work that does not improve feeds. Review how article random-selection values are refreshed.
**Timing:** Before broad growth or when Firebase/Google charges rise.

### M5 — A settings change can look saved even if cloud sync failed

Theme changes immediately on the phone, then Tangent tries to save it to the account. If saving fails, the app does not clearly tell the user. It looks correct locally but may not appear on another device.

**Future outcome:** Wait for cloud save, retry when appropriate, and clearly say when a preference is saved only locally.
**Timing:** Before presenting settings as cross-device synced, or after user reports.

### M7 — TalkBack users do not receive enough information

Android TalkBack reads controls aloud. Tangent’s buttons, category choices, icons, and Reader gestures lack the labels and state information TalkBack needs. A user may hear an unnamed icon rather than “Open settings,” or not hear whether a category is interested, neutral, or not interested.

**Future outcome:** Label controls, state selections, explain non-obvious gestures, and announce loading/error changes. This also makes automated UI testing easier.
**Timing:** Before a broad public release; earlier if accessibility is a launch standard.

### M8 — Skipping onboarding needs clearer expectation-setting

The reliability defect is fixed: onboarding now saves before it opens Dashboard, so it should not reappear merely because the app restarted during an unfinished handoff. The remaining question is product wording. Tangent intentionally allows “Skip selection,” but it does not yet explain that the first feed will be broad until the person teaches Tangent what they like.

**Future outcome:** Keep the low-friction skip path, but add a short honest explanation in the planned onboarding tutorial or beside the skip choice. Do not reintroduce a mandatory-interest rule unless product testing shows it is necessary.
**Timing:** Next onboarding/tutorial UX review.

### M9 — Crash screen can show internal error wording to users

When a screen crashes, Tangent displays the underlying error message. This can confuse a user and reveal implementation detail that does not help recovery.

**Future outcome:** Show a simple recovery message in release builds, keep detail only in development, and later add privacy-conscious crash reporting.
**Timing:** Before a broad public release.

### M10 — Saved offline content and reading metadata can grow forever

Tangent keeps saved article HTML and reading metadata on the phone. Sign out, reset, and account deletion clear it, which is good. During normal use there is no overall storage limit. A heavy reader can accumulate content and make storage work less efficient.

**Future outcome:** Define how much offline content Tangent keeps, show meaningful storage use, cap/expire history metadata, and remove stale RSS-failure markers.
**Timing:** Before heavy-reader usage becomes common; not an immediate blocker.

### M11 — Development reset clears more data than necessary

The developer-only “Clear Local Data” button clears every AsyncStorage value in the app, not only Tangent’s reading data. Public users cannot see it, but it can make debugging confusing.

**Future outcome:** Reuse Tangent’s targeted local-data cleanup helper.
**Timing:** Next developer-tools cleanup.

### M12 — Production Android signing and Google login need a final real-build check

Google identifies Android apps partly through the certificate used to sign the release. A local debug build and a Google Play/EAS production build can use different certificates. If the production certificate is not registered with Google login, linking Google can work in testing but fail in the downloaded app.

**Future outcome:** Build the exact EAS production Android app, install it on a real device, test Google linking/recovery, and confirm the production certificate is registered.
**Timing:** Mandatory before Google Play production release.

### Future iOS release checklist

Tangent is currently Android-focused. Before iOS release, replace the placeholder iOS Google login URL scheme in `app.json`, create/test an iOS production build on a physical phone, verify secure token storage through install/update/delete flows, and complete Apple privacy disclosures. Android work does not automatically make Google login work on iOS.

**Reader preloading is also platform-specific:** Android uses `modules/tangent-rss-parser`, a Kotlin worker that streams RSS/Atom XML away from the Reader JavaScript/UI workload. This does not exist on iOS. Before enabling iOS preloading, add a matching Swift local-module implementation using off-main-thread `URLSession` plus streaming XML parsing. It must match Android’s HTTPS/timeout limits, one-feed-at-a-time queue, cached/in-flight publisher deduplication, raw-memory-only cache bounds, rolling five-upcoming-article buffer, stale-work replacement, and lazy sanitisation. Test it on physical iPhone development and production-style builds across RSS and Atom sources, large feeds, repeated publishers, fast swipes, offline mode, archive preference, backgrounding, and app termination. Until that parity work passes, iOS must retain the safe JavaScript fallback and must not claim Android-equivalent Reader smoothness.

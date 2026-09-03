# 07 — The Reader (article open, WebView, gestures, HUD, exit paths)

> **What this shows:** exactly what happens from the moment a card is tapped until the
> Reader closes — including the Android native preloader that does the heavy lifting off=
> the JavaScript thread. Details: `src/screens/ReaderScreen.tsx` + the five feature files#
> under `src/features/reader/`.

---

## 1. Opening an article

```mermaid
flowchart TD
    T["Card tapped (articleId + queue)"] --> M{"isMockMode?"}
    M -->|"yes"| MK["setArticle(mockArticle) — WebView loads the live URL"]
    M -->|"no"| S{"isSavedMode?"}
    S -->|"yes"| SV["getSavedArticleHtml(id) — offline saved copy"]
    S -->|"no"| A{"rssStatus == archived?"}
    A -->|"yes"| AV["useDirectUri — load publicationUrl as a raw webpage"]
    A -->|"no"| L["has guid + feedUrl → native-prepared raw body when available (Android); otherwise find it in raw in-memory RSS XML"]
    L --> F{"Confirmed absent from a successfully loaded feed?"}
    F -->|"yes + Archived OFF"| SK["record seen + silently advance  (never offers browser escape)"]
    F -->|"yes + Archived ON"| RV["may use the raw publication webpage"]
    F -->|"no — network/native/timeout failure"| ER["retryable error UI (current/tapped article)  never persisted as permanently failed"]
    SV --> H["sanitize ONLY this displayed article  (lazy — xss) + escapeHtml(rss metadata)"]
    MK --> H
    AV --> H
    L --> H
    H --> W["articleHTML → WebView  (theme CSS injected — no reload)"]
```

---

## 2. Inside the WebView (behaviour sensing

```mermaid
flowchart LR
    W["WebView"] --> M2{"scroll / visibilitychange"}
    M2 -->|"scroll (throttled 200ms)"| D["measure depth vs ARTICLE BODY\n(#tangent-article / selector heuristic / document.body last resort)"]
    M2 -->|"pagehide / visibilitychange"| F2["unconditional final-position capture  (deepest genuine position always lands)"]
    D --> P["postMessage { depth, wordCountFromInnerText }"]
    F2 --> P
    P --> BT["useBehaviorTracker:\nforeground-only duration  (AppState excludes inactive/background)"]
    BT --> Q["queue raw read_session  — never decides skim/thorough client-side"]
```

---

## 3. The HUD, gestures, and progress bar

```mermaid
flowchart TD
    L1["WebView loaded"] --> HU0["HUD hidden on initial load"]
    S2{"scroll up (>15px vs last)?"} -->|"yes"| SHOW["HUD appears"]
    SHOW --> T2{"tap?"}
    T2 -->|"toggle"| TG["HUD toggles / auto-hides after 2.5s"]
    T2 -->|"double tap in content"| LK["same normal like/unlike path + reveal HUD + pulse heart"]
    E1{"edge swipe (45px zones, 40px threshold)"} -->|"release < 200ms"| GP["goToNext / goToPrev (history/saved: right-swipe = prev)"]
    E1 -->|"finger held >  -200ms before release"| CX["cancelled — no navigation, no behaviour recorded"]
    SC{"onMessage scroll data"} --> PB["progress bar width = %View (Fabric-safe, bottom: bottomInset)"]
```

- **WebView navigation lock:** sanitized mode — any `http` link → OS browser (`Linking.openURL`, return false). Raw/archived mode — same-domain allowed; cross-domain → OS browser. HTTP ≥400 or load error in an allowed raw page → error UI + "Open in Browser" (archived-ON only..
- **Opaque surfaces:** a new article request immediately unmounts the previous WebView behind an opaque theme surface; spinner only after 180ms — no publisher-page flash beneath a loader/error.



---

## 4. Android native RSS preloader (the performance engine

```mermaid
flowchart TD
    subgraph K["Kotlin module — modules/tangent-rss-parser"]
      A["Reader queue positions"] --> B["rolling 5-upcoming buffer:  positions 2–6 while  1 is open; each advance adds one new 6th"]
      B --> W1["≤2 bounded workers prepare speculative future targets"]
      W1 --> CA["raw XML cache in process memory:  up to 16 ordinary feeds, 5MB each"]
      CA --> EX2["extract raw bodies for exactly the five upcoming targets  — never every entry"]
      L2["selected/current article"] --> LANE["serial selected-article lane  — never waits behind speculative work"]
      L2 --> JOIN["exact-article in-flight request?  → join the same scan (no duplicate download)"]
      BIG["feed > 5MB"] --> ST["stream-parsed to the requested target only  — not retained"]
      LANE --> L2
      ST --> L2
      L2 --> JS["JavaScript receives + sanitises only the displayed article"]
    end
    JS --> W2["WebView renders (steps 1–2 above)"]
```

- **Cache lifetime:** process memory only — never written to disk; discarded when
  Android closes the app.
- **Stale work:** a genuine swipe lets only already-running native work finish, then
  replaces stale queued targets with the latest buffer; a harmless readiness reorder
  never restarts the same five targets.

- **iOS / old dev builds:** no native module yet — JavaScript `fast-xml-parser` fallback
  remains the safe path (see `docs/tech-context.md` iOS parity work).

---

## 5. Exit — the three guarded paths (one finish route

```mermaid
flowchart TD
    X{"What closes the Reader?"}
    X -->|"HUD ×"| FIN["finishAndExitReader — exitingReaderRef guard"]
    X -->|"Android / system back"| NAV["navigation beforeRemove  intercepts — same finish path"]
    X -->|"queue exhausted"| EX["auto-return — same finish path"]
    FIN --> H2["queue raw session + write local History  — once"]
    H2 --> NAV2["navigate immediately"]
    NAV2 --> SYNC2["behavior sync continues in the background"]
```

- Saved / history / mock-browsing exits are **excluded** — no session is recorded there..
- **Right-swipe in history/saved** correctly calls `goToPrev()` (no false next).

---

## 6. Where this lives

| Concern | File |
|---|---|
| Orchestrator (PanResponder, WebView, HUD wiring) | `src/screens/ReaderScreen.tsx` |
| Article loading + RSS matching | `src/features/reader/useArticleLoader.ts` |
| Queue + preloader trigger | `src/features/reader/useNavigationQueue.ts` |
| HUD state | `src/features/reader/useReaderHUD.ts` |
| Red `Loading|` cursor | `src/components/LoadingCursor.tsx` |
| Android Kotlin parser | `modules/tangent-rss-parser/` |
| Session sensing | `src/hooks/useBehaviorTracker.ts` |
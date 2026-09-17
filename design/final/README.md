# Tangent — FINAL DESIGN (v1.0 "Obsidian Steel Glacier")

> The accepted UI system. Generated in Stitch project "Tangent Obsidian Glacier Final"
> (`17135831263764687778`), screenshot-reviewed and critiqued against
> `docs/design-philosophy.md`. Authoritative record: `docs/design-system-final.md`.

## The five screens

| File | Screen | App route | Stitch screen ID |
|---|---|---|---|
| `01-feed.png` | **Feed v5** — full-bleed monograph + NEXT queue teaser | Main tab "FEED" | `efa2e006e51c45af81f721cdba9ca460` |
| `02-stacks.png` | **Stacks Hub v5** — Quick Queue + actionable stack playlists | Main tab "STACKS" | `3b5878f2fa6c48f5be87f68f390b5f45` |
| `03-tuning.png` | **Tuning v3** — stats & insights dashboard (2 modes) | Main tab "TUNING" | `680a94c4d45a4a84950d4fc38ad94002` |
| `04-reader.png` | **Reader** — immersive article view (from READ ESSAY) | Pushed detail | `b36e157f63b7465c9e56cdf135f0fea5` |
| `05-stack-builder.png` | **Stack Builder v2** — source-driven composer + live tally | Pushed (from Stacks) | `fb5643dc8acd44039c07c96bd43c10d3` |
| `08-settings.png` | **Settings** — app-final grouped settings (mirrors `src/screens/SettingsScreen.tsx`) | Pushed (from any tab) | `f689ee5a1fb7493a91663b0ac36def46` |

`DESIGN.md` is the exact token spec uploaded to Stitch (palette, radii, type scale, rules).

## Key design decisions (do not regress these)

- **Palette:** obsidian `#0C0E12` surfaces, **muted steel** `#7FA8C9` accent (never bright
  cyan), silver `#F0F3F8` primaries, hairline structure `#252A32`.
- **Type:** Space Grotesk (headings/metrics) · Manrope (body/quote) · JetBrains Mono
  (ALL metadata, uppercase, 0.08em tracking).
- **Feed scrim geometry (v4, frozen):** top veil max 60% within top 20% only; text anchored
  in a LEFT-only wedge from 50% height feathering out by 65% width; photo stays visible
  top half + lower-right down to the nav. Grade: `saturate(0.85) brightness(0.9)`, no sepia.
- **No drop shadows** (except floated sheets), **no pills**, 4px control / 8px card radius.
- Renders use Stitch AI stand-in imagery; live-image behavior (og:image chain,
  luminance-adaptive scrim, branded placeholder fallback) is specified in
  `docs/design-system-final.md` and validates in-app (P3).

## UX patterns (v1.1 overhaul — from the four UX reference images)

> Source references (UX ideas only, palette/type unchanged): `design/Folio — Full-Bleed
> Monograph (Robust Scrim & Stack Action).png`, `[KEEP - PRIMARY] Stacks Home Hub.png`,
> `[KEEP - SPEC] Stack Builder Flow.png`, `[KEEP] Feed Tuning & Reading Stats.png`.

- **Time-awareness everywhere:** every essay, queue and stack carries a read-time; stacks
  show total duration + essay count and a per-card "BEGIN READING (48M) →" CTA.
- **Quick Queue** is a first-class object on Stacks: "IMMEDIATE READING" section, per-item
  times, "READ QUEUE (15 MIN) →" action.
- **Feed queue continuity:** slim "NEXT: …" teaser strip above the bottom nav.
- **Builder is source-driven, not just manual:** expandable source pathways ("My Saves &
  History" with Quick Queue/History/Stash tabs; "Custom Discovery & Filters" with a 2×2
  filter grid and signal-rated candidates); numbered selected list; sticky bottom bar with
  live tally ("2 ESSAYS · 15 MIN — READY TO COMPILE") and a "DRAFT SAVED" state.
- **Tuning delivers insights, not counters:** Taste Tuning / Stats & Insights segmented
  modes; 2×2 velocity grid with week-over-week deltas; Thematic Diet segmented bar;
  "INTENT VS. REALITY GAP" coaching card (steel border); Source Loyalty top-3 + diversity
  bar (core vs discovery); Stack & Queue Health mini-stats.

## Interactive prototype (v1.1)

The HTML exports are now a **clickable prototype** — `html/tangent.js` (vanilla JS, zero
dependencies) ports the interaction layer from the old Folio screens (Stitch project
`13331848356550971551`) onto the new finals:

- **Feed** — save/stack button fills + toast ("SAVED TO QUICK QUEUE · +1"); READ ESSAY and
  the NEXT strip open the Reader.
- **Stacks** — READ QUEUE / BEGIN READING staged-press feedback + toast; + NEW STACK and
  COMPOSE open the Builder; **compile handoff**: a stack created in the Builder is
  prepended to the hub on return (pulse dot, computed min/essay counts) — same flow as the
  old `createStack()`.
- **Stack Builder** — full port of the old programmable flow: checkbox/+ toggles,
  SELECT ALL, prunable selected list, live tray + pip + CREATE STACK label tallies,
  "● UNSAVED CHANGES" ↔ "✓ DRAFT SAVED" state, empty-selection guard, staged
  "COMPILING…" then redirect to Stacks.
- **Tuning** — segmented control is live: TASTE TUNING reveals a category-weight slider
  panel, STATS & INSIGHTS shows the dashboard.
- **Reader** — SAVE TO STACK reaction, scroll-bound progress bar.
- Bottom nav links the three tabbed pages; toasts are hairline monospace above the nav.

Validation: `node --check` + headless-Edge boot checks on all five pages (toast layer,
nav rewiring, builder tally re-render, tuning panel injection, progress bar).

## Flagship interactive set (v1.2 — current best in Stitch)

Same visuals as the finals above, plus full behavior + feature merges from the other
Stitch projects (Folio KEEP-specs, Editorial Design System, FLARE-inspired identity):

| Screen | Stitch ID | Added |
|---|---|---|
| Feed v6 — Interactive | `a8b25fd4eba343d9a053af469b4055e2` | save reaction, OPENING feedback, NEXT-strip action |
| Stacks v7 — History & Vault | `c05c306895ab47e4855f0a7dd407cf8f` | STACKS/HISTORY/VAULT segments, depth %, pinned vault |
| Tuning v7 — Control Room | `8d4dbdf1b3084260b131efead7fdf6a1` | FOCUS↔DISCOVERY dial, tri-state Topic Mix (BOOST/NORMAL/MUTE), signal weights, live feed preview; stats side de-duplicated (radar kept, donut/chips/heatmap cut) |
| Reader v3 — Reading Controls | `a59d8321113e462f8274d3b06bf97c49` | Aa sheet: serif/sans, 80–130% scale, atmosphere tints, 1.0–2.0× audio |
| Stack Builder v4 — Presets & Filters | `9ea71fe93f2f4a198e8c399b64952a6a` | occasion presets, 6 working filter popovers, live N-FOUND |
| Settings (app-final) | `f689ee5a1fb7493a91663b0ac36def46` | mirrors the RN SettingsScreen: Account, split Library, theme segments, steel toggle, mono labels |
Validation: `node --check` + headless-Edge boot checks on all five pages (toast layer,
nav rewiring, builder tally re-render, tuning panel injection, progress bar).

## Missing screens, app-accurate renditions (v1.4 — Stitch only, no app code)

Six remaining RN screens were recreated in the same Stitch project ("Tangent Obsidian
Glacier Final", `17135831263764687778`), written directly from each screen's TSX
(`ArticleListScreen`, `DashboardStatsScreen`, `AccountScreen`, `FeedbackScreen`,
`FeedRequestScreen`) so structure and copy mirror the app exactly. All six screenshots
visually verified PASS (`design/final/states/*-app.png`):

| Screen | Source TSX | Stitch ID | Evidence |
|---|---|---|---|
| History — publisher eyebrow + bold title + right read-time, hairline rows (no cards) | `HistoryScreen` → `ArticleListScreen` | `31a9e4e0bc984d5087411a23fe737588` | `states/history-app.png` |
| Saved — same list pattern | `SavedReadsScreen` → `ArticleListScreen` | `a0a4522759a649dbaecc2a003615b21f` | `states/saved-app.png` |
| Dashboard Stats — joined card, 6 metric rows, 3 selected rows in accent-soft `rgba(127,168,201,.12)` + steel text | `DashboardStatsScreen` | `90c14813887e42a18f20f3d1042517ba` | `states/dashboard-stats-app.png` |
| Account — Anonymous status card, Link Google row, DANGER ZONE with error `#FFB4AB` Delete | `AccountScreen` | `ee4613c51f5f4343a9c828c96c73317d` | `states/account-app.png` |
| Send Feedback — X bar, subtitle, 160px textarea, ghost send button (JetBrains Mono) | `FeedbackScreen` → `FormScreen` | `3e970fa5492443b4a1f1eeabd298664b` | `states/feedback-app.png` |
| Request a Feed — URL input, optional textarea, ghost RSS submit button | `FeedRequestScreen` → `FormScreen` | `973942602b9a4c59831b836992dba70b` | `states/feed-request-app.png` |

Not yet in Stitch: Onboarding (flow with multiple steps — request before generating).

## Toggled-state audit (v1.3 — all states verified PASS)

Every interactive state hidden behind a toggle/segment in the flagship screens was
rendered locally (headless Edge + forced state activation) and visually verified:

| Screen → State | Result | Evidence (`design/final/states/`) |
|---|---|---|
| Tuning v7 → **TASTE TUNING** control room | ✅ PASS | `tuning-v7-taste-tuning-mode.png` |
| Stacks v7 → **HISTORY** view (depth-% rows) | ✅ PASS | `stacks-v7-history-view.png` |
| Stacks v7 → **VAULT** view (pins, ADD TO STACK) | ✅ PASS | `stacks-v7-vault-view.png` |
| Reader v3 → **Aa controls sheet** (typeface/scale/atmosphere/audio) | ✅ PASS | `reader-v3-controls-sheet.png` |
| Stack Builder v4 → **preset selected** (steel accent + toast + draft flip) | ✅ PASS | `builder-v4-preset-state.png`, `builder-v4-preset-active-zoom.png` |
| Settings → static design (mono labels, segment control, toggle) | ✅ PASS | `08-settings.png` |

Audit method: each screen's Stitch HTML was pulled to `design/final/html/stitch-final/`,
each hidden state force-activated via injected click, rendered in headless Edge with
`--virtual-time-budget`, and inspected. JS wiring confirmed on all screens (segment
toggles, live tallies, draft state, toasts). Zero Stitch defects found — two initial
false alarms were traced to the audit harness itself (ANSI/UTF-8 mojibake on re-encode;
click-timer racing screenshot capture), not to the screens.

## Continuation project (v1.5 — exported flagship set to a fresh project)

Six flagship screens were exported from `17135831263764687778` into a new project
**"Tangent Obsidian Glacier — Continuation"** (`13927848394206634594`) using the
`stitch-upload-to-stitch` skill (download each screen's `htmlCode` → `design/stitch-export/`
→ re-upload via `upload_to_stitch.py`). All six exported files verified as valid
`<!DOCTYPE html>` with the correct titles; each upload created a screen + instance
in the new project; `list_screens`/`get_project` confirm all 7 instances present.

| Screen | New-project Stitch ID | Source screen ID |
|---|---|---|
| Feed v6 — Interactive | `7089645183589827197` | `7579568613053295649` |
| Stacks v7 — History & Vault | `10686055883373638176` | `c05c306895ab47e4855f0a7dd407cf8f` |
| Tuning v7 — Control Room | `12378141594885133263` | `8d4dbdf1b3084260b131efead7fdf6a1` |
| Tuning v6 — Reader Identity | `16507954264251922183` | `a249ed53feac401aad93e8db5c9f1c48` |
| Reader v3 — Reading Controls | `6373102483990137298` | `a59d8321113e462f8274d3b06bf97c49` |
| Stack Builder v4 — Presets & Filters | `1251811129351672284` | `9ea71fe93f2f4a198e8c399b64952a6a` |

The **"Obsidian Steel Glacier" DESIGN.md** was uploaded too (screen
`6140511973551852059`), carrying the full token spec into the new project.

Known limitation (matches `docs/design-obsidian-glacier-mapping.md`): the
`create_design_system_from_design_md` RPC returns `INVALID_ARGUMENT` for this
`PROJECT_DESIGN` project type (tested with `deviceType` MOBILE and DESKTOP). The
established workaround is unchanged: the DESIGN.md screen *is* the design system
source of truth, and generation prompts in the new project repeat the tokens.

## Feed v8 — Save-to-Stack popup (v1.6 — added in the Continuation project)

Per the ScrollRead "Feed & Add-to-Stack Drawer" reference, the home feed's bookmark button
now opens an Add-to-Stack bottom-sheet popup. Stitch's `edit_screens` cannot modify an
existing screen's stored HTML on this project type (it emits a fresh resource), and its
first output was rejected in review: double-encoded emoji mojibake, the wrong article
context, and unreliable initial-hidden states that visually replaced the bottom nav.
The shipped page was therefore rebuilt by hand from the untouched Feed v7 source
(surgical assembly: mojibake repaired, old toggle script removed, sheet + JS inserted)
and uploaded via `upload_to_stitch.py`:

| Page | Project | Stitch ID | Notes |
|---|---|---|---|
| Feed v8 — Save to Stack (fixed) | `13927848394206634594` | `16880412495589828961` | clean v7 base + sheet: scrim blur, #1B1F28 sheet (8px top radius), Material Symbols rows (bolt/auto_stories/science), single-select w/ accent-soft state, + NEW STACK, ghost SAVE TO STACK CTA, mono toast; 300ms slide-up; closed by default so canvas renders the clean feed |
| ~~Feed v8 (broken first pass)~~ | `13927848394206634594` | `3257989224225931512` | superseded — delete from canvas |
| Feed v7 — Clean Reader (original) | `13927848394206634594` | `7b80a960bcaa461eb7fd337ff6c7d7c5` | untouched |

Assembly sources: `design/stitch-export/sheet-markup.html`, `sheet-script.html`,
`feed-v8-fixed.html`. Verification: single `<nav>`, zero mojibake, all popup markers
present pre-upload; instance confirmed in `get_project`.

## Production set (v1.7 — design-system-driven, in the Continuation project)

The full production-ready app was regenerated in `13927848394206634594` using the
`stitch::generate-design` skill workflow. Breakthrough: the Obsidian Steel Glacier
**design system asset `assets/f05573cb5a434b8ab970a3d8d905be66`** is now attached to the
project (auto-created from the canonical token block during generation — the manual
attach RPCs all reject MCP-created PROJECT_DESIGN projects). Every production screen
therefore renders from the **same theme object** (verified identical across all
generation responses) — consistency by construction.

| # | Screen | Stitch ID |
|---|---|---|
| 1 | Feed v9 — Daily Dispatch | `7c86c8f333704bfba92ca1f06b241002` |
| 2 | Feed — Add to Stack (Open) | `cfac2c1533cd4a829f42122b4350393a` |
| 3 | Stacks v8 — Library & Playlists | (see canvas) |
| 4 | Tuning v8 — Control Room | `3243756b4a664168b4b023f0a30eba34` |
| 5 | Tuning — Stats & Insights | `f9a65410d85f41e6aad97535605d529f` |
| 6 | Reader v4 — Immersive Editorial | `88c14bed967f4085a091d60b565aa9e2` |
| 7 | Stack Builder — Composer | `25a16b54caa24351957a97e8ec81de08` |
| 8 | Settings — Preferences & Account | `95dd7dc9b10247588b4d1c2d3d91b451` |
| 9 | Reading History — Archive | `86ed5148c582435ba4d98d619a03ee01` |
| 10 | Saved Essays — List View | `8f2c3c86cf86435c94719b9e583b2110` |
| 11 | Dashboard Stats — Metric Picker | `25bb5fa2b35d470293ee29259c96eaa3` |
| 12 | Account Settings — Status & Security | `72fb3d2059cf4e46b0d8f766fa9c244e` |
| 13 | Send Feedback — Modal Sheet | `7152121cc2134381bf980cb0ca2982b3` |
| 14 | Request a Feed — Modal Sheet | `01b9e9e195054a2cae8afd7fc4d3d385` |

Anti-pattern audit (per the user checklist + taste-design bans) on pulled HTML —
Tuning v8 and Feed v9: **EMOJI 0 · Inter 0 · #000 0 · neon glow 0 · 3-col 0 · fake
metrics 0 · clichés 0 · filler 0 · label-year 0**; radii collapsed to 2px/4px/8px +
dots (Tuning v8 previously carried six radius variants incl. `[2px]×84`). Older
screens (v6/v7 era) are superseded by this set. Superseded/broken pages on the
canvas (`3257989224225931512`, `76fdfaed…`, v7-era set) can be deleted in the UI.

## Production port — "Tangent — Production" (v1.8, project `608042365240030131`)

Final audited screens ported out of the Continuation project into a clean dedicated
project. 11 screens uploaded byte-exact via `upload_to_stitch.py`; Stacks (whose source
HTML download was unrecoverable) was **regenerated fresh** with the identical structure +
canonical token block — that generation auto-created the project-level design system
(`assets/38a86f6c…`, Obsidian Steel Glacier, full DESIGN.md attached), so this project has
what the Continuation project gained only mid-flight: **theme inheritance from screen #1**.

| # | Screen | ID in `608042365240030131` |
|---|---|---|
| 1 | Feed v9 — Daily Dispatch | `8025778590035661539` |
| 2 | Feed — Add to Stack (Open) | `12266941459026470248` |
| 3 | Stacks v8 — Library & Playlists *(regenerated)* | off-canvas — drag from screen list in the Stitch UI |
| 4 | Tuning v8 — Control Room | `6641491666624059120` |
| 5 | Reader v4 — Immersive Editorial | `2340631524836789490` |
| 6 | Stack Builder — Composer | `911669425152706852` |
| 7 | Settings — Preferences & Account | `12323981638157059906` |
| 8 | Reading History — Archive | `12323981638157058314` |
| 9 | Saved Essays — List View | `3954626584484168037` |
| 10 | Dashboard Stats — Metric Picker | `2238130850431206217` |
| 11 | Account Settings — Status & Security | `5937319665537206222` |
| 12 | Send Feedback — Modal Sheet | `15853207473208753658` |
| 13 | Request a Feed — Modal Sheet | `6041104496381519240` |
| — | Obsidian Steel Glacier (DESIGN.md spec page) | `8650577449905547792` |

Not ported: *Tuning — Stats & Insights* (stays in the Continuation project,
`f9a65410…`) — say the word to add it. Caveat: Stitch's theme synthesis derived its own
Material palette naming from the DESIGN.md (shifted tints like primary `#a2cbee`); the
uploaded screens are unaffected (hexes baked in), but future *generated* screens in this
project should re-state the canonical tokens, not trust the synthesized palette.

## APPROVED-UI rebuild (v1.9 — project `14272229019036300536`)

**Correction of record:** the v1.7 "production set" and the v1.8 port *regenerated* the
screens from structure prompts — re-imaginings, not the approved UI. Rejected. This
project supersedes both: it contains **byte-exact uploads of the approved sources only**
(pulled by screen ID from the Final project `17135831263764687778` and the Continuation
project, validated DOCTYPE + size-match before upload). No generation, no reinterpretation.

| # | Screen | Source | ID in Approved-UI |
|---|---|---|---|
| 1 | Feed v6 — Interactive | Final `7579568613053295649` | `6719716030783867908` |
| 2 | Feed v7 — Clean Reader (Home) | Continuation `7b80a960…` | `11035000142779787296` |
| 3 | Feed v8 — Save to Stack (fixed) | local `feed-v8-fixed.html` | `10756968639691488504` |
| 4 | Stacks v7 — History & Vault | Final `c05c3068…` | `3273371232217342839` |
| 5 | Tuning v7 — Control Room | Final `8d4dbdf1…` | `3931785360492318594` |
| 6 | Tuning v6 — Reader Identity | Final `a249ed53…` | `11923609068722526165` |
| 7 | Reader v3 — Reading Controls | Final `a59d8321…` | `9614628118850136793` |
| 8 | Stack Builder v4 — Presets & Filters | Final `9ea71fe9…` | `5704520490008180912` |
| 9 | Settings (app-final) | Final `f689ee5a…` | `13424977875474342357` |
| 10 | History | Final `31a9e4e0…` | `4786902545678049609` |
| 11 | Saved | Final `a0a45227…` | `16077817411251352656` |
| 12 | Dashboard Stats Settings | Final `90c14813…` | `4881451248540664612` |
| 13 | Send Feedback Modal | Final `3e970fa5…` | `8256753161549982841` |
| 14 | Request a Feed Modal | Final `97394260…` | `9778784581111803442` |
| — | Obsidian Steel Glacier — DESIGN.md | `design/final/DESIGN.md` | `1768965448782521228` |

Housekeeping: two upload duplicates to delete in the Stitch UI —
`14719509319484373427` (Feed v7) and `4153528479000646520` (Feed v8). Local sources:
`design/stitch-export/approved-ui/` (14 HTML). The v1.7/v1.8 projects are now archive-only.

## History

Everything else lives in `design/archive/`:
- `old-stitch-project/` — the previous Stitch project's screenshots v1–v8 + export
  (v6 was the accepted base there; superseded by `final/01-feed.png`)
- `feed-iterations/` — this project's Feed v1–v3 and Stacks v1–v2 (rejected/interim)
- `explorations/` — pre-Stitch HTML mockups, logo concepts, loading animation

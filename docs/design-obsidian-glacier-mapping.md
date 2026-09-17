# Obsidian / Silver / Glacier — Concept → App Mapping

> Source of truth for wiring the Stitch concept in
> `design/stitch_duplicate_of_scrollread_personalized_longform_feed/` into SubTick (Tangent).
> Status: **spec** — no code written against this yet.

## 1. Source files audited (100% read)

| File | Contents |
|---|---|
| `obsidian_silver_glacier/DESIGN.md` | Design system spec: palette, type scale, spacing, elevation, shapes, components |
| `keep_feed_full_bleed_monograph_obsidian_glacier/` | Feed: one full-bleed essay card per screen, sticky "stack" save button, "NEXT:" preview, bottom nav (Feed/Stacks/Tuning) |
| `keep_stacks_home_hub_obsidian_glacier/` | Stacks Hub + **inline builder modal variant** (Quick Queue card, playlist cards, Compose CTA) |
| `keep_stack_builder_flow_obsidian_glacier/` | Full-page builder variant: name field, occasion presets, 2 accordion source pathways, 4 filter dropdowns, matching candidates, compile tray |
| `keep_feed_tuning_reading_stats_obsidian_glacier/` | Tuning screen with 2 views: "Taste Tuning" + "Stats & Insights" (segmented toggle), sticky save bar, RSS import modal |

## 2. Known concept inconsistencies (decisions required)

1. **Three palettes**: DESIGN.md (`#1e2023` surfaces) vs Stacks Hub (`#171a21`) vs Tuning (`#1b1f28`/`#232834`). → Normalize in `tokens.ts`.
2. **Two glacier blues**: `#91cdfb` (Feed, Tuning) vs `#76b2df` (Stacks). → Pick one (proposed: `#91cdfb` primary accent, `#76b2df` for glows/pips, or single token).
3. **Radius conflict**: DESIGN.md mandates 4–8px and "pills prohibited"; Stacks/Builder use `rounded-2xl`/`rounded-full`. → Decide per-screen or normalize.
4. **Two builder variants** (inline modal vs full page; full page has occasion presets + algorithmic filters). → Pick one.
5. **Font mislabel**: Tuning uses `font-serif` = Space Grotesk (not a serif). Stacks uses Newsreader italics for headings. → Proposed: Space Grotesk (display) + Manrope (body) + JetBrains Mono (labels); drop Newsreader + Inter to limit payload.
6. Dark-only concept; app currently ships light+dark. → Decide: dark-first glacier theme + current light palette, or design a light counterpart.
7. Brand naming in mockups ("Folio", "f.") vs app ("Tangent"/SubTick). → Confirm naming.

## 3. Normalized token proposal (dark theme)

```
background #0C0E12   surface-01 #111317 (+1px border #252A32)
surface-02 #161A20   surface-03 #1B1F28
text-primary #F0F3F8 text-secondary #9BA7BA text-muted #475263
accent/glacier #91CDFB  accent/glacier-deep #76B2DF  accent/glacier-glow rgba(145,205,251,0.4)
accent/silver #F0F3F8 (primary button bg)  on-silver #0B0E13
danger #FFB4AB       radius: sm 4 / md 8 / xl 12
fonts: Space Grotesk (display/headings), Manrope (body), JetBrains Mono (labels/metadata)
```

## 4. Component inventory (concept → app)

| Concept component | App action |
|---|---|
| Bottom tab bar (3 tabs, blur, glacier pip) | **New** — `@react-navigation/bottom-tabs` + custom tabBar (expo-blur installed) |
| Full-bleed monograph card + pager | **New** — paging FlatList; reuses `getRankedFeed` / `dashboardFeedCache` |
| Sticky save ("stack") button | Map to existing save/queue action (`savedStore`) |
| Hero image + gradient scrims | **Gap** — needs og:image extraction in `rssParser.ts` + gradient fallback |
| Quick Queue card | `savedStore` unsorted saves (near 1:1) |
| Playlist (Stack) card + tags + total time | **New feature** — Stack model + store |
| Occasion preset pills | **New** (only in full-page builder variant) |
| Source accordions + candidate dropdowns | **New**; discovery filters wrap existing category prefs |
| Topic Boost/Normal/Mute rows | Existing 3-state category chips (`CategoryChipGrid`) relabeled |
| Publication Boost/Normal/Block + RSS import | Feed URLs exist (`FeedRequestScreen`); priority weights **new** |
| Discovery scope segmented controls | Wrap existing length/recency prefs where possible |
| Stat metric cards (velocity 2×2) | `dashboardMetrics.tsx` / `DASHBOARD_METRIC_DEFS` data exists |
| SVG donut (thematic diet) | **New** — `react-native-svg` (already installed) |
| Source loyalty ranking + ratio bar | Aggregations over behavior history — **new queries** |
| Stack & Queue health | Depends on Stack feature |
| Sticky "Save Preferences" bar | Existing settings-save flows |
| RSS import modal | Existing `FeedRequestScreen` logic, restyled |

## 5. New data / backend work

- `Article.coverImageUrl` — og:image / first `<img>` extraction at RSS parse time; fallback gradient.
- `Stack` model: `{ id, name, occasion?, articleIds[], filters?, tags[], createdAt }`; local store mirroring `savedStore` pattern (AsyncStorage + Firestore mirror + offline retry); Firestore rules/index for `users/{uid}/stacks`.
- Publication priority weights on profile (`boosted` / `normal` / `blocked`) if we adopt per-publication controls.
- Queue-reading session: Reader walks a stack in order (new Reader mode; progress persisted).

## 6. Rollout phases

1. **P0 Decisions** — items in §2 (esp. builder variant, light-theme story, naming).
2. **P1 Foundation** — `src/theme/tokens.ts`, fonts (expo-google-fonts), ThemeColors extension, `webViewCSS` update.
3. **P2 Shell** — bottom-tabs + custom obsidian tabBar; Dashboard/Stacks/Tuning under tabs; Reader/Settings remain cards/modals.
4. **P3 Feed re-skin** — monograph pager reusing existing feed logic; og:image extraction.
5. **P4 Tuning** — two-view screen re-skin over existing data.
6. **P5 Stacks** — model, store, Hub, chosen Builder, queue-reading session. Largest chunk.

## 8. Design iteration v1 (2026-09-06) — CURRENT DESIGN SOURCE

**Stitch project: "SubTick Obsidian Glacier v1" — `7517289913587004621`** (dark-only, per P0 decision: forced dark during migration; light glacier = fast-follow P6 with paper/ink mapping).

Normalized token set (used in every generation prompt, adopted by all screens): bg `#0C0E12` · surfaces `#111317`/`#161A20`/`#1B1F28` · hairline `#252A32` · glacier `#91CDFB` (+`#76B2DF` glows) · silver `#F0F3F8` primaries · Space Grotesk / Manrope / JetBrains Mono · 4px controls / 8px cards · pills eliminated.

Generated screens (all QA'd from screenshots in `design/stitch_v1_*.png`):
| Screen | Stitch screen ID | Local screenshot |
|---|---|---|
| Feed (full-bleed monograph) | `3604d0a988284c49ac487c81505e3e2f` | `stitch_v1_feed.png` |
| Stacks Hub | `9109b1c4a6e54025999a3ec6e85a2045` | `stitch_v1_stacks.png` |
| Stack Builder (full-page variant) | `c2c13fc8115c45bd940bacc6342acaf3` | `stitch_v1_builder.png` |
| Tuning (Stats view; Taste Tuning toggle pending) | `17c6f80d55ab486bb6751284cd870f1e` | `stitch_v1_tuning.png` |
| Article Reader | `f97f25c3d4b64ef48e7fbcb78fe596b3` | `stitch_v1_reader.png` |

Tooling notes: `create_design_system` RPC rejects empty/PROJECT_DESIGN projects (used `upload_design_md` + in-prompt tokens instead — the token spec also lives in-project as the uploaded DESIGN.md screen). Cline stitch server needs `"timeout": 300` for generation calls. Decisions this v1 locks: full-page builder variant, Tangent branding, one glacier blue, 4px/8px radius discipline.

## 8.1 Design iteration v2 (2026-09-06) — CURRENT DESIGN SOURCE (supersedes v1 palette)

**User feedback applied:** glacier blue was too bright → **muted "brushed steel" palette**; Feed bottom gap/"NEXT" block removed → minimal swipe affordance; metadata (publisher + read time) moved to top; hamburger + wordmark replaced by stylized "T" glyph (top-left) + profile icon (top-right).

**v2 muted token set (authoritative):**
- accent `#7FA8C9` · accent-deep/pips `#5E86A6` · pale tint `#A9C4DA` · glacier-soft bg `rgba(127,168,201,0.10)`
- All other tokens unchanged (obsidian surfaces, hairline `#252A32`, silver primaries, Space Grotesk/Manrope/JetBrains Mono, 4px/8px radii).

**Feed swipe interaction spec (for RN P3 implementation):** static mockup shows the affordance only (chevron-up + "SWIPE UP · NEXT ESSAY" mono microcopy + 4-segment position indicator, first segment accent). Actual gesture: vertical paging — **hero image slides up as a full card replacing the previous image, text block swaps in place** (crossfade); haptic tick per card. Article save state ("design though to save") persists per article.

**v2 screen IDs (edits create new screen resources; old IDs retain v1 content):**
- Feed v2: `64407d611f2c44358ee2d28dca83a932` → `design/stitch_v2_feed.png` (QA'd)
- Tuning v2: `4a6847b55fac43f5be63e3aeff392f65` → `design/stitch_v2_tuning.png` (QA'd)
- Stacks/Builder/Reader v2: regenerated in the same batch edit (session `6374565068002177960`); IDs not yet exposed via API — verify visually in the Stitch UI canvas; re-edit individually if any screen still shows v1 blue.

**API quirks learned:** `list_screens`/`get_project.screenInstances` do NOT index session-generated screens (only uploaded DESIGN.md); `get_screen` on old IDs returns v1 content; batch `edit_screens` works but responses >100k chars get truncated — prefer per-screen edits when you need to capture new IDs.

## 8.2 Design iteration v3 (2026-09-06) — Feed restructure (current)

**User feedback applied:** top metadata band removed (no split); logo removed entirely (brand mark TBD — only profile icon top-right); article text pushed lower with a **triangle composition** (title ~55% down, capped 65% width → pull-quote 85% → byline full width → actions full width); ALL bottom black space removed (actions flush above nav; swipe affordance = chevron + 4-segment indicator only, ≤28px, no text).

- Feed v3: `08d025bed4eb4383920520146e042300` ("Feed v3 - Triangle") → `design/stitch_v3_feed.png` (QA'd ✓)
- Recovery note: the first v3 edit session vanished (empty API response, unfindable in UI). Re-firing the identical edit **with an explicit result title** returned the screen object inline. Lesson: always title edit results; prefer per-screen edits; capture IDs from every response.
- Byline now carries publisher + read time: `BYRNE HOBART · THE DIFF · 7 MIN READ` (name silver, rest muted).

**Pending:** user judgment on triangle composition (may need width/start-height nudges); Taste Tuning view; Stacks/Builder/Reader muted-version visual confirmation; then P1 foundation coding against §8.1 tokens.

## 8.6 Design iteration v7 (2026-09-06) — Feed current

**v6 feedback applied** — switched strategy from overlay gradients to **photo grading** (bright-photo rules): photo dimmed to ~82% brightness + cold obsidian tint; top fade removed entirely for the upper 30% (wordmark/label sit on photo with text shadows); single slow ramp to black by ~55%; bottom-right fade removed (photo to the nav); black reserved for the lower-left text wedge only.

- Feed v7: `62c3be541d1c452fb3c407bb9bae6a46` → `design/stitch_v7_feed.png`
- QA: no lines/bands ✓, top third clean ✓, right side uncovered ✓ (subtle, since the grade itself darkens the photo). Open dials: photo brightness (0.82 → 0.9 if too heavy), tint strength, right-side presence.

## 8.7 Real-feed system test (2026-09-06)

**Test:** fetch a real Substack RSS feed, extract the latest article + cover image, wire into the Feed mockup.

**Results:**
1. ✅ **RSS extraction pipeline validated.** Feed: `notboring.substack.com/feed` (redirects to `notboring.co/feed`). Latest item: "Weekly Dose of Optimism #209" (Sep 4, 2026). Cover image = **first `<img>` in `content:encoded`** (Substack standard, typically `substack-post-media.s3.amazonaws.com/.../1200x600.png`). This confirms the exact extraction logic to implement in `rssParser.ts` (+ optional `substackcdn.com/image/fetch/w_1200/` CDN resize prefix).
   **CORRECTED after user feedback:** first-content-image grabbed a digest *masthead*, not article art. Final extraction order for `rssParser.ts`: **(1) `og:image` from the article page** (use `substackcdn.com/image/fetch/w_1200,h_675,c_fill,f_jpg,q_auto:good/` CDN crop variant) → **(2) `<enclosure>` image** → **(3) first `<img>` in `content:encoded`** (fallback only). Validated on `notboring.co/p/expanding-the-radius-of-daily-life` → real 1200×675 essay cover. Digest/link-roundup posts are also poor test articles — use real essays.
2. ⚠️ **Network finding:** the local dev machine **cannot reach substack.com directly** (curl + PowerShell both fail). Server-side fetching works. Implication for the app: feed fetching may need the Firebase Functions proxy (or must be verified on-device — mobile networks may not share this restriction).
3. ❌ **Stitch cannot ingest external images.** Despite an explicit "use exactly this URL" instruction, the generated screen substituted an AI-generated dark cityscape instead of the real bright Substack cover. **Consequence: mockups will always show AI stand-in imagery; real-feed image + scrim tuning can only be validated in the app (P3)** — which is where it matters, since real covers vary per article (bright/dark) and the scrim system must adapt at runtime (the §8.6 rules become the RN implementation spec).

- Feed v8 (real article data): `636a51901bdf4b8d831f2a4bf7b1b6b8` → `design/stitch_v8_feed.png`. Real title/label/byline/quote confirmed ✓; hero image is an AI stand-in, not the real cover.
- Gradient spec applied (top 20% → 60% max darkness; bottom-right slow fade to full darkness; bottom-left wedge kept) — but **cannot be fully judged against a real bright cover in Stitch**; final validation happens in P3 with live feed images.

**Bright-photo rules (adopted for RN implementation):** (1) grade the photo (brightness/tint) instead of stacking black overlays — avoids gray banding on bright skies; (2) scrims only behind text, long feathered ramps, never short steep fades; (3) directional (left/bottom-left) scrims beat top+bottom bands for left-anchored layouts; (4) tint the photo toward the palette temperature so black and image share a mood; (5) adapt scrim intensity at runtime to cover brightness (sample the cover image, bright covers get stronger local scrims).

**v5 rejected by user ("horrific; v4 vastly better") — v5's rework was too aggressive.** v6 = v4 base + the same four requests executed as minimal nudges: top-edge line smoothed (top stays dark), pub/read-time label moved down slightly (stays legible), top fade slightly lower/gentler, bottom fade made subtly asymmetric (deeper black bottom-left, soft diagonal). Everything else = v4.

- Feed v6: `bceb97cc5cfd482a9b44855df84f14bd` → `design/stitch_v6_feed.png` — awaiting user judgment.
- Lesson recorded: for this user's gradient tweaks, apply small deltas on the accepted base; large reworks (v5) get rejected even when the instructions read the same.

## 8.4 Design iteration v5 (2026-09-06)

**v4 feedback applied (v5 — rejected):**

- Feed v5: `7f0b9f4d946c4c3eac04cc1943565b42` → `design/stitch_v5_feed.png`
- QA: top fade ✓ clean, label position ✓ (contrast borderline over fog — candidate for text shadow if user flags it), diagonal wedge ⚠️ rendered but subtle — may need a steeper angle if user wants more image on the lower-right.

## 8.3 Design iteration v4 (2026-09-06)

**v3 feedback applied:** harsh top scrim edge → image fades fully to #0C0E12 at the very top; gradient "T" tile → plain "Tangent" wordmark; 65% title cap removed → full-width title (natural 2-line wrap). Superseded by v5's top-fade/label/wedge changes.

**v3 feedback applied (original v4 record):**

- Feed v4: `3b92c43a05c94060b4946231ea4d9289` → `design/stitch_v4_feed.png` (QA'd ✓ — top fade seamless, wordmark clean, no band, title wraps naturally)
- Note: publication/read-time live top-left under the wordmark; byline at the bottom is author · date only.

## 7. Stitch MCP (wired 2026-09-06)

Server `stitch` added to Cline `cline_mcp_settings.json` (endpoint verified live: protocol 2025-06-18). Available tools: `list_projects`, `list_screens`, `get_screen` (pull canonical designs), `generate_screen_from_text`, `edit_screens`, `generate_variants`, `upload_design_md`, `create_design_system*`, `apply_design_system`, project CRUD. Use `list_projects` → `get_screen` to cross-check HTML exports against canonical Stitch state before implementation.


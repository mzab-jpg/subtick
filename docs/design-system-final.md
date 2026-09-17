# Tangent — Final UI System (authoritative record)

> Stitch project **"Tangent Obsidian Glacier Final"** — `17135831263764687778`
> Created 2026-09-07. Design system: "Obsidian Steel Glacier" (auto-generated from
> DESIGN-final.md, committed to the project theme). All screens generated, screenshot-
> reviewed, and critiqued against `docs/design-philosophy.md`.

## Accepted screens (canonical IDs)

| Screen | ID | Iterations | Status |
|---|---|---|---|
| Feed | `4664760082124056be0253386b3e4424` ("Feed Final v4") | v1→v4 | ✅ ACCEPTED |
| Stacks Hub | `1f2c99f4e553473aafeba934abef8b54` (v3) | v1→v3 | ✅ ACCEPTED |
| Tuning Stats | `6021fba1bf9c4896b3328b57ea4e699a` | v1 | ✅ ACCEPTED first pass |
| Reader | `b36e157f63b7465c9e56cdf135f0fea5` | v1 | ✅ ACCEPTED first pass |
| Stack Builder | `f03fbdaf50bf46e9b24eb2b02ca61bae` | v1 | ✅ ACCEPTED first pass |
| DESIGN.md source | `10684821859139929901` | — | reference |

Local renders: `design/stitch_final_feed_v4.png`, `stitch_final_stacks_v3.png`,
`stitch_final_tuning_v1.png`, `stitch_final_reader_v1.png`, `stitch_final_builder_v1.png`.
Full DESIGN spec: `design/DESIGN-final.md`. Philosophy judge: `docs/design-philosophy.md`.

## Feed v4 accepted scrim spec (translate to expo-linear-gradient)

- **Top veil:** `rgba(12,14,18,0.6) → transparent`, spans top 20% only, eased multi-stop
  (60% at 0%, ~33% at 55% of the veil, 0% at 100%).
- **Lower-left wedge:** horizontal gradient `rgba(12,14,18,0.92)` at x=0 → `0.45` at 40%
  width → `0` at 65% width; vertical span 50% height → action row. Soft edges only.
- **Photo grade:** `saturate(0.85) brightness(0.9)` — NO sepia, NO hue-rotate, NO charcoal.
- **Photo visibility rule:** top half + lower-right must stay clearly visible to the nav.
- **Text shadows:** subtle `0 2px 12px rgba(0,0,0,0.45)` on all on-photo text.

## Image pipeline spec (per-article, Feed + thumbnails)

```
extract cover: og:image (Substack CDN crop w_1200,h_675,c_fill) → enclosure → first content img
  → none? → branded placeholder (obsidian gradient + monogram + category label)
  → downsample 32×32 → luminance + dominant color
  → grade: saturate(0.85) brightness(0.9), cold tint, no sepia
  → aspect ≠ 16:9 → blurred-fill underlay + contained sharp image
  → scrim intensity adapts to luminance (bright cover → full wedge/veil; dark → minimal)
  → dominant color → 2px hairline accent under title (subtle bridge)
```

## Stitch MCP quirks (learned this session — extends §8.x)

1. **In-place `edit_screens` DOM ops DO apply to the live screen** (verifiable via
   `dom_operations` in the response event payload + fetching the htmlCode file), **but
   `get_screen` screenshots and htmlCode snapshots can serve STALE pre-edit content for a
   long time afterwards** (byte-identical re-downloads 10+ minutes later).
2. **Reliable correction path: fresh `generate_screen_from_text`** with the full spec +
   corrections baked in. Fresh generations produce accurate renders immediately and were
   first-pass correct 3/3 times (Tuning, Reader, Builder).
3. **The agent's self-reported "Resource Name / Screenshot URL" in reply text is
   unreliable** (returned hero-image URLs or fake strings). ALWAYS use the structured
   `design.screens[].id / .screenshot.downloadUrl` fields.
4. Prompting "state the screen's resource name in your reply" does not fix #3, but
   costs nothing and sometimes surfaces the internal session IDs (screen_N).
5. Fresh generations reliably reproduce session state (hero image reused via
   `{{DATA:IMAGE:IMAGE_n}}` references) — visual continuity across regenerations is good.
6. `list_screens` still never indexes session-generated screens; `get_project.screenInstances`
   lags identically. Track screen IDs from generate/edit responses only.

## Iteration log (this session)

- **Feed v1** (from DESIGN.md + final prompt): composition correct; wedge swallowed the
  lower 40%; grade too charcoal; byline dim; indicator illegible → deltas planned.
- **Feed v2** (reproduce v1): same structure confirmed; critique failed 3 checkpoints.
- **Feed v3** (in-place edit ×4 deltas): DOM ops applied (chevron + byline verified in
  source) but filter/wedge edits unreliable in snapshots; render stale → abandoned path.
- **Feed v4** (fresh generation, corrections in prompt): **ACCEPTED** — all checkpoints pass.
- **Stacks v1**: header missing, list titles missing → v2 (header fixed, titles still
  missing) → v3 (titles confirmed in HTML source; render lag) → **ACCEPTED**.
- **Tuning, Reader, Builder**: first-pass accepted.

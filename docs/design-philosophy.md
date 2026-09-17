# Tangent — Design Philosophy (agent reference)

> What I have learned about the user's taste through 8 Stitch iterations (v1–v8),
> rejections, and corrections. This file is the judge for every future design decision.
> When a mock conflicts with this file, this file wins.

## Core philosophy
1. **Restrained, never aggressive.** The user rejected bright glacier `#91CDFB` → settled on
   muted steel `#7FA8C9` / deep `#5E86A6`. Rejected v5 ("too aggressive") and v7 ("just
   darker, horrific") in the same sitting. Default to the quiet option.
2. **Editorial gallery, not app-card feed.** The Feed is a full-bleed monograph — one essay
   fills the screen like a gallery piece. The photo breathes; black exists ONLY behind the
   lower-left text wedge. Real content on real photography.
3. **Gradients are whispers.** Top veil ≤60% darkness within top 20%; never a solid black
   band; never a visible line where a gradient starts. Long eased ramps only.
4. **Structure via hairlines, not shadows.** 1px `#252A32` borders carry the layout. 4px
   control radius, 8px card radius. Pills prohibited (status pips excepted).
5. **Mono uppercase metadata is the signature.** All authors/pubs/read-times/dates =
   JetBrains Mono 10px uppercase, 0.08em tracking.
6. **Type pairing:** Space Grotesk (display/headings/metrics), Manrope (body/quote), 
   JetBrains Mono (labels). Display weight 500, never heavy/black.
7. **Plain wordmark.** "Tangent" text top-left on photo screens — no logo tile, no icon.
8. **Small deltas on an accepted base.** The user accepts iterative refinement and rejects
   large reworks, even with identical instructions. Iterate as deltas.

## Locked decisions
- Dark-first (forced dark during migration; light glacier mode = later priority P6)
- Brand name: **Tangent**
- Full-page builder variant
- Accent `#7FA8C9`, deep `#5E86A6`; silver primaries `#F0F3F8`
- Fonts: `@expo-google-fonts/space-grotesk`, `manrope`, `jetbrains-mono`
- Feed layout (accepted v6 base, v8 real-data evolution): top veil → floating pub label
  ~25% → title ~55% → pull-quote → byline → action row → chevron + position indicator → nav

## Known constraints (do not fight these)
- **Stitch cannot ingest external image URLs** — substitutes AI imagery. Design agreement
  covers layout/palette/type/scrim geometry; live-image behavior validates in-app (P3).
- **RSS image extraction:** og:image from article page (Substack CDN crop
  `w_1200,h_675,c_fill`) → `<enclosure>` → first content image as last fallback. First
  content image alone grabs mastheads — WRONG.
- **Local network:** substack.com unreachable; `substackcdn.com` + S3 reachable. Feed
  proxy (Firebase Functions) likely needed.
- **Image pipeline (agreed):** cold grade/desaturation for cohesion → luminance-adaptive
  scrim → blurred-fill for aspect mismatch → branded placeholder fallback → dominant-color
  hairline accent.
- **Stitch MCP quirks:** `list_screens` misses session-generated screens; `edit_screens`
  creates NEW screen resources; batch edits truncate responses; always set explicit
  result titles; capture IDs + screenshot URLs from every response; empty projects reject
  `create_design_system` (use `upload_design_md` + tokens in every prompt).
  NEW (final session): in-place edit DOM ops apply but screenshots/htmlCode serve STALE
  pre-edit content — reliable correction path is FRESH generation with corrections baked
  into the full spec (first-pass correct 3/3); agent self-reported URLs are unreliable —
  use structured `design.screens[]` fields only.

## Self-critique checklist (judge every screenshot against this)
- [ ] Photo clearly visible top half + lower right (not drowned in black)
- [ ] No visible gradient edge/line; wedge is a soft feather, not a diagonal hard line
- [ ] Top veil subtle — max 60% at very top, gone by 20%
- [ ] Title: Space Grotesk 500, ~30px, ≤2 lines, lower-left, ~55% height
- [ ] Quote: Manrope italic, 3px steel left border, ~90% width
- [ ] Metadata mono uppercase, correct color hierarchy (names #F0F3F8, dates #9BA7BA)
- [ ] Save button: 48px square, dark surface, 1px border, steel bookmark icon
- [ ] READ ESSAY button: silver bg, dark text, mono bold uppercase, 4px radius
- [ ] Indicator: 4 segments 16×2px, first steel, no text
- [ ] Nav: 92% opacity, hairline top, active = steel icon + white label + pip
- [ ] Nothing bright cyan; nothing shadow-heavy; no pills; no extra chrome

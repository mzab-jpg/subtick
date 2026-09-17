# New UI — B-series (current, approved)

Pulled 2026-09-10 from the live Stitch **Approved-UI project `14272229019036300536`** via the
Stitch REST API (`GET /v1/projects/14272229019036300536/screens/{id}` — same API key the Cline
Stitch MCP uses). These supersede everything in `design/final/`, `design/stitch-export/approved-ui/`
and the `[KEEP …]` coral drafts (now archive-only references).

| # | Screen | Stitch screen ID | File |
|---|---|---|---|
| B1 | Feed & Algorithmic Stream | `430b4d1103c947a29fbf4a0fe0604da8` | `B1-feed.png` + `B1-feed.html` |
| B2 | Stacks Hub & Queue | `c8e2070cd5fc4569b83f9676eaced7ae` | `B2-stacks.png` + `B2-stacks.html` |
| B3 | Tuning & Control Room | `81cc405772e047e2be640543795d182a` | `B3-tuning.png` + `B3-tuning.html` |

Tokens are byte-identical to the Obsidian Steel Glacier system (`design/final/DESIGN.md`):
bg `#0C0E12`, surface `#131313`, card `#1B1F28`, hairline `#252A32`, strong border `#4B535D`,
text `#F0F3F8`, muted `#9BA7BA`, faint `#475263`, accent `#7FA8C9`, accent-soft
`rgba(127,168,201,0.12)`, error `#FFB4AB`. Type: Space Grotesk (display 30/26/24/22, title 17),
Manrope (body 14), JetBrains Mono (labels 10/0.08em/uppercase/500). Radius: 4px controls, 8px cards.

## Audit verdicts applied as spec (2026-09-10 session)

- Feed: add **advance affordance** — swipe-up → next essay + "NEXT: …" mono teaser above the tab bar.
- Feed: pull-quote triple fallback → article blockquote → first sentences of the **RSS `description`**
  (already parsed by `src/services/feed/rssParser.ts`) → no quote block at all.
- Byline capped at two names; scrap dev chrome ("ENGINE ACTIVE", "Control Room", "SOURCE FEDERATION",
  "CATEGORY VECTOR WEIGHTS IN RETRIEVAL", empty header button in B3).
- Titles match tabs: "Stacks", "Tuning". Fix `history` casing bug; "VAULT / ARCHIVE" → "VAULT".
- Wordmark TANGENT caps everywhere; account + settings gear on every screen; icon touch targets 44px.
- Header action circles (B3) violate no-pills rule → 4px squares; segmented control radius 6px → 4px.
- Taste Tuning: trim to 2 dials (FRESH, LENGTH); topic chips plain BOOST / NORMAL / MUTE;
  "+2.0×" precision scrapped; live preview + curator picks deferred until wired.
- Composer: checkbox-only, live tally, sticky footer; default name "Untitled Stack";
  vault add-button toast scrapped; Quick Compose presets v1 = static 15M/45M queue filters.
- Percentile line ("beats 91% of readers") deferred until cohort data exists.

## Amendments (owner decisions, 2026-09-10)

1. **Vault = archive of saved stacks only** (NOT history). Entries: manual per-stack "Archive"
   + automatic Sweep (>21 days untouched → vault). One tap restores. History stays the reading
   log with % depth.
2. **Auto-save in Tuning** — every change persists after ~800ms settle with a quiet "SAVED"
   confirmation; no UNSAVED CHANGES state, no SAVE PREFERENCES button; RESET defaults kept.
3. Queue Sweep card keeps real rules (21-day threshold, computed counts).

## Known-bug fixes recorded (do not regress)

- B2 middle segment label renders lowercase `history` (only non-caps label in app) — fix to caps.
- B2 "+ NEW STACK" label wraps to two lines — icon-only "+" or shortened label.
- B3 has one completely EMPTY header button and no settings gear.
- B1 shows a single essay with NO advance affordance — wired in app as swipe-up + teaser.

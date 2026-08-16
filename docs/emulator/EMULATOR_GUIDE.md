# SubTick Emulator User Guide

> Everything you need to run and test the SubTick algorithm locally with a
> copy of real production data. Verified against the actual codebase (16 August 2026 — post-syncBehaviorEvents-fix + dashboard rebuild round).

---

## What This Does

The **Firebase Local Emulator Suite** runs a full copy of Auth, Firestore, and
Cloud Functions on your laptop. A sync script copies the real production data
into it on startup, so the emulator behaves like production — **but isolated**:
nothing you do locally touches your live app or its users.

| | Production (live) | Emulator (local) |
|---|---|---|
| Auth | `firebaseauth.googleapis.com` | `http://127.0.0.1:9099` |
| Firestore | `firestore.googleapis.com` | `http://127.0.0.1:8080` |
| Functions | `us-central1-subtick-bbd55...` | `http://127.0.0.1:5001` |
| Emulator UI | – | `http://127.0.0.1:4000` |
| Cost | Billed | Free |
| Data | Real users | Isolated copy |

---

## Before You Start (One-Time Setup)

1. **Google Cloud login** (the account that owns `subtick-bbd55`):
   ```bash
   gcloud auth application-default login
   gcloud config set account <your-owner-account@gmail.com>
   ```
   Verify production access:
   ```bash
   gcloud config get-value project   # must print: subtick-bbd55
   ```

2. **Firebase CLI** (already installed — verify):
   ```bash
   firebase --version
   ```

3. **Local secret for the emulator** — `firebase/functions/.env` must contain:
   ```bash
   GA_MEASUREMENT_ID=G-4B3N8C8MR3
   GA_DEBUG=false
   GA_API_SECRET=dummy_local_secret_for_testing
   ```
   The functions declare `secrets: [gaApiSecret]`; the emulator needs *a* value
   or every callable fails with `internal`.

---

## Daily Workflow (Three Windows Total)

### Window 1 — Emulators + data sync

**Double-click:** `c:\2SubTick\firebase\start_emulators_fresh.bat`

What it does (read the script to confirm):
1. Launches `firebase emulators:start --only auth,firestore,functions`
   in a **second window** titled "SubTick Emulators - KEEP THIS WINDOW OPEN".
2. Waits for the Firestore emulator (polls `http://127.0.0.1:8080`).
3. Unless `firebase\SKIP_SYNC.flag` exists, runs
   `node scripts\sync-prod-to-emulator.js`, which copies:
   - `articles` (all articles — the ranking candidate pool)
   - `feeds` (42 feed sources)
   - `publishers` (dynamic quality scores)
   - `system/scoringConfig`, `system/previewConfig` (if present)
4. Waits for the Functions emulator (polls `http://127.0.0.1:5001`).
5. Prints *ALL READY!*

Keep this window and the "SubTick Emulators - KEEP THIS WINDOW OPEN" window
open the whole time.

### Window 2 — The emulator window
Launched automatically by Window 1. **Never close it while testing.**

### Window 3 — Serve the UI tools

**Double-click:** `c:\2SubTick\scripts\start_matrix.bat`

Starts a static web server on `http://localhost:3000` and keeps running.

> Why a server? The dashboard and matrix pages must be opened over HTTP
> (`http://localhost:3000/...`). Opening the `.html` files directly via
> double-click (`file://`) is blocked by the browser's CORS rules and will
> always fail with `auth/network-request-failed`.

---

---

## Using the Two Tools

| Tool | URL |
|------|-----|
| High-Fidelity Matrix | `http://localhost:3000/high_fidelity_matrix.html` |
| Control Dashboard | `http://localhost:3000/control_dashboard.html` |
| Emulator UI (monitor) | `http://127.0.0.1:4000` |

In **both** tools, click the green badge in the top-right so it turns
**blue** and reads "🔌 EMULATOR · localhost". This switches them to the
emulator (`localStorage` key `hfm_use_emulator`; page reloads).

### Typical test session
1. Open the **Control Dashboard** in emulator mode → *Load current config*
   → edit sliders → **Export config (send to simulator)**.
2. Open the **High-Fidelity Matrix** in emulator mode → tick
   *Test dashboard's preview config* → **Run**.
3. Watch everything on the Emulator UI (`/firestore`, `/functions`).

---

## How the Data Sync Works

The sync script `firebase/scripts/sync-prod-to-emulator.js`:

- Reads `articles`, `feeds`, `publishers`, `system/scoringConfig`,
  `system/previewConfig` **from production** using Application Default
  Credentials (two `firebase-admin` apps — production and emulator; the
  pattern mirrors `firebase/seedFeeds.js`).
- Writes into the **running emulator** with batched writes (≤450 per batch).

Deliberately **not** copied:
- `users/*` and subcollections — real-user PII; the Matrix creates its own
  anonymous test users.
- `system/candidatePool_*` — the emulator rebuilds the pool on demand from
  `articles` (see the fallback in `firebase/functions/src/getRankedFeed.ts`,
  `getOrUpdateCandidatePool()`).

Synced articles keep all scoring fields (`random_score`, `isPaywalled`,
`publishDate`, `wordCount`, `trendingScore`, `qualityScore`), which the
fallback pool queries require.

### Skip the sync for fast restarts
Create an empty file `c:\2SubTick\firebase\SKIP_SYNC.flag`. The next
start-up prints `SKIP_SYNC.flag found - skipping production sync` and uses
whatever is already in the running emulator session.

> Note: the Firestore emulator runs in-memory — closing it loses the session.
> The sync runs again on the next start unless the flag exists.

---

## All Scripts & Files

| File | Purpose |
|------|---------|
| `firebase/start_emulators_fresh.bat` | **Main launcher** — emulators + prod sync |
| `firebase/scripts/sync-prod-to-emulator.js` | Prod → emulator copy (called by launcher) |
| `firebase/scripts/test-emulator-e2e.js` | Verifies sign-in + `getRankedFeed` work |
| `firebase/scripts/probe-emulator.js` | Dumps a sample of emulator data (diagnostics) |
| `scripts/start_matrix.bat` | Serves the UI tools on `localhost:3000` |
| `scripts/start_emulators.bat` | Plain emulator start (no sync — legacy) |

> **Legacy / obsolete tools** (do not use for testing the real algorithm):
> - `scripts/simulator.html` — self-contained local approximation; does **not**
>   read the live config or talk to the backend. It now shows a red banner.
> - `scripts/Depracated_liveBotSimulator.js` — old headless bot script; can't
>   run as-is from `scripts/` (no `package.json`) and no longer matches the
>   current 9-category config. New banner notes this at runtime.

---

## Verifying Everything Works

Optional self-test after the *ALL READY!* message:

```bash
cd c:\2SubTick\firebase
node scripts\test-emulator-e2e.js
```

Expected output (mirrors the matrix's own flow — anonymous sign-in on
`127.0.0.1:9099`, then `getRankedFeed` and `getScoringConfig` on
`127.0.0.1:5001`):

```
Signed in anonymously as ...
getRankedFeed returned 30 articles
Sample article: ...
  _score: {"scoreP":..., "scoreT":..., "finalScore":..., "tranche":"mid",...}
getScoringConfig OK — source: firestore

✅ ALL EMULATOR CHECKS PASSED
```

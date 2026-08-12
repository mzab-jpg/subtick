# SubTick Emulator — Troubleshooting

Real fixes for real errors, verified against the codebase.

---

## Error: `auth/network-request-failed`
**Cause:** The page is opened as `file://` (double-clicked) or the Auth
emulator at `http://127.0.0.1:9099` is not reachable.
**Fix:**
1. Open the tools via the server: double-click `scripts/start_matrix.bat`,
   then visit `http://localhost:3000/high_fidelity_matrix.html` (and
   `.../control_dashboard.html`). Never double-click the `.html` files.
2. Make sure the emulators are running (`start_emulators_fresh.bat`) and the
   badge shows blue "EMULATOR · localhost".

---

## Error: `Load failed: internal` (Dashboard)
**Cause:** The Cloud Functions declare `secrets: [gaApiSecret]` (see
`firebase/functions/src/index.ts`). The emulator cannot inject the secret, so
every callable throws `internal`.
**Fix:** `firebase/functions/.env` must include:
```
GA_API_SECRET=dummy_local_secret_for_testing
```
Then **restart the emulators** (the env file is read at startup).

---

## Error: `0 articles ranked` for every feed (Matrix)
**Cause:** The emulator Firestore has no `articles`, or no
`system/candidatePool_*` doc, and the on-demand pool build returns nothing.
**Fix:** Run the prod sync (should happen automatically):
```bash
cd c:\2SubTick\firebase
node scripts\sync-prod-to-emulator.js
```
Then confirm:
```bash
node scripts\probe-emulator.js   # shows articles/feeds/publishers counts
node scripts\test-emulator-e2e.js # shows getRankedFeed returning 30
```

---

## Error: `PERMISSION_DENIED` when the sync runs
**Cause:** `gcloud` is authenticated as the wrong account.
**Fix:**
```bash
gcloud auth list
gcloud config set account <the-account-that-owns-subtick-bbd55>
gcloud auth application-default login   # sign in with the SAME account
gcloud config get-value project         # must print: subtick-bbd55
```

---

## Error: `Cannot find module 'firebase-admin'` (sync script)
**Cause:** The script runs from the wrong directory.
**Fix:** Always run from `c:\2SubTick\firebase`:
```bash
cd c:\2SubTick\firebase
node scripts\sync-prod-to-emulator.js
```
(It resolves `firebase-admin` from `functions/node_modules`.)

---

## Error: Port already in use (9099 / 8080 / 5001)
**Cause:** A previous emulator is still running.
**Fix:** Close the "SubTick Emulators" command windows, then:
```bash
netstat -ano | findstr ":9099 :8080 :5001"
```
If listeners remain, kill the listed PIDs:
```bash
taskkill /PID <pid> /F
```

---

## The "SubTick Emulators - KEEP THIS WINDOW OPEN" window flashes and closes
**Cause:** `firebase emulators:start` failed (bad config, port conflict, or
wrong directory).
**Fix:** Run the exact command manually to see the error:
```bash
cd c:\2SubTick\firebase
firebase emulators:start --only auth,firestore,functions
```

---

## Everything works, but GA4 events are "missing"
Expected. The functions use `GA_API_SECRET` for Measurement Protocol. In the
emulator the secret is a dummy, so `sendGAEvents()` attempts the real GA4
endpoint, gets rejected (HTTP 4xx), and the error is swallowed
(`.catch(() => {})`) — so nothing is ingested. The Matrix results and scoring
are unaffected (they come from Firestore, not GA4).

> ⚠️ Never put the **real** `GA_API_SECRET` in `firebase/functions/.env`:
> emulator runs would then send real events to your live GA4 property.

---

## The Matrix shows my *previous* run's users
The Firestore emulator is in-memory and starts fresh each session, so this
should not persist. If it does, an older emulator process is still running —
see the port-in-use section above and fully stop it.

---

## Want a totally clean slate?
1. Close both emulator windows.
2. Delete `firebase\SKIP_SYNC.flag` (if you created one).
3. Double-click `firebase\start_emulators_fresh.bat` — it will re-sync
   production data from scratch.
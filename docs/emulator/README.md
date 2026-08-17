# SubTick Emulator Tools — Docs

- **`EMULATOR_GUIDE.md`** — the user manual: setup, daily workflow, data sync,
  scripts reference, and verification.
- **`TROUBLESHOOTING.md`** — fixes for the errors you're likely to hit
  (`auth/network-request-failed`, `Load failed: internal`, `0 articles`,
  wrong gcloud account, port conflicts).

## Quick Links

| Thing | Location |
|-------|----------|
| Main launcher | `c:\2SubTick\firebase\start_emulators_fresh.bat` |
| Prod → emulator sync | `c:\2SubTick\firebase\scripts\sync-prod-to-emulator.js` |
| UI server | `c:\2SubTick\scripts\start_matrix.bat` |
| End-to-end self-test | `c:\2SubTick\firebase\scripts\test-emulator-e2e.js` |
| Classification/WPM regression test | `c:\2SubTick\firebase\scripts\test-classification.js` |
| Data probe | `c:\2SubTick\firebase\scripts\probe-emulator.js` |

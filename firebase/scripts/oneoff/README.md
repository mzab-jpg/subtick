# One-off Migration Scripts

> ⚠️ **WARNING: These scripts are SPENT one-time migrations. Do not re-run them against production without fully understanding what they do.**

Each script was run once against the production Firestore database to perform a specific data migration or backfill. They are kept here for audit/reference only.

## Scripts

| Script | Purpose | Status |
|---|---|---|
| `cleanupOldCategories.js` | **July 2026 — Category migration.** Deletes all articles tagged with the 6 old category strings, purges them from the candidate pools, strips old category weights from user profiles, and removes stale publisher entries. Run once after deploying the new 9-category system and before `seedFeeds.js`. | **⚡ RUN THIS — see below** |
| `backfillRandomScore.js` | Assigns `random_score: Math.random()` to all existing articles that lacked the field. Required after the cost-optimisation deployment. | **SPENT — do not re-run** |
| `backfillRandomScore_root.js` | Same as above (duplicate from root). | **SPENT — do not re-run** |
| `cleanupArticles.js` | One-time cleanup of malformed/duplicate articles. | **SPENT** |
| `resetAndFetch.js` | ⚠️ Uses old truncated feed list (9 feeds, old categories). Do not run. | **SPENT — do not re-use** |
| `forceFetchAll.js` | ⚠️ Uses old truncated paywall keyword list and old categories. Do not run. | **SPENT — do not re-use** |
| `migrateUsers.js` | Migrated legacy user profile schema. | **SPENT** |
| `retroCategorize.js` | Back-filled `category` field on articles. | **SPENT** |
| `retroClean.js` | Removed legacy fields from articles. | **SPENT** |

## How to run (if ever needed)

```bash
cd firebase
node scripts/oneoff/<script-name>.js
```

Ensure you have Application Default Credentials configured (`gcloud auth application-default login`) before running.
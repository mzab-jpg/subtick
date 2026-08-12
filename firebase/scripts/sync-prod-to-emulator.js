/**
 * ============================================================
 * SubTick — Sync Production Firestore → Emulator Firestore
 *
 * Runs against a RUNNING emulator (Firestore on 127.0.0.1:8080)
 * and copies the data the algorithm needs FROM production.
 *
 * Usage:
 *   cd firebase          (with the emulator already running)
 *   node scripts/sync-prod-to-emulator.js
 *
 * Prerequisites:
 *   - gcloud auth application-default login (project: subtick-bbd55)
 *   - Firestore emulator running on the port in FIRESTORE_EMULATOR_HOST
 *     (default 127.0.0.1:8080)
 *
 * What it copies (matches the real algorithm's data needs):
 *   - articles   → the ranked-feed candidate pool (fallback queries)
 *   - feeds      → feed sources
 *   - publishers → dynamic quality scores (Q factor)
 *   - system/scoringConfig  → live config the dashboard/matrix read
 *   - system/previewConfig  → preview slot written by the dashboard
 *
 * What it SKIPS (on purpose):
 *   - users/* and all subcollections  → real-user PII; the Matrix
 *     creates its own anonymous test users
 *   - system/candidatePool_*         → the emulator rebuilds pools on
 *     demand from `articles` (see getRankedFeed.ts fallback)
 *
 * Connection pattern mirrors firebase/seedFeeds.js (verified real code).
 * ============================================================
 */

const admin = require('../functions/node_modules/firebase-admin');

const PROJECT_ID = 'subtick-bbd55';
const EMU_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

// Top-level collections to sync
const COLLECTIONS = ['articles', 'feeds', 'publishers'];

// system/{doc} documents to sync (config slots the tools read)
const SYSTEM_DOCS = ['scoringConfig', 'previewConfig'];

const BATCH_SIZE = 450; // Firestore write-batch limit is 500

let prodDb;
let emuDb;

function log(msg) {
  console.log(msg);
}

async function init() {
  log('====================================================================');
  log('SubTick — Production → Emulator Sync');
  log(`  Project : ${PROJECT_ID}`);
  log(`  Emulator: ${EMU_HOST}`);
  log('====================================================================');

  // Production connection (Application Default Credentials)
  const prodApp = admin.initializeApp({ projectId: PROJECT_ID }, 'prod-sync');
  prodDb = admin.firestore(prodApp);
  try {
    await prodDb.collection('articles').limit(1).get();
    log('  [1/2] Connected to PRODUCTION Firestore');
  } catch (err) {
    console.error('  FAILED to reach production:', err.message);
    console.error('  -> Run: gcloud auth application-default login');
    process.exit(1);
  }

  // Emulator connection (no auth; emulator accepts anything)
  const emuApp = admin.initializeApp({ projectId: PROJECT_ID }, 'emu-sync');
  emuDb = admin.firestore(emuApp);
  const [host, port] = EMU_HOST.split(':');
  emuDb.settings({ host: `${host}:${port}`, ssl: false });
  try {
    await emuDb.collection('sync_probe').doc('ping').get();
    log('  [2/2] Connected to EMULATOR Firestore');
  } catch (err) {
    console.error('  FAILED to reach the emulator at', EMU_HOST, ':', err.message);
    console.error('  -> Start the emulators first (start_emulators_fresh.bat), then retry.');
    process.exit(1);
  }
}

async function syncCollection(name) {
  log(`\nSyncing ${name} ...`);

  const src = prodDb.collection(name);
  const dst = emuDb.collection(name);

  let total = 0;
  let lastDoc = null;

  while (true) {
    let q = src.orderBy('__name__').limit(500);
    if (lastDoc) q = q.startAfter(lastDoc);

    const snap = await q.get();
    if (snap.empty) break;

    const docs = snap.docs;

    // Commit in sub-500 batches
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = emuDb.batch();
      const chunk = docs.slice(i, i + BATCH_SIZE);
      for (const doc of chunk) {
        batch.set(dst.doc(doc.id), doc.data(), { merge: false });
      }
      await batch.commit();
    }

    total += docs.length;
    lastDoc = docs[docs.length - 1];
    if (docs.length < 500) break;

    log(`    ... ${total} docs so far`);
  }

  log(`  Done: ${name} = ${total} documents`);
  return total;
}

async function syncSystemDocs() {
  log('\nSyncing system/{doc} ...');

  let total = 0;
  for (const docName of SYSTEM_DOCS) {
    const snap = await prodDb.collection('system').doc(docName).get();
    if (snap.exists) {
      await emuDb.collection('system').doc(docName).set(snap.data(), { merge: true });
      total++;
      log(`  Done: system/${docName}`);
    } else {
      log(`  Skipped: system/${docName} (not in production)`);
    }
  }

  log(`  system: ${total} documents`);
  return total;
}

async function main() {
  await init();

  const start = Date.now();
  let grandTotal = 0;

  for (const name of COLLECTIONS) {
    grandTotal += await syncCollection(name);
  }
  grandTotal += await syncSystemDocs();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log('\n====================================================================');
  log(`SYNC COMPLETE in ${elapsed}s — ${grandTotal} documents copied`);
  log('The emulator is ready for the High-Fidelity Matrix / Dashboard.');
  log('====================================================================');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nSYNC FAILED:', err.message);
  process.exit(1);
});
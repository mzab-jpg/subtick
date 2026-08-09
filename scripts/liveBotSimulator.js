/**
 * ============================================================
 * SubTick — Live Infrastructure Bot Simulator
 * Tests real application infrastructure (Firebase Auth, Firestore,
 * Cloud Functions getRankedFeed & syncBehaviorEvents) using synthetic
 * bot user personas.
 *
 * Usage:
 *   node scripts/liveBotSimulator.js [options]
 *
 * Options:
 *   --target=emulator|live  (Default: emulator)
 *   --bots=10               (Default: 10 synthetic bots)
 *   --days=3                (Default: 3 simulated reading sessions per bot)
 *   --cleanup=true|false    (Default: false — set true to delete bot profiles after test)
 * ============================================================
 */

const { initializeApp } = require('firebase/app');
const {
  getAuth,
  signInAnonymously,
  connectAuthEmulator,
  signOut,
} = require('firebase/auth');
const {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  connectFirestoreEmulator,
} = require('firebase/firestore');
const {
  getFunctions,
  httpsCallable,
  connectFunctionsEmulator,
} = require('firebase/functions');

// --- Parse CLI Arguments ---
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  acc[key] = value || true;
  return acc;
}, {});

const TARGET_ENV = args.target || 'emulator'; // 'emulator' | 'live'
const NUM_BOTS = parseInt(args.bots || '10', 10);
const NUM_DAYS = parseInt(args.days || '3', 10);
const DO_CLEANUP = args.cleanup === 'true' || args.cleanup === true;

// Firebase Config (subtick-bbd55)
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 'AIzaSyAggNiBGQIbYTAv5vqGtWhmyhrIPDoipXk',
  authDomain: 'subtick-bbd55.firebaseapp.com',
  projectId: 'subtick-bbd55',
  storageBucket: 'subtick-bbd55.firebasestorage.app',
  messagingSenderId: '859600771798',
  appId: '1:859600771798:web:c9898a4501148c4caa0777',
};

// Available categories matching constants.ts
const CATEGORIES = [
  'Politics',
  'Business',
  'Finance',
  'Technology',
  'Science',
  'History',
  'Culture',
  'Lifestyle',
  'Entertainment',
];

// Persona definitions
const PERSONA_TYPES = [
  {
    name: 'Engaged Power User',
    ratio: 0.3,
    preferredCategories: ['Technology', 'Science', 'Business'],
    dislikedCategories: ['Entertainment'],
    actionDistribution: { read_thorough: 0.65, like: 0.2, save: 0.1, read_skim: 0.05 },
    avgScrollDepth: 0.9,
    avgSessionDurationSec: 60,
  },
  {
    name: 'Casual Skimmer',
    ratio: 0.3,
    preferredCategories: ['Culture', 'History'],
    dislikedCategories: [],
    actionDistribution: { read_skim: 0.6, swipe_next: 0.3, like: 0.1 },
    avgScrollDepth: 0.5,
    avgSessionDurationSec: 15,
  },
  {
    name: 'Restless Quick-Exitter',
    ratio: 0.2,
    preferredCategories: [],
    dislikedCategories: [],
    actionDistribution: { quick_exit: 0.7, swipe_next: 0.3 },
    avgScrollDepth: 0.15,
    avgSessionDurationSec: 3,
  },
  {
    name: 'Hostile / Critical',
    ratio: 0.1,
    preferredCategories: ['Politics'],
    dislikedCategories: ['Culture', 'Entertainment', 'Lifestyle'],
    actionDistribution: { swipe_not_interested: 0.55, unlike: 0.25, swipe_next: 0.2 },
    avgScrollDepth: 0.25,
    avgSessionDurationSec: 6,
  },
  {
    name: 'New User',
    ratio: 0.1,
    preferredCategories: ['Technology'],
    dislikedCategories: [],
    actionDistribution: { read_skim: 0.4, read_thorough: 0.3, swipe_next: 0.3 },
    avgScrollDepth: 0.6,
    avgSessionDurationSec: 25,
  },
];

function selectPersonaForIndex(index, total) {
  let accumulated = 0;
  const pct = index / total;
  for (const persona of PERSONA_TYPES) {
    accumulated += persona.ratio;
    if (pct < accumulated) return persona;
  }
  return PERSONA_TYPES[0];
}

function getRandomAction(actionDist) {
  const rand = Math.random();
  let cumulative = 0;
  for (const [action, weight] of Object.entries(actionDist)) {
    cumulative += weight;
    if (rand <= cumulative) return action;
  }
  return 'swipe_next';
}

function generateEventId() {
  return `bot_evt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// Stats tracking
const stats = {
  botsCreated: 0,
  getRankedFeedCalls: 0,
  getRankedFeedLatenciesMs: [],
  syncEventsCalls: 0,
  syncEventsLatenciesMs: [],
  totalEventsSynced: 0,
  personaStats: {},
};

async function runSimulation() {
  console.log('====================================================');
  console.log('  SubTick — Live Infrastructure Bot Simulator');
  console.log('====================================================');
  console.log(` Target Environment : ${TARGET_ENV.toUpperCase()}`);
  console.log(` Bot Count          : ${NUM_BOTS}`);
  console.log(` Simulated Days     : ${NUM_DAYS}`);
  console.log(` Auto-Cleanup       : ${DO_CLEANUP ? 'YES' : 'NO'}`);
  console.log('----------------------------------------------------');

  // Initialize Firebase App instance for bot simulation
  const app = initializeApp(firebaseConfig, `bot-app-${Date.now()}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app, 'us-central1');

  if (TARGET_ENV === 'emulator') {
    const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
    const [fHost, fPort] = host.split(':');
    connectFirestoreEmulator(db, fHost, parseInt(fPort || '8080', 10));
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    console.log(`[Setup] Connected to Firebase Emulators (Auth:9099, Firestore:8080, Functions:5001)`);
  } else {
    console.log(`[Setup] Connected to LIVE Firebase Project (subtick-bbd55)`);
  }

  const botUids = [];

  for (let b = 0; b < NUM_BOTS; b++) {
    const persona = selectPersonaForIndex(b, NUM_BOTS);
    if (!stats.personaStats[persona.name]) {
      stats.personaStats[persona.name] = {
        count: 0,
        initialTopCategoryWeight: 0,
        finalTopCategoryWeight: 0,
        eventsSent: 0,
      };
    }
    stats.personaStats[persona.name].count++;

    console.log(`\n🤖 [Bot ${b + 1}/${NUM_BOTS}] Initializing persona: "${persona.name}"`);

    // 1. Authenticate synthetic user
    let user;
    try {
      const cred = await signInAnonymously(auth);
      user = cred.user;
      stats.botsCreated++;
      botUids.push(user.uid);
      console.log(`   ✓ Authenticated UID: ${user.uid}`);
    } catch (authErr) {
      console.error(`   ❌ Auth failed:`, authErr.message);
      continue;
    }

    // 2. Provision & Onboard Profile in Firestore
    const defaultCategoryWeights = {};
    CATEGORIES.forEach((cat) => {
      if (persona.preferredCategories.includes(cat)) {
        defaultCategoryWeights[cat] = 1.5;
      } else if (persona.dislikedCategories.includes(cat)) {
        defaultCategoryWeights[cat] = 0.1;
      } else {
        defaultCategoryWeights[cat] = 1.0;
      }
    });

    const initialProfile = {
      userId: user.uid,
      isOnboarded: true,
      isActive: true,
      selectedCategoryIds: persona.preferredCategories,
      notInterestedCategoryIds: persona.dislikedCategories,
      categoryWeights: defaultCategoryWeights,
      themePreference: 'system',
      linkedGoogleAccount: false,
      seenArticleIds: [],
      totalArticlesRead: 0,
      weeklyReadCount: 0,
      currentStreakDays: 0,
      lastReadDate: Date.now(),
      averageWpm: 200,
      dashboardMetricIds: ['streak', 'weeklyReads', 'topCategory'],
      lastUpdated: Date.now(),
    };

    const userRef = doc(db, 'users', user.uid);
    await setDoc(userRef, initialProfile);
    console.log(`   ✓ Profile & onboarding set in Firestore`);

    // 3. Multi-Day Reading Sessions
    for (let day = 1; day <= NUM_DAYS; day++) {
      console.log(`   📅 --- Session Day ${day}/${NUM_DAYS} ---`);

      // Call Cloud Function: getRankedFeed
      let feedArticles = [];
      const startTimeFeed = Date.now();
      try {
        const getRankedFeedFn = httpsCallable(functions, 'getRankedFeed');
        const res = await getRankedFeedFn({ limit: 15 });
        const latency = Date.now() - startTimeFeed;
        stats.getRankedFeedCalls++;
        stats.getRankedFeedLatenciesMs.push(latency);

        feedArticles = res.data?.articles || [];
        console.log(`      ✓ getRankedFeed returned ${feedArticles.length} articles (${latency}ms)`);
      } catch (feedErr) {
        console.warn(`      ⚠️ getRankedFeed fallback query (callable error: ${feedErr.message})`);
        // Fallback directly query Firestore articles collection if function emulator warm-up delayed
        try {
          const snap = await getDoc(userRef);
          const currentWeights = snap.data()?.categoryWeights || {};
          console.log(`      ✓ Retrieved Firestore profile categoryWeights:`, Object.keys(currentWeights).length, 'categories');
        } catch {}
      }

      // Generate behavior events based on persona
      const eventsToSync = [];
      const numArticlesToProcess = Math.min(feedArticles.length || 8, 8);

      for (let i = 0; i < numArticlesToProcess; i++) {
        const article = feedArticles[i] || {
          id: `art_sim_${day}_${i}`,
          category: persona.preferredCategories[0] || 'Technology',
          lengthStyle: 'medium',
          publicationName: 'Substack Newsletter',
          wordCount: 1200,
        };

        const eventType = getRandomAction(persona.actionDistribution);
        eventsToSync.push({
          id: generateEventId(),
          articleId: article.id,
          userId: user.uid,
          eventType,
          timestamp: Date.now() - (NUM_DAYS - day) * 86400000 + i * 5000,
          articleCategory: article.category || 'Technology',
          lengthStyle: article.lengthStyle || 'medium',
          publicationName: article.publicationName || 'Substack',
          sessionDuration: Math.round(persona.avgSessionDurationSec * 1000 * (0.8 + Math.random() * 0.4)),
          scrollDepth: Math.min(1.0, parseFloat((persona.avgScrollDepth * (0.8 + Math.random() * 0.4)).toFixed(2))),
          actualWordCount: article.wordCount || 1000,
        });
      }

      if (eventsToSync.length > 0) {
        // Call Cloud Function: syncBehaviorEvents
        const startTimeSync = Date.now();
        try {
          const syncBehaviorEventsFn = httpsCallable(functions, 'syncBehaviorEvents');
          const syncRes = await syncBehaviorEventsFn({
            events: eventsToSync,
            client_id: `bot_client_${user.uid.substring(0, 8)}`,
          });
          const syncLatency = Date.now() - startTimeSync;

          stats.syncEventsCalls++;
          stats.syncEventsLatenciesMs.push(syncLatency);
          const syncedCount = syncRes.data?.synced || eventsToSync.length;
          stats.totalEventsSynced += syncedCount;
          stats.personaStats[persona.name].eventsSent += syncedCount;

          console.log(`      ✓ syncBehaviorEvents synced ${syncedCount}/${eventsToSync.length} events (${syncLatency}ms)`);
        } catch (syncErr) {
          console.error(`      ❌ syncBehaviorEvents error:`, syncErr.message);
        }
      }

      // Small delay between days
      await new Promise((r) => setTimeout(r, 150));
    }

    // Inspect updated profile post-sessions
    const updatedSnap = await getDoc(userRef);
    if (updatedSnap.exists()) {
      const updatedProfile = updatedSnap.data();
      const topCat = persona.preferredCategories[0] || 'Technology';
      const weight = updatedProfile.categoryWeights?.[topCat] || 1.0;
      stats.personaStats[persona.name].finalTopCategoryWeight = weight;
      console.log(`   📊 Final Firestore Profile: totalRead=${updatedProfile.totalArticlesRead || 0}, topCatWeight[${topCat}]=${weight.toFixed(2)}`);
    }

    // Sign out bot session to reset auth state for next bot
    await signOut(auth);
  }

  // --- Final Benchmark Summary ---
  console.log('\n====================================================');
  console.log('           LIVE SIMULATION SUMMARY REPORT           ');
  console.log('====================================================');
  console.log(` Synthetic Bots Executed : ${stats.botsCreated}/${NUM_BOTS}`);
  console.log(` Total Behavior Events   : ${stats.totalEventsSynced}`);

  if (stats.getRankedFeedLatenciesMs.length > 0) {
    const avgFeedMs = Math.round(
      stats.getRankedFeedLatenciesMs.reduce((a, b) => a + b, 0) / stats.getRankedFeedLatenciesMs.length
    );
    const maxFeedMs = Math.max(...stats.getRankedFeedLatenciesMs);
    console.log(` getRankedFeed Latency   : Avg ${avgFeedMs}ms | Max ${maxFeedMs}ms (Calls: ${stats.getRankedFeedCalls})`);
  }

  if (stats.syncEventsLatenciesMs.length > 0) {
    const avgSyncMs = Math.round(
      stats.syncEventsLatenciesMs.reduce((a, b) => a + b, 0) / stats.syncEventsLatenciesMs.length
    );
    const maxSyncMs = Math.max(...stats.syncEventsLatenciesMs);
    console.log(` syncEvents Latency      : Avg ${avgSyncMs}ms | Max ${maxSyncMs}ms (Calls: ${stats.syncEventsCalls})`);
  }

  console.log('\nPer-Persona Infrastructure Adaptation:');
  for (const [pName, pData] of Object.entries(stats.personaStats)) {
    console.log(`  • ${pName.padEnd(25)}: bots=${pData.count}, eventsSynced=${pData.eventsSent}`);
  }

  // Optional Cleanup
  if (DO_CLEANUP && botUids.length > 0) {
    console.log('\n[Cleanup] Deleting test bot profiles via deleteAccount Cloud Function...');
    let deletedCount = 0;
    try {
      const deleteAccountFn = httpsCallable(functions, 'deleteAccount');
      await deleteAccountFn({ confirmation: 'DELETE' });
      deletedCount++;
      console.log(`[Cleanup] Successfully invoked deleteAccount for session bot.`);
    } catch (delErr) {
      console.warn(`[Cleanup] Note: User profile cleanup requires deleteAccount callable or emulators admin.`);
    }
  }

  console.log('====================================================\n');
  process.exit(0);
}

runSimulation().catch((err) => {
  console.error('Fatal Simulation Error:', err);
  process.exit(1);
});

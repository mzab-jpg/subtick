// ============================================================
// SubTick — Firebase Initialization
// ============================================================

import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { initializeAuth, getAuth, connectAuthEmulator, Auth } from 'firebase/auth';
// @ts-ignore — getReactNativePersistence exists at runtime in Firebase v12, TS types lag
import { getReactNativePersistence } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, Firestore } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, Functions } from 'firebase/functions';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';
import { FIREBASE_EMULATOR_CONFIG } from '../utils/constants';

const firebaseConfig = {
  apiKey: 'AIzaSyAggNiBGQIbYTAv5vqGtWhmyhrIPDoipXk',
  authDomain: 'subtick-bbd55.firebaseapp.com',
  projectId: 'subtick-bbd55',
  storageBucket: 'subtick-bbd55.firebasestorage.app',
  messagingSenderId: '859600771798',
  appId: '1:859600771798:web:c9898a4501148c4caa0777',
  measurementId: 'G-4B3N8C8MR3',
};

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
let functions: Functions;

// Initialize Firebase (singleton — prevents double-init on hot reload)
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
  // Use AsyncStorage persistence so auth tokens survive app restarts
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(ReactNativeAsyncStorage),
  });
} else {
  app = getApps()[0];
  auth = getAuth(app);
}
db = getFirestore(app);
functions = getFunctions(app, 'us-central1');

// --- Emulator Configuration ---
// By default, the app connects to PRODUCTION Firebase (works out of the box).
// To use local emulators for development:
//   1. Run `firebase emulators:start` in the firebase/ directory
//   2. Set EXPO_PUBLIC_USE_EMULATORS=true in your environment
const USE_EMULATORS = __DEV__ && process.env.EXPO_PUBLIC_USE_EMULATORS === 'true';

if (USE_EMULATORS) {
  console.log('[SubTick] 🔧 Connecting to Firebase Emulators...');
  connectAuthEmulator(auth, `http://${FIREBASE_EMULATOR_CONFIG.auth.host}:${FIREBASE_EMULATOR_CONFIG.auth.port}`, { disableWarnings: true });
  connectFirestoreEmulator(db, FIREBASE_EMULATOR_CONFIG.firestore.host, FIREBASE_EMULATOR_CONFIG.firestore.port);
  connectFunctionsEmulator(functions, FIREBASE_EMULATOR_CONFIG.functions.host, FIREBASE_EMULATOR_CONFIG.functions.port);
  console.log('[SubTick] ✅ Firebase Emulators connected');
} else {
  console.log('[SubTick] ☁️ Using production Firebase (project: subtick-bbd55)');
}

export { app, auth, db, functions };

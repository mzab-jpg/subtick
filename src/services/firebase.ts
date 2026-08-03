// ============================================================
// SubTick — Firebase Initialization
// ============================================================

import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { initializeAuth, getAuth, connectAuthEmulator, Auth } from 'firebase/auth';
// @ts-ignore — getReactNativePersistence exists at runtime in Firebase v12, TS types lag
import { getReactNativePersistence } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, Firestore } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, Functions } from 'firebase/functions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { FIREBASE_EMULATOR_CONFIG } from '../utils/constants';

// S6: Firebase web config values are public identifiers — not secrets.
// Security is enforced by Firestore security rules, not by keeping these private.
// They are hardcoded here as defaults (acceptable for Firebase web apps) and can
// be overridden via EXPO_PUBLIC_FIREBASE_* env vars for dev/staging environments.
// See .env.example for documentation.
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? 'AIzaSyAggNiBGQIbYTAv5vqGtWhmyhrIPDoipXk',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'subtick-bbd55.firebaseapp.com',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'subtick-bbd55',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'subtick-bbd55.firebasestorage.app',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '859600771798',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '1:859600771798:web:c9898a4501148c4caa0777',
};

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
let functions: Functions;

// Initialize Firebase (singleton — prevents double-init on hot reload)
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
  // Use expo-secure-store persistence so auth tokens survive app restarts
  // and are stored encrypted on-device (iOS Keychain / Android Keystore).
  // Firebase uses key names like "firebase:authUser:AIzaSy...:[default]"
  // which contain characters SecureStore rejects (:, [, ]). Sanitize them.
  const sanitizeKey = (key: string) => key.replace(/[^a-zA-Z0-9._-]/g, '_');
  const secureStorePersistence = {
    getItem: async (key: string) => {
      try {
        return await SecureStore.getItemAsync(sanitizeKey(key));
      } catch {
        return null;
      }
    },
    setItem: async (key: string, value: string) => {
      await SecureStore.setItemAsync(sanitizeKey(key), value);
    },
    removeItem: async (key: string) => {
      await SecureStore.deleteItemAsync(sanitizeKey(key));
    },
  };
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(secureStorePersistence),
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

// --- Analytics Client ID (GA4 Measurement Protocol, web stream) ---
// The GA4 web-stream Measurement Protocol requires a stable per-install
// `client_id` (commonly a UUID). We generate one once per app install and
// persist it in AsyncStorage, then send it to the Cloud Functions which forward
// it to GA4. This is NOT the Firebase Analytics SDK's internal ID — it's a
// stable UUID we control.
//
// The storage key is intentionally left as @subtick_app_instance_id for
// backwards compatibility, so existing installs keep their id after this
// rename.
const CLIENT_ID_KEY = '@subtick_app_instance_id';

let cachedClientId: string | null = null;

/**
 * Generate a GA4-compatible client_id in the standard dotted format:
 *   XXXXXXXXXX.XXXXXXXXXX  (two random 10-digit numbers separated by a dot)
 * This matches the format of the `_ga` cookie that the gtag.js library sets,
 * which GA4's Measurement Protocol pipeline is designed to accept.
 */
function generateGAClientId(): string {
  const rand10 = () => Math.floor(Math.random() * 9_000_000_000 + 1_000_000_000).toString();
  return `${rand10()}.${rand10()}`;
}

/**
 * Get the stable client_id for GA4 Measurement Protocol (web stream).
 * Generates a dotted GA4-format id on first call and caches it in AsyncStorage.
 * Accepts both the new dotted format and the legacy 32-hex format so existing
 * installs keep their id after this change.
 */
export async function getClientId(): Promise<string> {
  if (cachedClientId) return cachedClientId;

  try {
    const stored = await AsyncStorage.getItem(CLIENT_ID_KEY);
    // Accept both new dotted format and legacy 32-hex format
    if (stored && (/^\d{10}\.\d{10}$/.test(stored) || /^[0-9a-f]{32}$/i.test(stored))) {
      cachedClientId = stored;
      return stored;
    }
  } catch {
    // Fall through to generate a new one
  }

  // Generate a GA4-standard dotted client_id
  const clientId = generateGAClientId();
  cachedClientId = clientId;

  try {
    await AsyncStorage.setItem(CLIENT_ID_KEY, clientId);
  } catch {
    // Non-fatal — will regenerate next launch
  }

  return clientId;
}

export { app, auth, db, functions };

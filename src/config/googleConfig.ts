// Single source of truth for the Google Sign-In web client ID.
// Used by App.tsx (startup configure) and src/services/auth.ts (account linking).
export const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_FIREBASE_WEB_CLIENT_ID ||
  '859600771798-bco64ngenl3l5b349mcgr29pp868chjn.apps.googleusercontent.com';
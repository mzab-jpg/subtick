// ============================================================
// SubTick — Firebase Authentication Service
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  signInAnonymously,
  onAuthStateChanged,
  signOut,
  signInWithCredential,
  linkWithCredential,
  GoogleAuthProvider,
  unlink,
  deleteUser,
  User,
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from './firebase';
import {
  CATEGORIES,
  DEFAULT_SELECTED_WEIGHT,
  DEFAULT_NOT_INTERESTED_WEIGHT,
  DEFAULT_NEUTRAL_WEIGHT,
  DEFAULT_DASHBOARD_METRIC_IDS,
} from '../utils/constants';
import { UserProfile } from '../types';

// --- Anonymous Sign-In ---
// Called on first app launch. Returns the authenticated User.
export async function signInAnonymouslyIfNeeded(): Promise<User> {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubscribe();
      if (user) {
        // Already signed in
        resolve(user);
      } else {
        try {
          const credential = await signInAnonymously(auth);
          resolve(credential.user);
        } catch (error) {
          reject(error);
        }
      }
    });
  });
}

// --- Create or Update User Profile in Firestore ---
export async function ensureUserProfile(user: User): Promise<UserProfile> {
  const userRef = doc(db, 'users', user.uid);
  const snap = await getDoc(userRef);

  if (snap.exists()) {
    const existing = snap.data() as UserProfile;
    return existing;
  }

  // New user — create default profile with neutral weights for all categories
  const defaultCategoryWeights: Record<string, number> = {};
  CATEGORIES.forEach((cat) => {
    defaultCategoryWeights[cat.id] = DEFAULT_NEUTRAL_WEIGHT;
  });

  const profile: UserProfile = {
    userId: user.uid,
    isOnboarded: false,
    isActive: true,
    selectedCategoryIds: [],
    notInterestedCategoryIds: [],
    categoryWeights: defaultCategoryWeights,
    themePreference: 'system',
    linkedGoogleAccount: false,
    seenArticleIds: [],
    totalArticlesRead: 0,
    weeklyReadCount: 0,
    currentStreakDays: 0,
    lastReadDate: 0,
    averageWpm: 200,
    dashboardMetricIds: DEFAULT_DASHBOARD_METRIC_IDS,
    lastUpdated: Date.now(),
  };

  await setDoc(userRef, profile);
  return profile;
}

// --- Link Google Account (Native) ---
// Uses @react-native-google-signin/google-signin for native Google Sign-In,
// then links the credential to the existing anonymous Firebase account.
// This preserves the same UID and all user data.
export async function linkGoogleAccount(): Promise<User> {
  try {
    // Dynamic import to avoid crash if package isn't installed in web/dev
    const { GoogleSignin, isSuccessResponse } = await import('@react-native-google-signin/google-signin');

    if (__DEV__) console.log('[Auth] GoogleSignin module loaded, checking Play Services...');

    // Ensure Play Services are available (Android)
    await GoogleSignin.hasPlayServices();
    if (__DEV__) console.log('[Auth] Play Services available, calling signIn()...');

    // Sign in with Google (native)
    const signInResult = await GoogleSignin.signIn();
    if (__DEV__) {
      console.log('[Auth] signIn() returned. type:', signInResult.type);
      console.log('[Auth] signIn() data keys:', signInResult.data ? Object.keys(signInResult.data) : 'none');
    }

    if (!isSuccessResponse(signInResult)) {
      throw new Error(`Google Sign-In was cancelled or failed. type=${signInResult.type}`);
    }

    const { idToken, user: googleUser } = signInResult.data;
    if (__DEV__) console.log('[Auth] idToken received:', !!idToken, 'length:', idToken?.length);

    if (!idToken) {
      throw new Error('No idToken returned from Google Sign-In');
    }

    // Create Firebase credential from the Google idToken
    const credential = GoogleAuthProvider.credential(idToken);
    if (__DEV__) console.log('[Auth] Firebase credential created, linking...');

    // Try to link credential to the existing anonymous account.
    // If the Google account is already linked to a different Firebase account,
    // sign in as that user instead (recovers previous data).
    let result;
    try {
      result = await linkWithCredential(auth.currentUser!, credential);
      if (__DEV__) console.log('[Auth] linkWithCredential succeeded. providerData:', result.user.providerData?.length);
    } catch (linkError: any) {
      if (linkError.code === 'auth/credential-already-in-use') {
        if (__DEV__) console.log('[Auth] Credential already in use — signing in as existing Google-linked user');
        // Save the orphan anonymous UID before signing out so we can clean it up
        const oldAnonymousUid = auth.currentUser?.uid;
        // Sign out of current anonymous, sign in as the Google-linked user
        await signOut(auth);
        result = await signInWithCredential(auth, credential);
        if (__DEV__) console.log('[Auth] signInWithCredential succeeded. uid:', result.user.uid);
        // Ensure Firestore profile exists for the recovered account (preserves all data)
        await ensureUserProfile(result.user);
        // Clean up the orphan anonymous account — delete the now-stale
        // Firestore profile that was created by ensureUserProfile for the
        // anonymous session. The anonymous auth account will be auto-cleaned
        // by Firebase after 30 days of inactivity.
        if (oldAnonymousUid && oldAnonymousUid !== result.user.uid) {
          try {
            const deleteOrphanFn = httpsCallable<{ orphanUid: string }, { success: boolean }>(
              functions,
              'deleteOrphanProfile'
            );
            await deleteOrphanFn({ orphanUid: oldAnonymousUid });
            if (__DEV__) console.log('[Auth] Deleted orphan Firestore profile:', oldAnonymousUid);
          } catch (cleanupErr) {
            console.warn('[Auth] Could not delete orphan Firestore profile:', cleanupErr);
          }
        }
      } else {
        throw linkError;
      }
    }

    // Update Firestore profile with linked status and email
    const userRef = doc(db, 'users', result.user.uid);
    await setDoc(
      userRef,
      {
        linkedGoogleAccount: true,
        userEmail: result.user.email || googleUser.email || '',
        lastUpdated: Date.now(),
      },
      { merge: true }
    );

    return result.user;
  } catch (error: any) {
    console.error('[Auth] Google Sign-In FAILED');
    console.error('[Auth] Error name:', error?.name);
    console.error('[Auth] Error code:', error?.code);
    console.error('[Auth] Error message:', error?.message);
    throw error;
  }
}

// --- Unlink Google Account ---
export async function unlinkGoogleAccount(): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('No authenticated user');

  await unlink(user, GoogleAuthProvider.PROVIDER_ID);

  // Also sign out of Google Sign-In to clear cached session
  try {
    const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
    await GoogleSignin.signOut();
  } catch {
    // GoogleSignin not available (e.g., web/dev) — ignore
  }

  const userRef = doc(db, 'users', user.uid);
  await setDoc(
    userRef,
    {
      linkedGoogleAccount: false,
      userEmail: '',
      lastUpdated: Date.now(),
    },
    { merge: true }
  );
}

// --- Sign Out ---
export async function signOutUser(): Promise<void> {
  // Wipe all local AsyncStorage data (seen articles, saved HTML, behavior queue)
  // before signing out so stale data from the old UID doesn't persist.
  await clearAllLocalData();
  await signOut(auth);
  // After sign-out, immediately sign in anonymously again
  const newUser = await signInAnonymouslyIfNeeded();
  // Create a fresh Firestore profile for the new anonymous UID,
  // ensuring Dashboard has a valid profile to render immediately.
  await ensureUserProfile(newUser);
}

// --- Update Onboarding Status ---
export async function completeOnboarding(
  userId: string,
  selectedCategoryIds: string[],
  notInterestedCategoryIds: string[]
): Promise<void> {
  // Build category weights from selections
  const categoryWeights: Record<string, number> = {};
  CATEGORIES.forEach((cat) => {
    if (selectedCategoryIds.includes(cat.id)) {
      categoryWeights[cat.id] = DEFAULT_SELECTED_WEIGHT;
    } else if (notInterestedCategoryIds.includes(cat.id)) {
      categoryWeights[cat.id] = DEFAULT_NOT_INTERESTED_WEIGHT;
    } else {
      categoryWeights[cat.id] = DEFAULT_NEUTRAL_WEIGHT;
    }
  });

  const userRef = doc(db, 'users', userId);
  await setDoc(
    userRef,
    {
      isOnboarded: true,
      selectedCategoryIds,
      notInterestedCategoryIds,
      categoryWeights,
      lastUpdated: Date.now(),
    },
    { merge: true }
  );
}

// --- Update Category Weights (from Settings) ---
export async function updateCategoryWeights(
  userId: string,
  categoryWeights: Record<string, number>,
  selectedCategoryIds: string[],
  notInterestedCategoryIds: string[]
): Promise<void> {
  const userRef = doc(db, 'users', userId);
  await setDoc(
    userRef,
    {
      categoryWeights,
      selectedCategoryIds,
      notInterestedCategoryIds,
      lastUpdated: Date.now(),
    },
    { merge: true }
  );
}

// --- Fetch User Profile ---
export async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
  const userRef = doc(db, 'users', userId);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return null;
  return snap.data() as UserProfile;
}

// --- Clear all local AsyncStorage data (seen articles, saved HTML, behavior queue) ---

export async function clearAllLocalData(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const keysToRemove = keys.filter((key) =>
      key.startsWith('@subtick_')
    );
    if (keysToRemove.length > 0) {
      await AsyncStorage.multiRemove(keysToRemove);
    }
    console.log('[Auth] Cleared all local AsyncStorage data.');
  } catch (error) {
    console.error('[Auth] clearAllLocalData error:', error);
    throw error;
  }
}

// --- Reset Account — calls Cloud Function to delete data and reset profile ---
export async function resetAccount(): Promise<void> {
  const resetAccountFn = httpsCallable(functions, 'resetAccount');
  await resetAccountFn();
  // Clear local data after server reset
  await clearAllLocalData();
}

// --- Delete Account — calls Cloud Function to permanently delete all data ---
export async function deleteAccount(): Promise<void> {
  const deleteAccountFn = httpsCallable(functions, 'deleteAccount');
  await deleteAccountFn({ confirmation: 'DELETE' });
  // Clear local data after server deletion
  await clearAllLocalData();
  // Sign out (clear auth state)
  await signOut(auth);
  // Re-sign in anonymously (so the app still works)
  await signInAnonymouslyIfNeeded();
}

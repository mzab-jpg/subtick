// ============================================================
// SubTick — Firebase Authentication Service
// ============================================================

import {
  signInAnonymously,
  onAuthStateChanged,
  signOut,
  linkWithPopup,
  GoogleAuthProvider,
  unlink,
  User,
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { auth, db } from './firebase';
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
    // Update last seen timestamp
    await setDoc(userRef, { lastUpdated: Date.now() }, { merge: true });
    return { ...existing, lastUpdated: Date.now() };
  }

  // New user — create default profile with neutral weights for all categories
  const defaultCategoryWeights: Record<string, number> = {};
  CATEGORIES.forEach((cat) => {
    defaultCategoryWeights[cat.id] = DEFAULT_NEUTRAL_WEIGHT;
  });

  const profile: UserProfile = {
    userId: user.uid,
    isOnboarded: false,
    selectedCategoryIds: [],
    notInterestedCategoryIds: [],
    categoryWeights: defaultCategoryWeights,
    themePreference: 'system',
    linkedGoogleAccount: false,
    totalArticlesRead: 0,
    totalArticlesSaved: 0,
    totalArticlesLiked: 0,
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

// --- Link Google Account ---
export async function linkGoogleAccount(): Promise<User> {
  const provider = new GoogleAuthProvider();
  const result = await linkWithPopup(auth.currentUser!, provider);
  // Update Firestore profile to reflect linked status
  const userRef = doc(db, 'users', result.user.uid);
  await setDoc(userRef, { linkedGoogleAccount: true, lastUpdated: Date.now() }, { merge: true });
  return result.user;
}

// --- Unlink Google Account ---
export async function unlinkGoogleAccount(): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('No authenticated user');

  await unlink(user, GoogleAuthProvider.PROVIDER_ID);
  const userRef = doc(db, 'users', user.uid);
  await setDoc(userRef, { linkedGoogleAccount: false, lastUpdated: Date.now() }, { merge: true });
}

// --- Sign Out ---
export async function signOutUser(): Promise<void> {
  await signOut(auth);
  // After sign-out, immediately sign in anonymously again
  await signInAnonymouslyIfNeeded();
}

// --- Get Current User ---
export function getCurrentUser(): User | null {
  return auth.currentUser;
}

// --- Auth State Observer ---
export function onAuthChange(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
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
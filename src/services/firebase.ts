import { initializeApp, FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  Auth,
  User as FirebaseUser
} from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, Firestore } from "firebase/firestore";
import type { User, CachedAuthState, WordStatus } from '../types';

// Firebase configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// Set auth persistence to LOCAL for faster auth checks
setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error("Error setting auth persistence:", error);
});

// Sign up with email and password
export const signUpWithEmail = async (
  email: string,
  password: string,
  displayName?: string
): Promise<FirebaseUser> => {
  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);

    // Update profile with display name if provided
    if (displayName && result.user) {
      await updateProfile(result.user, { displayName });
    }

    return result.user;
  } catch (error: any) {
    console.error("Error signing up with email:", error);
    throw new Error(getAuthErrorMessage(error.code));
  }
};

// Sign in with email and password
export const signInWithEmail = async (
  email: string,
  password: string
): Promise<FirebaseUser> => {
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return result.user;
  } catch (error: any) {
    console.error("Error signing in with email:", error);
    throw new Error(getAuthErrorMessage(error.code));
  }
};

// Reset password
export const resetPassword = async (email: string): Promise<void> => {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (error: any) {
    console.error("Error sending password reset email:", error);
    throw new Error(getAuthErrorMessage(error.code));
  }
};

// Sign in with Google
export const signInWithGoogle = async (): Promise<FirebaseUser> => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error("Error signing in with Google:", error);
    throw error;
  }
};

// Helper function to convert Firebase error codes to user-friendly messages
function getAuthErrorMessage(errorCode: string): string {
  const errorMessages: { [key: string]: string } = {
    'auth/email-already-in-use': 'Этот email уже зарегистрирован',
    'auth/invalid-email': 'Неверный формат email',
    'auth/operation-not-allowed': 'Email/пароль аутентификация не включена в настройках Firebase. Пожалуйста, используйте вход через Google.',
    'auth/weak-password': 'Пароль должен быть минимум 6 символов',
    'auth/user-disabled': 'Этот аккаунт был отключен',
    'auth/user-not-found': 'Аккаунт с таким email не найден',
    'auth/wrong-password': 'Неверный пароль',
    'auth/too-many-requests': 'Слишком много попыток. Попробуйте позже',
    'auth/network-request-failed': 'Ошибка сети. Проверьте интернет-соединение'
  };

  return errorMessages[errorCode] || 'Произошла ошибка. Попробуйте снова';
}

// Sign out
export const logOut = async (): Promise<void> => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Error signing out:", error);
    throw error;
  }
};

// Save user progress
export const saveProgress = async (
  userId: string,
  wordId: string,
  status: WordStatus
): Promise<void> => {
  try {
    const userProgressRef = doc(db, "users", userId, "progress", wordId);
    await setDoc(userProgressRef, {
      status,
      timestamp: new Date().toISOString()
    }, { merge: true });
  } catch (error) {
    console.error("Error saving progress:", error);
    throw error;
  }
};

// Get user progress
export const getUserProgress = async (userId: string): Promise<any | null> => {
  try {
    const userDocRef = doc(db, "users", userId);
    const userDoc = await getDoc(userDocRef);

    if (userDoc.exists()) {
      return userDoc.data();
    }
    return null;
  } catch (error) {
    console.error("Error getting user progress:", error);
    throw error;
  }
};

// Auth state caching
export const cacheAuthState = (user: FirebaseUser | null): void => {
  if (user) {
    const cachedState: CachedAuthState = {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName,
      photoURL: user.photoURL
    };
    localStorage.setItem('auth_cached', JSON.stringify(cachedState));
  } else {
    localStorage.removeItem('auth_cached');
  }
};

export const getCachedAuthState = (): CachedAuthState | null => {
  try {
    const cached = localStorage.getItem('auth_cached');
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    return null;
  }
};

// Export auth and db for use in other files
export { auth, db, onAuthStateChanged, updateProfile };

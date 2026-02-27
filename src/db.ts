// PostgreSQL API Client
const API_URL = import.meta.env.VITE_API_URL || '/api';

// Helper function for fetch with error handling
async function fetchAPI(url, options = {}) {
  try {
    console.log(`[DB] Fetching: ${url}`, options);
    const response = await fetch(url, options);
    console.log(`[DB] Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[DB] Error response:`, errorText);
      throw new Error(`API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log(`[DB] Response data:`, data);
    return data;
  } catch (error) {
    console.error(`[DB] Fetch error for ${url}:`, error);
    throw error;
  }
}

// ============ USERS API ============

export const initUserProfile = async (user) => {
  try {
    const response = await fetch(`${API_URL}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL
      })
    });

    if (!response.ok) throw new Error('Failed to init user profile');
    return await response.json();
  } catch (error) {
    console.error('Error initializing user profile:', error);
    throw error;
  }
};

export const getUserProfile = async (uid) => {
  try {
    const response = await fetch(`${API_URL}/users/${uid}`);
    if (!response.ok) throw new Error('User not found');
    return await response.json();
  } catch (error) {
    console.error('Error getting user profile:', error);
    throw error;
  }
};

export const saveUserRoleAndLanguage = async (uid, role, nativeLanguage = null) => {
  try {
    const response = await fetch(`${API_URL}/users/${uid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, nativeLanguage })
    });

    if (!response.ok) throw new Error('Failed to update user');
    return await response.json();
  } catch (error) {
    console.error('Error saving user role and language:', error);
    throw error;
  }
};

export const getUserNativeLanguage = async (uid) => {
  try {
    const user = await getUserProfile(uid);
    return user.native_language || 'ru';
  } catch (error) {
    console.error('Error getting native language:', error);
    return 'ru';
  }
};

// ============ PROGRESS API ============

export const getProgress = async (uid, tier = 'tier2') => {
  try {
    const response = await fetch(`${API_URL}/progress/${uid}/${tier}`);
    if (!response.ok) throw new Error('Failed to get progress');
    return await response.json();
  } catch (error) {
    console.error('Error getting progress:', error);
    return { words: {}, lastUpdated: null };
  }
};

export const saveWordProgress = async (uid, tier, wordId, status) => {
  try {
    const response = await fetch(`${API_URL}/progress/${uid}/${tier}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wordId, status })
    });

    if (!response.ok) throw new Error('Failed to save progress');
    return await response.json();
  } catch (error) {
    console.error('Error saving word progress:', error);
    throw error;
  }
};

export const saveProgressBatch = async (uid, tier, words) => {
  try {
    const response = await fetch(`${API_URL}/progress/${uid}/${tier}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words })
    });

    if (!response.ok) throw new Error('Failed to save batch progress');
    return await response.json();
  } catch (error) {
    console.error('Error saving batch progress:', error);
    throw error;
  }
};

export const getProgressStats = async (uid, tier = 'tier2') => {
  try {
    const response = await fetch(`${API_URL}/progress/${uid}/${tier}/stats`);
    if (!response.ok) throw new Error('Failed to get stats');
    return await response.json();
  } catch (error) {
    console.error('Error getting stats:', error);
    return { known: 0, unsure: 0, unknown: 0, total: 0 };
  }
};

export const getLearnedWords = async (uid, tier = 'tier2') => {
  try {
    const response = await fetch(`${API_URL}/progress/${uid}/${tier}/learned`);
    if (!response.ok) throw new Error('Failed to get learned words');
    return await response.json();
  } catch (error) {
    console.error('Error getting learned words:', error);
    return { words: [] };
  }
};

// ============ COMPATIBILITY WITH FIRESTORE ============

// For backwards compatibility with existing code
export const getDoc = async (docRef) => {
  // Extract uid and collection from docRef path
  const pathParts = docRef.path?.split('/') || docRef._key?.path?.segments || [];

  if (pathParts[0] === 'users' && pathParts.length === 2) {
    const uid = pathParts[1];
    const user = await getUserProfile(uid);
    return {
      exists: () => !!user,
      data: () => user
    };
  }

  if (pathParts[0] === 'users' && pathParts[2] === 'progress') {
    const uid = pathParts[1];
    const tier = pathParts[3];
    const progress = await getProgress(uid, tier);
    return {
      exists: () => !!progress.words && Object.keys(progress.words).length > 0,
      data: () => progress
    };
  }

  return { exists: () => false, data: () => null };
};

export const setDoc = async (docRef, data, options = {}) => {
  const pathParts = docRef.path?.split('/') || docRef._key?.path?.segments || [];

  if (pathParts[0] === 'users' && pathParts[2] === 'progress') {
    const uid = pathParts[1];
    const tier = pathParts[3];

    if (options.merge && data.words) {
      return await saveProgressBatch(uid, tier, data.words);
    }
  }

  throw new Error('setDoc not implemented for this path');
};

export const doc = (db, ...pathSegments) => {
  return {
    path: pathSegments.join('/'),
    _key: { path: { segments: pathSegments } }
  };
};

// ============ SESSIONS API ============

export const saveSession = async (
  uid: string,
  tier: string,
  durationSeconds: number,
  wordsReviewed: number,
  knownCount: number,
  unsureCount: number,
  unknownCount: number,
  completed: boolean
) => {
  try {
    const response = await fetch(`${API_URL}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userUid: uid,
        tier,
        durationSeconds,
        wordsReviewed,
        knownCount,
        unsureCount,
        unknownCount,
        completed
      })
    });

    if (!response.ok) throw new Error('Failed to save session');
    return await response.json();
  } catch (error) {
    console.error('Error saving session:', error);
    throw error;
  }
};

export const getSessions = async (uid: string) => {
  try {
    const response = await fetch(`${API_URL}/sessions/${uid}`);
    if (!response.ok) throw new Error('Failed to get sessions');
    return await response.json();
  } catch (error) {
    console.error('Error getting sessions:', error);
    return [];
  }
};

export const getSessionStats = async (uid: string) => {
  try {
    const response = await fetch(`${API_URL}/sessions/${uid}/stats`);
    if (!response.ok) throw new Error('Failed to get session stats');
    return await response.json();
  } catch (error) {
    console.error('Error getting session stats:', error);
    return { total_sessions: 0, total_seconds: 0, total_words_reviewed: 0, completed_sessions: 0 };
  }
};

// ============ STREAK API ============

export const updateStreak = async (uid: string) => {
  try {
    console.log('🔵 updateStreak called for uid:', uid);
    console.log('🔵 API_URL:', API_URL);
    console.log('🔵 Full URL:', `${API_URL}/streak/${uid}`);

    const response = await fetch(`${API_URL}/streak/${uid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    console.log('🔵 Streak API response status:', response.status);
    console.log('🔵 Streak API response ok:', response.ok);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Failed to update streak:', response.status, errorText);
      return { current_streak: 0, longest_streak: 0, last_activity_date: null, streak_increased: false };
    }
    const data = await response.json();
    console.log('✅ Streak API returned data:', JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error('❌ Error updating streak:', error);
    return { current_streak: 0, longest_streak: 0, last_activity_date: null, streak_increased: false };
  }
};

export const getStreak = async (uid: string) => {
  try {
    const response = await fetch(`${API_URL}/streak/${uid}`);
    if (!response.ok) throw new Error('Failed to get streak');
    return await response.json();
  } catch (error) {
    console.error('Error getting streak:', error);
    return { current_streak: 0, longest_streak: 0, last_activity_date: null, streak_earned_today: false };
  }
};

export const resetStreak = async (uid: string) => {
  try {
    console.log('🔵 Resetting streak for uid:', uid);
    const response = await fetch(`${API_URL}/streak/${uid}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Failed to reset streak:', response.status, errorText);
      throw new Error('Failed to reset streak');
    }
    const data = await response.json();
    console.log('✅ Streak reset:', data);
    return data;
  } catch (error) {
    console.error('❌ Error resetting streak:', error);
    throw error;
  }
};

// Export for Firestore compatibility
export const getFirestore = () => ({});

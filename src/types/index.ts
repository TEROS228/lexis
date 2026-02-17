// User types
export interface User {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
}

export interface CachedAuthState {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
}

export type UserRole = 'student' | 'teacher';
export type NativeLanguage = 'ru' | 'zh';
export type Language = 'ru' | 'en' | 'zh';

export interface UserProfile {
  user_id: string;
  email: string;
  display_name: string | null;
  photo_url: string | null;
  role: UserRole;
  native_language: NativeLanguage;
  created_at: string;
  last_login: string;
}

// Word types
export type WordStatus = 'known' | 'unsure' | 'unknown';

export interface Word {
  id: string;
  en: string;
  ru: string;
  zh: string;
}

export interface WordProgress {
  [wordId: string]: WordStatus;
}

export interface ProgressData {
  words: WordProgress;
  lastUpdated: string | null;
}

export interface LearnedWord {
  word_id: string;
  first_seen_at: string;
  learned_at: string;
}

export interface LearnedWordsData {
  words: LearnedWord[];
}

// Quiz types
export interface QuizQuestion {
  question: string;
  options: string[];
  correct: number;
}

export interface QuizData {
  [wordId: string]: QuizQuestion;
}

// Word details types
export interface WordDetail {
  meaning: string;
  context: string;
  example: string;
}

export interface WordDetailsData {
  [wordId: string]: {
    ru: WordDetail;
    zh: WordDetail;
  };
}

// Translation types
export interface Translations {
  [lang: string]: {
    [key: string]: any;
  };
}

// API Response types
export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

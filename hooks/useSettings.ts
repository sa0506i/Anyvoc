import { useCallback } from 'react';
import { create } from 'zustand';
import { useSQLiteContext } from 'expo-sqlite';
import * as Localization from 'expo-localization';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getAllSettings, setSetting as dbSetSetting, clearAllData } from '../lib/database';
import { languages } from '../constants/languages';

/** Returns the device's primary language code if it's a supported language, otherwise 'en'. */
function getDeviceNativeLanguage(): string {
  const supported = new Set(languages.map((l) => l.code));
  const locales = Localization.getLocales();
  for (const loc of locales) {
    const code = loc.languageCode?.toLowerCase();
    if (code && supported.has(code)) return code;
  }
  return 'en';
}

/** Returns a sensible default learning language that differs from the native language. */
function getDefaultLearningLanguage(nativeLang: string): string {
  if (nativeLang !== 'en') return 'en';
  return languages.find((l) => l.code !== nativeLang)?.code ?? 'de';
}

export type QuizDirection = 'native-to-learning' | 'learning-to-native' | 'random';
export type QuizMode = 'flashcard' | 'typing';

interface SettingsState {
  nativeLanguage: string;
  learningLanguage: string;
  level: string;
  quizDirection: QuizDirection;
  quizMode: QuizMode;
  cardsPerRound: string;
  proMode: boolean;
  loaded: boolean;

  loadSettings: (db: SQLiteDatabase) => void;
  updateSetting: (db: SQLiteDatabase, key: string, value: string) => void;
  resetApp: (db: SQLiteDatabase) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  nativeLanguage: 'en',
  learningLanguage: 'en',
  level: 'A2',
  quizDirection: 'random',
  quizMode: 'flashcard',
  cardsPerRound: '20',
  proMode: false,
  loaded: false,

  loadSettings: (db) => {
    const settings = getAllSettings(db);

    // Migrate any stored language codes that are no longer in the supported list.
    const validCodes = new Set(languages.map((l) => l.code));
    if (settings['nativeLanguage'] && !validCodes.has(settings['nativeLanguage'])) {
      settings['nativeLanguage'] = 'en';
      dbSetSetting(db, 'nativeLanguage', 'en');
    }
    if (settings['learningLanguage'] && !validCodes.has(settings['learningLanguage'])) {
      settings['learningLanguage'] = 'en';
      dbSetSetting(db, 'learningLanguage', 'en');
    }

    // First launch: derive nativeLanguage from device locale and persist it.
    if (!settings['nativeLanguage']) {
      const deviceLang = getDeviceNativeLanguage();
      settings['nativeLanguage'] = deviceLang;
      dbSetSetting(db, 'nativeLanguage', deviceLang);
    }

    // First launch: derive learningLanguage that differs from native and persist it.
    if (!settings['learningLanguage']) {
      const defaultLearning = getDefaultLearningLanguage(settings['nativeLanguage']);
      settings['learningLanguage'] = defaultLearning;
      dbSetSetting(db, 'learningLanguage', defaultLearning);
    }

    set({
      nativeLanguage: settings['nativeLanguage'] ?? getDeviceNativeLanguage(),
      learningLanguage:
        settings['learningLanguage'] ??
        getDefaultLearningLanguage(settings['nativeLanguage'] ?? getDeviceNativeLanguage()),
      level: settings['level'] ?? 'A2',
      quizDirection: (settings['quizDirection'] as QuizDirection) ?? 'random',
      quizMode: (settings['quizMode'] as QuizMode) ?? 'flashcard',
      cardsPerRound: settings['cardsPerRound'] ?? '20',
      proMode: settings['proMode'] === 'true',
      loaded: true,
    });
  },

  updateSetting: (db, key, value) => {
    dbSetSetting(db, key, value);
    if (key === 'proMode') {
      set({ proMode: value === 'true' });
    } else {
      set({ [key]: value } as Partial<SettingsState>);
    }
  },

  resetApp: (db) => {
    clearAllData(db);
    const deviceLang = getDeviceNativeLanguage();
    const defaultLearning = getDefaultLearningLanguage(deviceLang);
    dbSetSetting(db, 'nativeLanguage', deviceLang);
    dbSetSetting(db, 'learningLanguage', defaultLearning);
    set({
      nativeLanguage: deviceLang,
      learningLanguage: defaultLearning,
      level: 'A2',
      quizDirection: 'random',
      quizMode: 'flashcard',
      cardsPerRound: '20',
      proMode: false,
    });
  },
}));

/**
 * Hook that returns settings actions bound to the current DB context.
 * For reading settings state, use useSettingsStore(selector) directly.
 */
export function useSettingsActions() {
  const db = useSQLiteContext();
  const { loadSettings, updateSetting, resetApp } = useSettingsStore();

  return {
    loadSettings: useCallback(() => loadSettings(db), [db, loadSettings]),
    updateSetting: useCallback(
      (key: string, value: string) => updateSetting(db, key, value),
      [db, updateSetting],
    ),
    resetApp: useCallback(() => resetApp(db), [db, resetApp]),
  };
}

/**
 * @deprecated Use useSettingsStore(selector) for state + useSettingsActions() for actions.
 * Kept for backward compatibility during migration.
 */
export function useSettings() {
  const db = useSQLiteContext();
  const store = useSettingsStore();

  return {
    ...store,
    loadSettings: useCallback(() => store.loadSettings(db), [db, store.loadSettings]),
    updateSetting: useCallback(
      (key: string, value: string) => store.updateSetting(db, key, value),
      [db, store.updateSetting],
    ),
    resetApp: useCallback(() => store.resetApp(db), [db, store.resetApp]),
  };
}

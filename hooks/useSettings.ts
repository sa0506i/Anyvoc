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

export type QuizDirection = 'native-to-learning' | 'learning-to-native' | 'random';

interface SettingsState {
  nativeLanguage: string;
  learningLanguage: string;
  level: string;
  quizDirection: QuizDirection;
  cardsPerRound: string;
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
  cardsPerRound: '20',
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

    set({
      nativeLanguage: settings['nativeLanguage'] ?? getDeviceNativeLanguage(),
      learningLanguage: settings['learningLanguage'] ?? 'en',
      level: settings['level'] ?? 'A2',
      quizDirection: (settings['quizDirection'] as QuizDirection) ?? 'random',
      cardsPerRound: settings['cardsPerRound'] ?? '20',
      loaded: true,
    });
  },

  updateSetting: (db, key, value) => {
    dbSetSetting(db, key, value);
    set({ [key]: value });
  },

  resetApp: (db) => {
    clearAllData(db);
    const deviceLang = getDeviceNativeLanguage();
    dbSetSetting(db, 'nativeLanguage', deviceLang);
    set({
      nativeLanguage: deviceLang,
      learningLanguage: 'en',
      level: 'A2',
      quizDirection: 'random',
      cardsPerRound: '20',
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
    updateSetting: useCallback((key: string, value: string) => updateSetting(db, key, value), [db, updateSetting]),
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
    updateSetting: useCallback((key: string, value: string) => store.updateSetting(db, key, value), [db, store.updateSetting]),
    resetApp: useCallback(() => store.resetApp(db), [db, store.resetApp]),
  };
}

import { create } from 'zustand';
import { useSQLiteContext } from 'expo-sqlite';
import * as Localization from 'expo-localization';
import { getAllSettings, setSetting as dbSetSetting, clearAllSettings } from '../lib/database';
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

  loadSettings: () => void;
  _setFromDb: (settings: Record<string, string>) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  nativeLanguage: 'en',
  learningLanguage: 'en',
  level: 'A2',
  quizDirection: 'random',
  cardsPerRound: '20',
  loaded: false,

  loadSettings: () => {
    // This is a no-op placeholder; actual loading happens via the hook below
  },

  _setFromDb: (settings) =>
    set({
      nativeLanguage: settings['nativeLanguage'] ?? getDeviceNativeLanguage(),
      learningLanguage: settings['learningLanguage'] ?? 'en',
      level: settings['level'] ?? 'A2',
      quizDirection: (settings['quizDirection'] as QuizDirection) ?? 'random',
      cardsPerRound: settings['cardsPerRound'] ?? '20',
      loaded: true,
    }),
}));

/** Hook that provides settings actions bound to the current DB context */
export function useSettings() {
  const db = useSQLiteContext();
  const store = useSettingsStore();

  const loadSettings = async () => {
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

    store._setFromDb(settings);
  };

  const updateSetting = (key: string, value: string) => {
    dbSetSetting(db, key, value);
    useSettingsStore.setState({ [key]: value });
  };

  const resetApp = async () => {
    const { clearAllData } = await import('../lib/database');
    clearAllData(db);
    const deviceLang = getDeviceNativeLanguage();
    dbSetSetting(db, 'nativeLanguage', deviceLang);
    useSettingsStore.setState({
      nativeLanguage: deviceLang,
      learningLanguage: 'en',
      level: 'A2',
      quizDirection: 'random',
      cardsPerRound: '20',
    });
  };

  return {
    ...store,
    loadSettings,
    updateSetting,
    resetApp,
  };
}

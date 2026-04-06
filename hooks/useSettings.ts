import { create } from 'zustand';
import { useSQLiteContext } from 'expo-sqlite';
import { getAllSettings, setSetting as dbSetSetting, clearAllSettings } from '../lib/database';
import { languages } from '../constants/languages';

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
  nativeLanguage: 'de',
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
      nativeLanguage: settings['nativeLanguage'] ?? 'de',
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

    store._setFromDb(settings);
  };

  const updateSetting = (key: string, value: string) => {
    dbSetSetting(db, key, value);
    useSettingsStore.setState({ [key]: value });
  };

  const resetApp = async () => {
    const { clearAllData } = await import('../lib/database');
    clearAllData(db);
    useSettingsStore.setState({
      nativeLanguage: 'de',
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

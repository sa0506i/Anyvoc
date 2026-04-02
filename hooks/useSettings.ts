import { create } from 'zustand';
import { useSQLiteContext } from 'expo-sqlite';
import { getAllSettings, setSetting as dbSetSetting, clearAllSettings } from '../lib/database';
import type { ColorScheme } from '../constants/theme';

export type QuizDirection = 'native-to-learning' | 'learning-to-native' | 'random';

interface SettingsState {
  nativeLanguage: string;
  learningLanguage: string;
  level: string;
  quizDirection: QuizDirection;
  colorScheme: ColorScheme;
  loaded: boolean;

  loadSettings: () => void;
  _setFromDb: (settings: Record<string, string>) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  nativeLanguage: 'de',
  learningLanguage: 'en',
  level: 'A2',
  quizDirection: 'random',
  colorScheme: 'system',
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
      colorScheme: (settings['colorScheme'] as ColorScheme) ?? 'system',
      loaded: true,
    }),
}));

/** Hook that provides settings actions bound to the current DB context */
export function useSettings() {
  const db = useSQLiteContext();
  const store = useSettingsStore();

  const loadSettings = async () => {
    const settings = getAllSettings(db);
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
      colorScheme: 'system',
    });
  };

  return {
    ...store,
    loadSettings,
    updateSetting,
    resetApp,
  };
}

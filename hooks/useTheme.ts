import { useColorScheme } from 'react-native';
import { useSettingsStore } from './useSettings';
import {
  lightColors,
  darkColors,
  getLevelColors,
  getBoxColors,
} from '../constants/theme';

export function useTheme() {
  const systemScheme = useColorScheme();
  const colorScheme = useSettingsStore((s) => s.colorScheme);

  const resolvedScheme: 'light' | 'dark' =
    colorScheme === 'system'
      ? (systemScheme ?? 'dark')
      : colorScheme;

  const colors = resolvedScheme === 'dark' ? darkColors : lightColors;
  const levelColors = getLevelColors(colors);
  const boxColors = getBoxColors(colors);
  const isDark = resolvedScheme === 'dark';

  return { colors, levelColors, boxColors, isDark, resolvedScheme };
}

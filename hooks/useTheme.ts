import { darkColors, getLevelColors, getBoxColors } from '../constants/theme';

export function useTheme() {
  const colors = darkColors;
  const levelColors = getLevelColors(colors);
  const boxColors = getBoxColors(colors);

  return { colors, levelColors, boxColors, isDark: true as const, resolvedScheme: 'dark' as const };
}

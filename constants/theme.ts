export type ColorScheme = 'light' | 'dark' | 'system';

export interface ThemeColors {
  primary: string;
  primaryLight: string;
  background: string;
  backgroundMid: string;
  surface: string;
  glass: string;
  glassBorder: string;
  text: string;
  textSecondary: string;
  border: string;
  error: string;
  success: string;
  warning: string;
  highlight: string;

  levelA1: string;
  levelA2: string;
  levelB1: string;
  levelB2: string;
  levelC1: string;
  levelC2: string;

  box1: string;
  box2: string;
  box3: string;
  box4: string;
  box5: string;
}

const marineLightColors: ThemeColors = {
  primary: '#1E6FFF',
  primaryLight: 'rgba(30, 111, 255, 0.1)',
  background: '#F0F4FA',
  backgroundMid: '#E4EAF4',
  surface: '#FFFFFF',
  glass: 'rgba(255, 255, 255, 0.75)',
  glassBorder: 'rgba(30, 111, 255, 0.15)',
  text: '#0A1628',
  textSecondary: 'rgba(10, 22, 40, 0.55)',
  border: 'rgba(30, 111, 255, 0.1)',
  error: '#DC3545',
  success: '#0A8754',
  warning: '#D4860A',
  highlight: 'rgba(30, 111, 255, 0.15)',

  levelA1: '#2D7AE0',
  levelA2: '#3B8AF0',
  levelB1: '#4D94FF',
  levelB2: '#1E6FFF',
  levelC1: '#1557CC',
  levelC2: '#0D3F99',

  box1: '#1A4D99',
  box2: '#2260B3',
  box3: '#2D73CC',
  box4: '#3B8AE6',
  box5: '#4D9FFF',
};

const marineColors: ThemeColors = {
  primary: '#1E6FFF',
  primaryLight: 'rgba(30, 111, 255, 0.15)',
  background: '#050D1A',
  backgroundMid: '#0A1628',
  surface: '#0F1F3D',
  glass: 'rgba(15, 35, 80, 0.55)',
  glassBorder: 'rgba(100, 150, 255, 0.2)',
  text: '#EAF0FF',
  textSecondary: 'rgba(180, 200, 255, 0.65)',
  border: 'rgba(100, 150, 255, 0.12)',
  error: '#FF4D6A',
  success: '#4DFFB5',
  warning: '#FFB84D',
  highlight: 'rgba(30, 111, 255, 0.25)',

  levelA1: '#2D7AE0',
  levelA2: '#3B8AF0',
  levelB1: '#4D94FF',
  levelB2: '#6BA5FF',
  levelC1: '#8AB8FF',
  levelC2: '#A8CBFF',

  box1: '#1A4D99',
  box2: '#2260B3',
  box3: '#2D73CC',
  box4: '#3B8AE6',
  box5: '#4D9FFF',
};

export const lightColors: ThemeColors = marineLightColors;
export const darkColors: ThemeColors = marineColors;

// Default export for backward compat
export const colors = marineColors;

export function getLevelColors(theme: ThemeColors): Record<string, string> {
  return {
    A1: theme.levelA1,
    A2: theme.levelA2,
    B1: theme.levelB1,
    B2: theme.levelB2,
    C1: theme.levelC1,
    C2: theme.levelC2,
  };
}

export function getBoxColors(theme: ThemeColors): Record<number, string> {
  return {
    1: theme.box1,
    2: theme.box2,
    3: theme.box3,
    4: theme.box4,
    5: theme.box5,
  };
}

export const levelColors: Record<string, string> = getLevelColors(marineColors);
export const boxColors: Record<number, string> = getBoxColors(marineColors);

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 22,
  xxl: 28,
};

export const borderRadius = {
  sm: 12,
  md: 22,
  lg: 28,
  full: 9999,
};

export const glassStyle = {
  backgroundColor: 'rgba(15, 35, 80, 0.55)',
  borderWidth: 1,
  borderColor: 'rgba(100, 150, 255, 0.2)',
} as const;

export const marineShadow = {
  shadowColor: '#1E6FFF',
  shadowOpacity: 0.25,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: 8 },
  elevation: 8,
} as const;

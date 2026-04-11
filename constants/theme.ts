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
  textOnColor: string;
  border: string;
  error: string;
  success: string;
  warning: string;
  highlight: string;

  successBgLight: string;
  successBgMedium: string;
  errorBgLight: string;
  errorBgMedium: string;
  warningBgLight: string;
  warningBgMedium: string;
  overlay: string;
  subtleOverlay: string;
  borderSubtle: string;

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
  textOnColor: '#FFFFFF',
  border: 'rgba(100, 150, 255, 0.12)',
  error: '#FF4D6A',
  success: '#4DFFB5',
  warning: '#FFB84D',
  highlight: 'rgba(30, 111, 255, 0.25)',

  successBgLight: 'rgba(77, 255, 181, 0.2)',
  successBgMedium: 'rgba(77, 255, 181, 0.4)',
  errorBgLight: 'rgba(255, 77, 106, 0.2)',
  errorBgMedium: 'rgba(255, 77, 106, 0.4)',
  warningBgLight: 'rgba(255, 184, 77, 0.2)',
  warningBgMedium: 'rgba(255, 184, 77, 0.4)',
  overlay: 'rgba(5, 13, 26, 0.8)',
  subtleOverlay: 'rgba(255, 255, 255, 0.08)',
  borderSubtle: 'rgba(100, 150, 255, 0.15)',

  levelA1: '#2D7AE0',
  levelA2: '#3B8AF0',
  levelB1: '#4D94FF',
  levelB2: '#6BA5FF',
  // C1 and C2 share the same color because the UI collapses them to
  // a single "C" bucket (see constants/levels.ts `displayLevel`).
  levelC1: '#8AB8FF',
  levelC2: '#8AB8FF',

  box1: '#1A4D99',
  box2: '#2260B3',
  box3: '#2D73CC',
  box4: '#3B8AE6',
  box5: '#4D9FFF',
};

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

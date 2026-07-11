/**
 * React Native Paper (Material 3) theme mapped onto the Soteria dark-first
 * tokens. Rating & tier colors are NOT sourced from here — they stay semantic
 * and constant via src/theme/tokens.ts (Non-Negotiable #7). This only themes
 * Paper's chrome (surfaces, primary, text) to match the app.
 */
import { MD3DarkTheme } from 'react-native-paper';
import { surfaces, text, brand } from './tokens';

export const paperTheme = {
  ...MD3DarkTheme,
  dark: true,
  roundness: 3,
  colors: {
    ...MD3DarkTheme.colors,
    primary: brand.default,
    onPrimary: '#06121E',
    secondary: brand.default,
    // `contained-tonal` (our secondary Button) draws these — match the raised
    // surface token so it reads as the original secondary chrome, not MD3 teal.
    secondaryContainer: surfaces.raised,
    onSecondaryContainer: text.primary,
    background: surfaces.bg,
    surface: surfaces.surface,
    surfaceVariant: surfaces.raised,
    elevation: {
      ...MD3DarkTheme.colors.elevation,
      level0: surfaces.bg,
      level1: surfaces.surface,
      level2: surfaces.raised,
      level3: surfaces.raised,
    },
    onSurface: text.primary,
    onSurfaceVariant: text.dim,
    onBackground: text.primary,
    outline: surfaces.line,
    outlineVariant: surfaces.line,
    error: '#D9483B',
  },
};

export type PaperTheme = typeof paperTheme;

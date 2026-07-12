/**
 * React Native Paper (Material 3) themes mapped onto the Soteria palettes — one
 * per scheme. Rating & tier colors are NOT sourced from here; they stay semantic
 * and constant via src/theme/tokens.ts (Non-Negotiable #7). This only themes
 * Paper's chrome (surfaces, primary, text) to match the active palette.
 */
import { MD3DarkTheme, MD3LightTheme, type MD3Theme } from 'react-native-paper';
import { palettes, type ColorScheme, type Palette } from './tokens';

function build(base: MD3Theme, p: Palette): MD3Theme {
  return {
    ...base,
    roundness: 3,
    colors: {
      ...base.colors,
      primary: p.brand.accent,
      onPrimary: p.brand.onAccent,
      secondary: p.brand.accent,
      // `contained-tonal` (our secondary Button) draws these — match the raised
      // surface token so it reads as secondary chrome, not MD3's default tint.
      secondaryContainer: p.surfaces.raised,
      onSecondaryContainer: p.text.primary,
      background: p.surfaces.bg,
      surface: p.surfaces.surface,
      surfaceVariant: p.surfaces.raised,
      elevation: {
        ...base.colors.elevation,
        level0: p.surfaces.bg,
        level1: p.surfaces.surface,
        level2: p.surfaces.raised,
        level3: p.surfaces.raised,
      },
      onSurface: p.text.primary,
      onSurfaceVariant: p.text.dim,
      onBackground: p.text.primary,
      outline: p.surfaces.line,
      outlineVariant: p.surfaces.line,
      error: p.semantic.danger,
    },
  };
}

export const paperThemes: Record<ColorScheme, MD3Theme> = {
  dark: build(MD3DarkTheme, palettes.dark),
  light: build(MD3LightTheme, palettes.light),
};

/** Back-compat default (dark) for any importer of the old single theme. */
export const paperTheme = paperThemes.dark;
export type PaperTheme = MD3Theme;

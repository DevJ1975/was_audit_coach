/**
 * React Native Paper (Material 3) themes mapped onto the official WLS palettes —
 * one per scheme. Mirrors the kit's toPaperTheme() adapter. Rating & tier colors
 * are NOT sourced here; they stay semantic & constant via tokens.ts (NN #7).
 *
 * All Paper chrome uses Source Sans 3 via configureFonts (fonts loaded in
 * _layout.tsx). The app's own primitives (Title/Body/Mono) set weighted families
 * directly through the type ramp.
 */
import { MD3DarkTheme, MD3LightTheme, configureFonts, type MD3Theme } from 'react-native-paper';
import { palettes, layout, type ColorScheme, type Palette } from './tokens';

const fonts = configureFonts({ config: { fontFamily: 'SourceSans3-Regular' } });

function build(base: MD3Theme, p: Palette): MD3Theme {
  return {
    ...base,
    roundness: layout.radius,
    fonts,
    colors: {
      ...base.colors,
      primary: p.brand.accent,
      onPrimary: p.brand.onAccent,
      primaryContainer: p.brand.soft,
      onPrimaryContainer: p.brand.accent,
      secondary: p.brand.accent,
      // `contained-tonal` (our secondary Button) draws these — the raised surface.
      secondaryContainer: p.surfaces.raised,
      onSecondaryContainer: p.text.primary,
      background: p.surfaces.bg,
      surface: p.surfaces.surface,
      surfaceVariant: p.surfaces.raised,
      elevation: {
        ...base.colors.elevation,
        level0: p.surfaces.bg,
        level1: p.surfaces.surface,
        level2: p.surfaces.surface,
        level3: p.surfaces.raised,
        level4: p.surfaces.raised,
        level5: p.surfaces.raised,
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

/** Back-compat default (dark). */
export const paperTheme = paperThemes.dark;
export type PaperTheme = MD3Theme;

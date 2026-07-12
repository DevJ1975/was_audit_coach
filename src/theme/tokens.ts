/**
 * WLS Audit Coach design tokens — sourced from the official design-system kit
 * (assets/branding + the kit's react-native-theme.js). Dual-palette (light +
 * dark). DARK stays the field default (poorly-lit plant, gloves — NN #10).
 *
 * Rating & tier colors are SEMANTIC and CONSTANT (OSHA signal palette, NN #7):
 * they are NOT themeable brand tokens and never change per theme or tenant.
 * White-labeling overrides `brand` only.
 *
 * Brand accent = WLS red (#CE1F30 light / #E4576B dark) — the single main action
 * / danger. Rating reds (High / Very High) remain the risk signal, kept distinct.
 */
import type { Rating, Tier } from '@soteria/scoring-engine';

/** The shape every palette conforms to. Screens read this via useTheme(). */
export interface Palette {
  surfaces: { bg: string; surface: string; raised: string; sunken: string; line: string };
  text: { primary: string; dim: string; faint: string };
  /** `default` is a back-compat alias of `accent`. */
  brand: { accent: string; default: string; accentHover: string; onAccent: string; soft: string };
  semantic: { warn: string; danger: string; success: string };
}

// Mapped from the kit's lightTheme.colors / darkTheme.colors into the app seam.
const lightPalette: Palette = {
  surfaces: { bg: '#F7F7F8', surface: '#FFFFFF', raised: '#FFFFFF', sunken: '#F0F1F3', line: '#E4E6E9' },
  text: { primary: '#1E2023', dim: '#62666C', faint: '#83878D' },
  brand: { accent: '#CE1F30', default: '#CE1F30', accentHover: '#AE1123', onAccent: '#FFFFFF', soft: '#FCEDEE' },
  semantic: { warn: '#B45309', danger: '#CE1F30', success: '#1D8A50' },
};

const darkPalette: Palette = {
  surfaces: { bg: '#131417', surface: '#1E2023', raised: '#26282C', sunken: '#0D0E10', line: '#33363B' },
  text: { primary: '#F2F3F4', dim: '#ACB0B5', faint: '#83878D' },
  brand: { accent: '#E4576B', default: '#E4576B', accentHover: '#EB7284', onAccent: '#FFFFFF', soft: 'rgba(228,87,107,0.14)' },
  semantic: { warn: '#E8A317', danger: '#E4576B', success: '#3DBE7E' },
};

export type ColorScheme = 'dark' | 'light';
export const palettes: Record<ColorScheme, Palette> = { dark: darkPalette, light: lightPalette };

/**
 * Back-compat static exports resolve to the DARK palette (the field default).
 * Migrated screens/components read the ACTIVE palette from useTheme().
 */
export const surfaces = darkPalette.surfaces;
export const text = darkPalette.text;
export const brand = darkPalette.brand;
export const semantic = darkPalette.semantic;

/** CONSTANT across tenants AND themes (OSHA signal palette, NN #7). Do not theme. */
export const ratingColors: Record<Rating, string> = {
  'Best Practice': '#17B890',
  Verified: '#3CA96B',
  Low: '#E7C33B',
  Moderate: '#E58E2E',
  High: '#D9483B',
  'Very High': '#8F1D28',
  'Not Applicable': '#5F6E7D',
};

/** Contrast-checked (WCAG AA) label color to place ON a rating fill. CONSTANT. */
export const ratingOn: Record<Rating, string> = {
  'Best Practice': '#05231B',
  Verified: '#04180F',
  Low: '#2A2205',
  Moderate: '#241503',
  High: '#FFFFFF',
  'Very High': '#FFFFFF',
  'Not Applicable': '#EDF2F7',
};

/** CONSTANT across tenants AND themes. */
export const tierColors: Record<Tier, string> = {
  'Excellence Leader': '#17B890',
  Gold: '#D4A93C',
  Silver: '#A9B7C4',
  Bronze: '#B0793C',
  Developing: '#5F6E7D',
};

/** Corners from the kit: buttons/inputs 12, cards 16, dialogs 24. Tap target ≥48 (NN #10). */
export const layout = {
  minTapTarget: 48,
  radius: 12,
  radiusLg: 16,
  gap: 12,
} as const;

/** 4px spacing grid (kit spacing scale). Theme-independent. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Motion durations (ms) from the kit. Fades + small translates; no bounces. */
export const motion = { fast: 120, base: 200, slow: 320 } as const;

/**
 * Type ramp from the kit — Source Sans 3 (UI). Weight is carried by the family
 * name (each @expo-google-fonts weight is its own family); fonts are loaded in
 * src/app/_layout.tsx.
 */
export const typeRamp = {
  display: { fontFamily: 'SourceSans3-Bold', fontSize: 34, lineHeight: 40 },
  headline: { fontFamily: 'SourceSans3-Bold', fontSize: 26, lineHeight: 32 },
  title: { fontFamily: 'SourceSans3-SemiBold', fontSize: 20, lineHeight: 26 },
  titleSm: { fontFamily: 'SourceSans3-SemiBold', fontSize: 17, lineHeight: 22 },
  bodyLg: { fontFamily: 'SourceSans3-Regular', fontSize: 17, lineHeight: 24 },
  body: { fontFamily: 'SourceSans3-Regular', fontSize: 15, lineHeight: 22 },
  bodySm: { fontFamily: 'SourceSans3-Regular', fontSize: 13, lineHeight: 18 },
  label: { fontFamily: 'SourceSans3-SemiBold', fontSize: 13, lineHeight: 16, letterSpacing: 0.13 },
  caption: { fontFamily: 'SourceSans3-Regular', fontSize: 12, lineHeight: 16 },
  overline: { fontFamily: 'SourceSans3-Bold', fontSize: 11, lineHeight: 14, letterSpacing: 0.88, textTransform: 'uppercase' },
  data: { fontFamily: 'IBMPlexMono-Medium', fontSize: 15, lineHeight: 20 },
  dataLg: { fontFamily: 'IBMPlexMono-SemiBold', fontSize: 28, lineHeight: 32 },
} as const;

/** Font families for direct use (mono data cells, wordmark). */
export const typography = {
  sans: 'SourceSans3-Regular',
  sansSemibold: 'SourceSans3-SemiBold',
  sansBold: 'SourceSans3-Bold',
  mono: 'IBMPlexMono-Medium',
  tabularNums: { fontVariant: ['tabular-nums'] as const },
} as const;

export const tokens = {
  surfaces,
  text,
  brand,
  semantic,
  ratingColors,
  ratingOn,
  tierColors,
  layout,
  space,
  typeRamp,
  typography,
} as const;

export type Tokens = typeof tokens;

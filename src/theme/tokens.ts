/**
 * Soteria design tokens. Now dual-palette (light + dark). The auditor is often
 * in a poorly lit plant wearing gloves, so DARK stays the field default, but a
 * light theme is fully supported and selected at runtime via ThemeProvider.
 *
 * Rating & tier colors are SEMANTIC and CONSTANT across all tenants AND across
 * both themes (OSHA signal palette). White-labeling overrides `brand` ONLY —
 * never rating or tier colors. See Non-Negotiable #7.
 *
 * The WLS brand accent is RED. It is reserved for actions/identity (buttons,
 * links, focus, logo) and must never be read as the "High risk" rating red —
 * rating reds are used only for risk (dots, chips, finding borders).
 */

import type { Rating, Tier } from '@soteria/scoring-engine';

/** The shape every palette conforms to. Screens read this via useTheme(). */
export interface Palette {
  surfaces: { bg: string; surface: string; raised: string; line: string };
  text: { primary: string; dim: string; faint: string };
  /** `default` is a back-compat alias of `accent`. */
  brand: { accent: string; default: string; accentHover: string; onAccent: string; soft: string };
  semantic: { warn: string; danger: string; success: string };
}

const darkPalette: Palette = {
  surfaces: { bg: '#0E141B', surface: '#16202B', raised: '#1F2A37', line: '#2E3B49' },
  text: { primary: '#EDF2F7', dim: '#9FB0C0', faint: '#64748B' },
  brand: { accent: '#E1251B', default: '#E1251B', accentHover: '#F0463C', onAccent: '#FFFFFF', soft: '#33181A' },
  semantic: { warn: '#E7C33B', danger: '#D9483B', success: '#3CA96B' },
};

const lightPalette: Palette = {
  surfaces: { bg: '#F5F7FA', surface: '#FFFFFF', raised: '#EDF1F6', line: '#DCE3EB' },
  text: { primary: '#16202B', dim: '#47586A', faint: '#7C8C9B' },
  brand: { accent: '#D21F16', default: '#D21F16', accentHover: '#B71C13', onAccent: '#FFFFFF', soft: '#FCEBEA' },
  semantic: { warn: '#B7860A', danger: '#C4362A', success: '#2E8B57' },
};

export type ColorScheme = 'dark' | 'light';
export const palettes: Record<ColorScheme, Palette> = { dark: darkPalette, light: lightPalette };

/**
 * Back-compat static exports resolve to the DARK palette (the field default).
 * They keep not-yet-migrated modules compiling; migrated screens/components read
 * the ACTIVE palette from useTheme() instead. Do not add new usages of these.
 */
export const surfaces = darkPalette.surfaces;
export const text = darkPalette.text;
export const brand = darkPalette.brand;
export const semantic = darkPalette.semantic;

/** CONSTANT across tenants AND themes. Do not theme these. */
export const ratingColors: Record<Rating, string> = {
  'Best Practice': '#17B890',
  Verified: '#3CA96B',
  Low: '#E7C33B',
  Moderate: '#E58E2E',
  High: '#D9483B',
  'Very High': '#8F1D28',
  'Not Applicable': '#5F6E7D',
};

/**
 * The foreground/text color to place ON a rating fill, contrast-checked (WCAG AA)
 * so a filled chip label stays legible — white on the dark reds, near-black on
 * the light greens/ambers. CONSTANT across themes. Fixes the old single-color
 * label that was unreadable on "Very High" / "High".
 */
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

/** Layout constants driven by field-use constraints (gloves, glare). Theme-independent. */
export const layout = {
  /** Minimum tap target — Non-Negotiable #10. */
  minTapTarget: 48,
  radius: 12,
  radiusLg: 16,
  gap: 12,
} as const;

/** 8pt-based spacing scale. Theme-independent. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Typographic ramp — size / line-height / weight / tracking. Theme-independent. */
export const typeRamp = {
  title: { fontSize: 21, lineHeight: 27, fontWeight: '800', letterSpacing: 0.2 },
  label: { fontSize: 13, lineHeight: 16, fontWeight: '600', letterSpacing: 0.3 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
} as const;

/** Item codes and scores render in tabular monospace. Theme-independent. */
export const typography = {
  mono: 'Menlo, Consolas, "Roboto Mono", monospace',
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
  typography,
} as const;

export type Tokens = typeof tokens;

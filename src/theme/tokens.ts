/**
 * Soteria design tokens — dark-first (the auditor is in a poorly lit plant,
 * wearing gloves). Rating colors are SEMANTIC and CONSTANT across all tenants
 * (OSHA signal palette). White-labeling overrides `brand` ONLY — never rating
 * or tier colors. See Non-Negotiable #7.
 */

import type { Rating, Tier } from '@soteria/scoring-engine';

export const surfaces = {
  bg: '#0E141B',
  surface: '#17202B',
  raised: '#1F2A37',
  line: '#2C3947',
} as const;

export const text = {
  primary: '#EDF2F7',
  dim: '#9AA8B6',
  faint: '#5F6E7D',
} as const;

/** Tenant-overridable brand accent (default = Soteria blue). */
export const brand = {
  default: '#4FA3E3',
} as const;

/** CONSTANT across tenants. Do not theme these. */
export const ratingColors: Record<Rating, string> = {
  'Best Practice': '#17B890',
  Verified: '#3CA96B',
  Low: '#E7C33B',
  Moderate: '#E58E2E',
  High: '#D9483B',
  'Very High': '#8F1D28',
  'Not Applicable': '#5F6E7D',
};

/** CONSTANT across tenants. */
export const tierColors: Record<Tier, string> = {
  'Excellence Leader': '#17B890',
  Gold: '#D4A93C',
  Silver: '#A9B7C4',
  Bronze: '#B0793C',
  Developing: '#5F6E7D',
};

/** Layout constants driven by the field-use constraints (gloves, glare). */
export const layout = {
  /** Minimum tap target — Non-Negotiable #10. */
  minTapTarget: 48,
  radius: 12,
  radiusLg: 16,
  gap: 12,
} as const;

/** Item codes and scores render in tabular monospace. */
export const typography = {
  mono: 'Menlo, Consolas, "Roboto Mono", monospace',
  tabularNums: { fontVariant: ['tabular-nums'] as const },
} as const;

export const tokens = {
  surfaces,
  text,
  brand,
  ratingColors,
  tierColors,
  layout,
  typography,
} as const;

export type Tokens = typeof tokens;

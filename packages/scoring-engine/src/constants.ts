/**
 * Expert-calibrated scoring constants — a 1:1 port of the WLS_Audit_Coach_OSHA
 * workbook. These values are NOT to be "improved". Any change must keep the
 * §1.2 validation case green (98.6 / 160 / 61.625% / Bronze).
 */

export const RATINGS = [
  'Best Practice',
  'Verified',
  'Low',
  'Moderate',
  'High',
  'Very High',
  'Not Applicable',
] as const;

export type Rating = (typeof RATINGS)[number];

/** Ratings that constitute a finding (auto-populate the corrective-action queue). */
export const FINDING_RATINGS = ['Low', 'Moderate', 'High', 'Very High'] as const;
export type FindingRating = (typeof FINDING_RATINGS)[number];

/**
 * Rating → score multiplier.
 * Not Applicable is excluded entirely (see effectiveMax), so it has no
 * meaningful multiplier here; unrated items are handled separately.
 */
export const RATING_MULTIPLIER: Record<Rating, number> = {
  'Best Practice': 1.0,
  Verified: 1.0,
  Low: 0.85,
  Moderate: 0.7,
  High: 0.3,
  'Very High': 0.0,
  'Not Applicable': 0.0,
};

/**
 * Severity ordering for corrective-action / findings sort:
 * Very High → High → Moderate → Low. Higher number = sorts first.
 */
export const SEVERITY_ORDER: Record<FindingRating, number> = {
  'Very High': 4,
  High: 3,
  Moderate: 2,
  Low: 1,
};

export type Tier =
  | 'Excellence Leader'
  | 'Gold'
  | 'Silver'
  | 'Bronze'
  | 'Developing';

/** Tier thresholds keyed on the 0..1 fraction (not the percentage). */
export const TIER_THRESHOLDS: ReadonlyArray<{ min: number; tier: Tier }> = [
  { min: 0.99, tier: 'Excellence Leader' },
  { min: 0.9, tier: 'Gold' },
  { min: 0.8, tier: 'Silver' },
  { min: 0.51, tier: 'Bronze' },
  { min: -Infinity, tier: 'Developing' },
];

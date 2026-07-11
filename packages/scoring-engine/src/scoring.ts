/**
 * Soteria scoring engine — pure functions, no React Native / platform imports.
 * Shared verbatim between the on-device client and server (Edge Functions).
 *
 * Math (do NOT change — §1.2 of the phase plan):
 *   item_score    = round(max_points × multiplier, 1)
 *   effective_max = 0 if rating == "Not Applicable" else max_points
 *                   (an UNRATED item keeps its max in the denominator — an
 *                    unrated item is an incomplete audit, not an N/A)
 *   section_score = Σ item_score ÷ Σ effective_max   (null if denominator 0)
 *   overall       = Σ item_score ÷ Σ effective_max across all sections
 *   tier          = ≥0.99 Excellence Leader · ≥0.90 Gold · ≥0.80 Silver
 *                   · ≥0.51 Bronze · else Developing
 */

import {
  RATING_MULTIPLIER,
  TIER_THRESHOLDS,
  FINDING_RATINGS,
  SEVERITY_ORDER,
  type Rating,
  type Tier,
  type FindingRating,
} from './constants';

/** Round half-up to one decimal place, matching the workbook's ROUND(x, 1). */
export function round1(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

export interface ScorableItem {
  item_code: string;
  max_points: number;
  /** A rating, or null/undefined when the auditor has not rated the item yet. */
  rating?: Rating | null;
}

/** Points earned by a single item. Unrated and Very High both earn 0. */
export function itemScore(item: ScorableItem): number {
  if (item.rating == null || item.rating === 'Not Applicable') return 0;
  return round1(item.max_points * RATING_MULTIPLIER[item.rating]);
}

/**
 * Denominator contribution of a single item.
 * N/A → 0 (excluded). Unrated → keeps max_points (incomplete, not excluded).
 */
export function effectiveMax(item: ScorableItem): number {
  return item.rating === 'Not Applicable' ? 0 : item.max_points;
}

export interface SectionScore {
  /** Σ item_score across the section's non-N/A items. */
  rawScore: number;
  /** Σ effective_max across the section. */
  effectiveMax: number;
  /** rawScore / effectiveMax as a 0..1 fraction, or null when denominator is 0. */
  fraction: number | null;
  /** Convenience percentage (fraction × 100), or null. */
  percent: number | null;
  /** Tier for this section, or null when there is nothing scorable. */
  tier: Tier | null;
  /** Total items considered (excludes nothing — reporting counts). */
  itemCount: number;
  /** Items with a rating set (any of the 7, including N/A). */
  ratedCount: number;
}

export function scoreSection(items: ScorableItem[]): SectionScore {
  let rawScore = 0;
  let effMax = 0;
  let ratedCount = 0;

  for (const item of items) {
    rawScore += itemScore(item);
    effMax += effectiveMax(item);
    if (item.rating != null) ratedCount += 1;
  }

  rawScore = round1(rawScore);
  const fraction = effMax > 0 ? rawScore / effMax : null;

  return {
    rawScore,
    effectiveMax: effMax,
    fraction,
    percent: fraction === null ? null : fraction * 100,
    tier: fraction === null ? null : tierFor(fraction),
    itemCount: items.length,
    ratedCount,
  };
}

/** Map a 0..1 fraction to its tier. */
export function tierFor(fraction: number): Tier {
  for (const { min, tier } of TIER_THRESHOLDS) {
    if (fraction >= min) return tier;
  }
  return 'Developing';
}

export interface OverallScore extends SectionScore {
  sections: Record<string, SectionScore>;
}

/**
 * Overall audit score. Pools every item across sections into one
 * numerator/denominator — Σ all item_scores ÷ Σ all effective_maxes — which is
 * equivalent to summing each section's rawScore and effectiveMax.
 */
export function scoreAudit(
  itemsBySection: Record<string, ScorableItem[]>,
): OverallScore {
  const sections: Record<string, SectionScore> = {};
  let rawScore = 0;
  let effMax = 0;
  let itemCount = 0;
  let ratedCount = 0;

  for (const [code, items] of Object.entries(itemsBySection)) {
    const s = scoreSection(items);
    sections[code] = s;
    rawScore += s.rawScore;
    effMax += s.effectiveMax;
    itemCount += s.itemCount;
    ratedCount += s.ratedCount;
  }

  rawScore = round1(rawScore);
  const fraction = effMax > 0 ? rawScore / effMax : null;

  return {
    rawScore,
    effectiveMax: effMax,
    fraction,
    percent: fraction === null ? null : fraction * 100,
    tier: fraction === null ? null : tierFor(fraction),
    itemCount,
    ratedCount,
    sections,
  };
}

/** True when a rating constitutes a finding (Low, Moderate, High, Very High). */
export function isFinding(rating: Rating | null | undefined): rating is FindingRating {
  return rating != null && (FINDING_RATINGS as readonly string[]).includes(rating);
}

/**
 * Sort findings Very High → High → Moderate → Low (the CA queue order).
 * Stable within a severity (preserves input order — usually item_code order).
 */
export function sortFindingsBySeverity<T extends { rating: Rating }>(
  findings: T[],
): T[] {
  return [...findings]
    .map((f, i) => ({ f, i }))
    .sort((a, b) => {
      const sa = SEVERITY_ORDER[a.f.rating as FindingRating] ?? 0;
      const sb = SEVERITY_ORDER[b.f.rating as FindingRating] ?? 0;
      return sb - sa || a.i - b.i;
    })
    .map(({ f }) => f);
}

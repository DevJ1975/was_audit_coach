/**
 * Sync conflict policy (Phase 4) — pure, exhaustively testable. Applied by the
 * sync layer behind the repo seam.
 *
 * Rule (fixed by CLAUDE.md): last-write-wins PER FIELD, EXCEPT `rating`.
 * Divergent offline ratings on the same item are NEVER silently overwritten —
 * they flag `needs_resolution` for the lead auditor. Per-field timestamps come
 * from the immutable event log (the latest edit event per field), so "per field"
 * is real, not row-level.
 */
import type { Rating } from '@soteria/scoring-engine';

/** A value plus the ISO timestamp it was last written (from the event log). */
export interface Stamped<T> {
  value: T;
  at: string; // ISO-8601 — compares lexicographically
}

/** Last-write-wins for a single field. Tie → remote (server is canonical). */
export function lww<T>(local: Stamped<T>, remote: Stamped<T>): T {
  return remote.at >= local.at ? remote.value : local.value;
}

export interface RatingResolution {
  /** The rating to display now. On conflict we keep the local value but flag it. */
  rating: Rating | null;
  needsResolution: boolean;
  /** Both candidates, surfaced to the lead auditor when needsResolution. */
  candidates?: { local: Rating | null; remote: Rating | null };
}

/**
 * Resolve a rating conflict. `base` (the last-synced rating) lets us tell which
 * side actually changed; without it we fall back to "both non-null & differ =
 * conflict". We NEVER auto-pick between two genuine divergent ratings.
 */
export function resolveRating(
  local: Rating | null,
  remote: Rating | null,
  base?: Rating | null,
): RatingResolution {
  if (local === remote) return { rating: local, needsResolution: false };

  if (base !== undefined) {
    if (local === base) return { rating: remote, needsResolution: false }; // only remote changed
    if (remote === base) return { rating: local, needsResolution: false }; // only local changed
    return { rating: local, needsResolution: true, candidates: { local, remote } }; // both changed
  }

  // No base available: a side that never rated (null) yields to the one that did.
  if (local === null) return { rating: remote, needsResolution: false };
  if (remote === null) return { rating: local, needsResolution: false };
  return { rating: local, needsResolution: true, candidates: { local, remote } };
}

export type SyncState = 'local' | 'synced' | 'needs_resolution';

export interface MergeableItem {
  rating: Stamped<Rating | null>;
  observations: Stamped<string>;
  recommendations: Stamped<string>;
  auditor_notes: Stamped<string>;
  applicable: Stamped<boolean>;
  ai_generated: Stamped<boolean>;
}

export interface MergeResult {
  rating: Rating | null;
  observations: string;
  recommendations: string;
  auditor_notes: string;
  applicable: boolean;
  ai_generated: boolean;
  sync_state: SyncState;
  ratingCandidates?: { local: Rating | null; remote: Rating | null };
}

/**
 * Merge a local and remote version of one audit item. Text/flag fields use
 * per-field LWW; rating uses resolveRating. If the rating diverges the item is
 * marked `needs_resolution` (and the rating is left on the local value, never
 * silently replaced).
 */
export function mergeAuditItem(
  local: MergeableItem,
  remote: MergeableItem,
  baseRating?: Rating | null,
): MergeResult {
  const r = resolveRating(local.rating.value, remote.rating.value, baseRating);
  return {
    rating: r.rating,
    observations: lww(local.observations, remote.observations),
    recommendations: lww(local.recommendations, remote.recommendations),
    auditor_notes: lww(local.auditor_notes, remote.auditor_notes),
    applicable: lww(local.applicable, remote.applicable),
    ai_generated: lww(local.ai_generated, remote.ai_generated),
    sync_state: r.needsResolution ? 'needs_resolution' : 'synced',
    ratingCandidates: r.candidates,
  };
}

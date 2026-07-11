/**
 * Sync reconciliation core (Phase 4) — pure and testable. Given the local and
 * remote versions of a set of audit items (each carrying per-field timestamps),
 * decide what to write locally, what to push, and what conflicts to flag.
 *
 * Uses the conflict policy in src/domain/conflict.ts: per-field LWW, except a
 * divergent `rating` which flags needs_resolution and is never auto-overwritten.
 */
import { mergeAuditItem, type MergeableItem, type MergeResult } from '@/domain/conflict';

export interface SyncItem {
  /** Stable id shared across devices (server uuid). */
  id: string;
  audit_id: string;
  item_code: string;
  fields: MergeableItem;
}

export interface ReconcilePlan {
  /** Rows to write into the local store (from remote or a merge). */
  applyLocal: Array<{ id: string; merged: MergeResult }>;
  /** Rows to push to the remote (local is ahead, or a merge advanced it). */
  pushToRemote: Array<{ id: string; merged: MergeResult }>;
  /** Ids whose rating diverged — surfaced to the lead auditor, not auto-resolved. */
  conflicts: string[];
}

/** MergeableItem (stamped) → MergeResult (plain values) with an explicit state. */
function flatten(m: MergeableItem, sync_state: MergeResult['sync_state']): MergeResult {
  return {
    rating: m.rating.value,
    observations: m.observations.value,
    recommendations: m.recommendations.value,
    auditor_notes: m.auditor_notes.value,
    applicable: m.applicable.value,
    ai_generated: m.ai_generated.value,
    sync_state,
  };
}

const FIELDS = ['rating', 'observations', 'recommendations', 'auditor_notes', 'applicable', 'ai_generated'] as const;

/** True when the merged result differs from one side's current values. */
function differsFrom(merged: MergeResult, side: MergeableItem): boolean {
  return FIELDS.some((f) => merged[f] !== side[f].value);
}

export function reconcile(local: SyncItem[], remote: SyncItem[]): ReconcilePlan {
  const remoteById = new Map(remote.map((r) => [r.id, r]));
  const localIds = new Set(local.map((l) => l.id));
  const plan: ReconcilePlan = { applyLocal: [], pushToRemote: [], conflicts: [] };

  for (const l of local) {
    const r = remoteById.get(l.id);
    if (!r) {
      // Local-only row (created offline) → push as-is.
      plan.pushToRemote.push({ id: l.id, merged: flatten(l.fields, 'synced') });
      continue;
    }
    const merged = mergeAuditItem(l.fields, r.fields);
    const isConflict = merged.sync_state === 'needs_resolution';
    // Always write a conflict locally (to persist the needs_resolution flag), even
    // when the merged values equal the local ones.
    if (isConflict || differsFrom(merged, l.fields)) plan.applyLocal.push({ id: l.id, merged });
    // Don't push while a rating conflict is unresolved — never clobber the peer's rating.
    if (!isConflict && differsFrom(merged, r.fields)) {
      plan.pushToRemote.push({ id: l.id, merged });
    }
    if (isConflict) plan.conflicts.push(l.id);
  }

  // Remote-only rows (created on another device) → write locally.
  for (const r of remote) {
    if (!localIds.has(r.id)) plan.applyLocal.push({ id: r.id, merged: flatten(r.fields, 'synced') });
  }

  return plan;
}

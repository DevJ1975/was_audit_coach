/**
 * SyncEngine (Phase 4 transport) — orchestrates pull → reconcile → apply/push
 * behind the repo seam. It depends only on two ports: SyncLocal (a subset of the
 * repo) and RemoteAdapter (Supabase today, PowerSync-swappable later). The hard
 * part — the conflict policy — lives in reconcile.ts and is unit-tested; this
 * layer is the mechanical wiring and the pull cursor.
 *
 * Rating divergence is surfaced as needs_resolution locally and is never pushed
 * over a peer's rating (Non-Negotiable: never silently overwrite a rating).
 */
import type { AuditItem } from '@/db/types';
import type { Rating } from '@soteria/scoring-engine';
import { reconcile, type SyncItem } from './reconcile';
import type { MergeableItem, MergeResult } from '@/domain/conflict';
import { auditItemToRemote, type RemoteAdapter, type RemoteAuditItem } from './remote';

/** The slice of the repo the engine needs. The real Repo satisfies this. */
export interface SyncLocal {
  getAuditItems(audit_id: string): Promise<AuditItem[]>;
  applyMergedItems(items: AuditItem[]): Promise<void>;
}

export interface SyncSummary {
  auditId: string;
  skipped: boolean;
  pushed: number;
  appliedLocal: number;
  conflicts: string[];
  cursor: string | null;
}

/** Every field of a row shares the row-level updated_at stamp (row-level LWW). */
function stampAll(updated_at: string, item: {
  rating: Rating | null; observations: string; recommendations: string;
  auditor_notes: string; applicable: boolean; ai_generated: boolean;
}): MergeableItem {
  const s = <T>(value: T) => ({ value, at: updated_at });
  return {
    rating: s(item.rating),
    observations: s(item.observations),
    recommendations: s(item.recommendations),
    auditor_notes: s(item.auditor_notes),
    applicable: s(item.applicable),
    ai_generated: s(item.ai_generated),
  };
}

function localToSync(it: AuditItem): SyncItem {
  return {
    id: it.id, org_id: it.org_id, audit_id: it.audit_id,
    item_code: it.item_code, section_code: it.section_code,
    fields: stampAll(it.updated_at, it),
  };
}
function remoteToSync(r: RemoteAuditItem): SyncItem {
  return {
    id: r.id, org_id: r.org_id, audit_id: r.audit_id,
    item_code: r.item_code, section_code: r.section_code,
    fields: stampAll(r.updated_at, r),
  };
}

function maxIso(values: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const v of values) if (v && (best === null || v > best)) best = v;
  return best;
}

export class SyncEngine {
  private cursors = new Map<string, string | null>();

  constructor(
    private readonly local: SyncLocal,
    private readonly remote: RemoteAdapter,
    private readonly now: () => string,
  ) {}

  getCursor(auditId: string): string | null {
    return this.cursors.get(auditId) ?? null;
  }
  setCursor(auditId: string, cursor: string | null): void {
    this.cursors.set(auditId, cursor);
  }

  async syncAudit(auditId: string): Promise<SyncSummary> {
    if (!this.remote.isAvailable()) {
      return { auditId, skipped: true, pushed: 0, appliedLocal: 0, conflicts: [], cursor: this.getCursor(auditId) };
    }
    const since = this.getCursor(auditId);
    const [remoteRows, localRows] = await Promise.all([
      this.remote.pullAuditItems(auditId, since), // incremental: only rows changed since the cursor
      this.local.getAuditItems(auditId),
    ]);

    // Reconcile only the ACTIVE SET: rows in the remote delta, plus rows changed
    // locally since the last sync (never-synced 'local' rows, or edited since the
    // cursor). Synced-and-unchanged rows are already in agreement — including them
    // would make them look local-only against the incremental delta and re-push.
    const remoteById = new Map(remoteRows.map((r) => [r.id, r]));
    const localById = new Map(localRows.map((r) => [r.id, r]));
    const changedLocal = (r: AuditItem) => since === null || r.sync_state === 'local' || r.updated_at > since;

    const consider = new Set<string>();
    for (const r of remoteRows) consider.add(r.id);
    for (const r of localRows) if (changedLocal(r)) consider.add(r.id);

    const localSI = [...consider].filter((id) => localById.has(id)).map((id) => localToSync(localById.get(id)!));
    const remoteSI = remoteRows.map(remoteToSync);
    const meta = new Map<string, SyncItem>();
    for (const si of remoteSI) meta.set(si.id, si);
    for (const si of localSI) meta.set(si.id, si); // local metadata wins for shared ids

    const plan = reconcile(localSI, remoteSI);

    // Local writes: applied (merged/remote-won) rows keep the max contributing
    // stamp; pushed rows are marked synced at push time so they aren't re-pushed.
    const localWrites = new Map<string, AuditItem>();
    for (const { id, merged } of plan.applyLocal) {
      const si = meta.get(id);
      if (!si) continue;
      const at = maxIso([localById.get(id)?.updated_at, remoteById.get(id)?.updated_at]) ?? this.now();
      localWrites.set(id, this.build(si, merged, merged.sync_state, at));
    }

    const now = this.now();
    const pushRows: RemoteAuditItem[] = [];
    for (const { id, merged } of plan.pushToRemote) {
      const si = meta.get(id);
      if (!si) continue;
      const built = this.build(si, merged, 'synced', now);
      pushRows.push(auditItemToRemote(built, now)); // single projection — see remote.ts
      localWrites.set(id, built); // reflect the push locally
    }

    if (localWrites.size) await this.local.applyMergedItems([...localWrites.values()]);
    if (pushRows.length) await this.remote.upsertAuditItems(pushRows);

    const cursor = maxIso([since, ...remoteRows.map((r) => r.updated_at), pushRows.length ? now : null]);
    this.setCursor(auditId, cursor);

    return {
      auditId, skipped: false, pushed: pushRows.length, appliedLocal: plan.applyLocal.length,
      conflicts: plan.conflicts, cursor,
    };
  }

  private build(si: SyncItem, merged: MergeResult, sync_state: AuditItem['sync_state'], updated_at: string): AuditItem {
    return {
      id: si.id, org_id: si.org_id, audit_id: si.audit_id,
      item_code: si.item_code, section_code: si.section_code,
      applicable: merged.applicable, rating: merged.rating,
      observations: merged.observations, recommendations: merged.recommendations,
      auditor_notes: merged.auditor_notes, ai_generated: merged.ai_generated,
      sync_state,
      // Persist the PEER's candidate while conflicted so the lead auditor can
      // compare and resolve; cleared the moment the item stops being conflicted.
      conflict_rating: sync_state === 'needs_resolution' ? (merged.ratingCandidates?.remote ?? null) : null,
      updated_at,
    };
  }
}

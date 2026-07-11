/**
 * Sync wiring — assembles the SyncEngine + AttachmentSync with the Supabase
 * adapters and orchestrates a full per-audit sync (header, scoping answers,
 * items, events, evidence, corrective actions, disclosures). Kept behind the
 * seam; screens use the useSync / useCloudPull hooks, never this directly.
 *
 * The bundle is a per-repo singleton so the engine's pull cursor survives
 * screen remounts — a fresh engine per mount silently degraded every sync to a
 * full pull.
 */
import type { Repo } from '@/db/repo';
import type { Audit, ScopingAnswer } from '@/db/types';
import { nowIso } from '@/db/ids';
import { SyncEngine, type SyncSummary } from './engine';
import { AttachmentSync, type AttachmentSyncSummary } from './attachments';
import { createSupabaseRemote } from './supabaseRemote';
import { createSupabaseEvidence } from './supabaseEvidence';
import { loadForUpload } from '@/attachments/capture';
import type { RemoteAdapter, EvidenceRemote, RemoteAudit, RemoteScopingAnswer } from './remote';

export interface SyncBundle {
  engine: SyncEngine;
  remote: RemoteAdapter;
  evidence: EvidenceRemote;
  attachments: AttachmentSync;
}

const bundles = new WeakMap<Repo, SyncBundle>();

export function createSync(repo: Repo): SyncBundle {
  let b = bundles.get(repo);
  if (!b) {
    const remote = createSupabaseRemote();
    const evidence = createSupabaseEvidence();
    b = {
      remote,
      evidence,
      // Repo exposes getAuditItems + applyMergedItems, satisfying SyncLocal.
      engine: new SyncEngine(repo, remote, nowIso),
      // Repo also satisfies AttachmentLocal; capture.loadForUpload reads files.
      attachments: new AttachmentSync(repo, evidence, loadForUpload),
    };
    bundles.set(repo, b);
  }
  return b;
}

/** One error-message normalizer for every sync surface. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** ScopingAnswer and its wire shape are structurally identical — one mapper,
 *  used by both directions so push and pull can never drift apart. */
function scopingToRemote(a: ScopingAnswer): RemoteScopingAnswer {
  return { audit_id: a.audit_id, org_id: a.org_id, question_key: a.question_key, answer: a.answer };
}
function scopingToLocal(a: RemoteScopingAnswer): ScopingAnswer {
  return { audit_id: a.audit_id, org_id: a.org_id, question_key: a.question_key, answer: a.answer };
}

export interface FullSyncResult {
  /** True when the remote wasn't available (offline / signed out) — nothing
   *  ran. Distinct from success so the UI never renders silence as synced. */
  skipped: boolean;
  items: SyncSummary | null;
  evidence: AttachmentSyncSummary | null;
  eventsPushed: number;
  /** Up to the first three step failures, joined; null when every step landed. */
  error: string | null;
}

/**
 * Full sync for one audit. Steps are ordered for FK correctness on the server
 * (header → scoping/items → events/evidence → CAs, which may reference
 * evidence) and each step is individually guarded: one failing table never
 * blocks independent ones, and failures are surfaced instead of vanishing
 * (offline-first means deferred, never silent). `fatal` marks FK roots whose
 * failure makes the remaining steps pointless.
 */
export async function runFullSync(repo: Repo, auditId: string): Promise<FullSyncResult> {
  const { engine, remote, attachments } = createSync(repo);
  const result: FullSyncResult = { skipped: false, items: null, evidence: null, eventsPushed: 0, error: null };
  if (!remote.isAvailable()) {
    result.skipped = true;
    return result;
  }

  const errors: string[] = [];
  const step = async (fatal: boolean, run: () => Promise<void>): Promise<boolean> => {
    try {
      await run();
      return true;
    } catch (e) {
      errors.push(errorMessage(e));
      return !fatal;
    }
  };
  const finish = (): FullSyncResult => {
    if (errors.length) result.error = errors.slice(0, 3).join(' · ') + (errors.length > 3 ? ` (+${errors.length - 3} more)` : '');
    return result;
  };

  const audit = await repo.getAudit(auditId);
  if (audit) {
    // The header is the FK root — without it nothing else can land.
    const ok = await step(true, () =>
      remote.upsertAudit({
        id: audit.id, org_id: audit.org_id, title: audit.title, status: audit.status,
        privileged: audit.privileged, attorney_of_record: audit.attorney_of_record,
        state_plan: audit.state_plan, library_version_id: audit.library_version_id,
        updated_at: audit.updated_at,
      }),
    );
    if (!ok) return finish();

    await step(false, async () =>
      remote.upsertScopingAnswers((await repo.getScopingAnswers(auditId)).map(scopingToRemote)),
    );
  }

  // Items are the FK parent of events, attachments, and corrective actions.
  const itemsOk = await step(true, async () => {
    result.items = await engine.syncAudit(auditId);
  });
  if (!itemsOk) return finish();

  // Immutable event log — the analytics substrate and privilege trail (NN #6)
  // finally leaves the device. Push the unpushed delta; the server insert is
  // id-idempotent so a crash between insert and mark just re-sends.
  await step(false, async () => {
    const events = await repo.listUnpushedEvents(auditId);
    if (!events.length) return;
    await remote.insertEvents(
      events.map((e) => ({
        id: e.id, org_id: e.org_id, audit_id: e.audit_id, audit_item_id: e.audit_item_id,
        type: e.type, payload: e.payload, created_at: e.created_at,
      })),
    );
    await repo.markEventsPushed(events.map((e) => e.id));
    result.eventsPushed = events.length;
  });

  // Evidence before corrective actions: a closed CA may reference a closure
  // attachment (FK), so its metadata row must exist first.
  await step(false, async () => {
    result.evidence = await attachments.syncAttachments(auditId);
  });

  await step(false, async () =>
    remote.upsertCorrectiveActions(
      (await repo.listCorrectiveActions(auditId)).map((ca) => ({
        id: ca.id, org_id: ca.org_id, audit_id: ca.audit_id, audit_item_id: ca.audit_item_id,
        rating: ca.rating, assigned_to: ca.assigned_to, due_date: ca.due_date, status: ca.status,
        verified_by: ca.verified_by, close_date: ca.close_date,
        closure_evidence_attachment_id: ca.closure_evidence_attachment_id,
        created_at: ca.created_at, updated_at: ca.updated_at,
      })),
    ),
  );

  // Privilege trail — delta only (the log grows on every report view).
  await step(false, async () => {
    const rows = await repo.listUnpushedDisclosures(auditId);
    if (!rows.length) return;
    await remote.insertDisclosures(
      rows.map((d) => ({ id: d.id, org_id: d.org_id, audit_id: d.audit_id, action: d.action, created_at: d.created_at })),
    );
    await repo.markDisclosuresPushed(rows.map((d) => d.id));
  });

  return finish();
}

/** Map a pulled server audit header onto the local Audit shape. */
function toLocalAudit(r: RemoteAudit): Audit {
  return {
    id: r.id, org_id: r.org_id, facility_id: r.facility_id ?? null, title: r.title,
    status: r.status as Audit['status'], privileged: r.privileged,
    attorney_of_record: r.attorney_of_record, state_plan: r.state_plan,
    library_version_id: r.library_version_id,
    created_by: r.created_by ?? '', // server column is a nullable auth FK
    created_at: r.created_at ?? r.updated_at, updated_at: r.updated_at,
  };
}

export interface CloudPullResult {
  /** Audits discovered on the server and materialized locally. */
  added: number;
  error: string | null;
}

/** New-audit materializations run PULL_CONCURRENCY at a time — a reinstall
 *  with dozens of org audits shouldn't serialize 4+ round-trips per audit. */
const PULL_CONCURRENCY = 4;

/**
 * Discover audits that exist on the server but not on this device (created by
 * a teammate, or by this user before a reinstall) and materialize them locally:
 * header + scoping answers + items + evidence metadata. Known audits also get
 * their mutable header fields refreshed. Each audit is guarded independently —
 * one bad audit never blocks recovery of the rest, and `added` reports what
 * actually landed.
 */
export async function pullRemoteAudits(repo: Repo): Promise<CloudPullResult> {
  const { engine, remote, attachments } = createSync(repo);
  if (!remote.isAvailable()) return { added: 0, error: null };

  let headers: RemoteAudit[];
  try {
    headers = await remote.pullAudits();
  } catch (e) {
    return { added: 0, error: errorMessage(e) };
  }

  let added = 0;
  const errors: string[] = [];

  const fresh: RemoteAudit[] = [];
  for (const h of headers) {
    try {
      const known = await repo.getAudit(h.id);
      if (known) {
        // Refresh headers only when the server copy is newer — a local status/
        // title edit awaiting push must not be rolled back by a pull. (Both
        // sides are canonical 'Z'-form stamps; the adapter normalizes.)
        if (h.updated_at > known.updated_at) await repo.applyRemoteAudit(toLocalAudit(h));
      } else {
        fresh.push(h);
      }
    } catch (e) {
      errors.push(errorMessage(e));
    }
  }

  const materialize = async (h: RemoteAudit): Promise<void> => {
    try {
      await repo.applyRemoteAudit(toLocalAudit(h));
      const answers = await remote.pullScopingAnswers(h.id);
      await repo.applyScopingAnswers(h.id, answers.map(scopingToLocal));
      await engine.syncAudit(h.id); // materialize items
      await attachments.syncAttachments(h.id); // evidence metadata
      added++;
    } catch (e) {
      errors.push(errorMessage(e));
    }
  };
  for (let i = 0; i < fresh.length; i += PULL_CONCURRENCY) {
    await Promise.all(fresh.slice(i, i + PULL_CONCURRENCY).map(materialize));
  }

  return { added, error: errors.length ? errors.slice(0, 3).join(' · ') : null };
}

export { SyncEngine } from './engine';
export { AttachmentSync } from './attachments';
export type { SyncSummary, SyncLocal } from './engine';
export type { AttachmentSyncSummary } from './attachments';

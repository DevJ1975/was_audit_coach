/**
 * RemoteAdapter — the sync transport seam. The engine talks to this, never to
 * Supabase directly, so PowerSync (or another backend) could replace it later.
 */
import type { Rating } from '@soteria/scoring-engine';

export interface RemoteAuditItem {
  id: string;
  org_id: string;
  audit_id: string;
  item_code: string;
  section_code: string;
  applicable: boolean;
  rating: Rating | null;
  observations: string;
  recommendations: string;
  auditor_notes: string;
  ai_generated: boolean;
  updated_at: string;
}

export interface RemoteAudit {
  id: string;
  org_id: string;
  title: string;
  status: string;
  privileged: boolean;
  attorney_of_record: string | null;
  state_plan: string | null;
  library_version_id: string;
  /** Present on pulled rows; omitted on push (server defaults / keeps them). */
  facility_id?: string | null;
  created_by?: string | null;
  created_at?: string;
  updated_at: string;
}

/**
 * The ONE AuditItem → RemoteAuditItem projection. Both push paths (engine
 * reconcile and conflict-resolution push-through) must use it — two hand-kept
 * copies is how a newly synced column ends up silently dropped by one of them.
 */
export function auditItemToRemote(
  it: {
    id: string; org_id: string; audit_id: string; item_code: string; section_code: string;
    applicable: boolean; rating: Rating | null; observations: string; recommendations: string;
    auditor_notes: string; ai_generated: boolean;
  },
  updated_at: string,
): RemoteAuditItem {
  return {
    id: it.id, org_id: it.org_id, audit_id: it.audit_id,
    item_code: it.item_code, section_code: it.section_code,
    applicable: it.applicable, rating: it.rating,
    observations: it.observations, recommendations: it.recommendations,
    auditor_notes: it.auditor_notes, ai_generated: it.ai_generated,
    updated_at,
  };
}

/** Bytes + content type ready to PUT into Storage (produced by capture.ts). */
export interface EvidenceBlob {
  data: ArrayBuffer | Uint8Array | Blob;
  contentType: string;
}

/** An attachment metadata row as it lives on the server (path, not local uri). */
export interface RemoteAttachment {
  id: string;
  org_id: string;
  audit_item_id: string;
  kind: string;
  storage_path: string;
  transcription: string | null;
  created_at: string;
}

/**
 * EvidenceRemote — the Storage + attachment-metadata transport, kept separate
 * from RemoteAdapter so the CI-tested audit-item sync core is untouched. Every
 * call is tenant-scoped by RLS: the object path is prefixed with org_id and the
 * `evidence` bucket policy checks it against the caller's JWT org.
 */
export interface EvidenceRemote {
  isAvailable(): boolean;
  /** Attachment metadata rows for one audit (via the audit_items join). */
  pullAttachments(auditId: string): Promise<RemoteAttachment[]>;
  /** PUT the bytes at `path` (upsert — safe to retry a half-finished upload). */
  uploadEvidence(path: string, blob: EvidenceBlob): Promise<void>;
  /** Upsert attachment metadata rows (id-idempotent). */
  upsertAttachments(rows: RemoteAttachment[]): Promise<void>;
  /** Delete Storage objects by path (best-effort; missing objects are fine). */
  deleteEvidence(paths: string[]): Promise<void>;
  /** Delete attachment metadata rows by id. */
  deleteAttachments(ids: string[]): Promise<void>;
  /** A time-limited signed URL for viewing a private object, or null. */
  createSignedUrl(path: string, expiresInSec: number): Promise<string | null>;
}

/** An immutable event row as pushed to the server (actor stays local-only:
 *  the server column is a uuid FK to auth.users, and field-mode actor ids are
 *  not server identities — the payload still records what happened). */
export interface RemoteEvent {
  id: string;
  org_id: string;
  audit_id: string;
  audit_item_id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface RemoteScopingAnswer {
  audit_id: string;
  org_id: string;
  question_key: string;
  answer: boolean;
}

export interface RemoteCorrectiveAction {
  id: string;
  org_id: string;
  audit_id: string;
  audit_item_id: string;
  rating: string;
  assigned_to: string | null;
  due_date: string | null;
  status: string;
  verified_by: string | null;
  close_date: string | null;
  closure_evidence_attachment_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RemoteDisclosure {
  id: string;
  org_id: string;
  audit_id: string;
  action: 'view' | 'export';
  created_at: string;
}

export interface RemoteAdapter {
  /** True when a backend is configured AND a session exists. */
  isAvailable(): boolean;
  /** Audit items for an audit changed since `since` (null = full pull). */
  pullAuditItems(auditId: string, since: string | null): Promise<RemoteAuditItem[]>;
  /** Upsert merged/local-ahead audit items to the server. */
  upsertAuditItems(rows: RemoteAuditItem[]): Promise<void>;
  /** Upsert an audit header. */
  upsertAudit(audit: RemoteAudit): Promise<void>;
  /** All audit headers visible to this user's org (RLS-scoped). */
  pullAudits(): Promise<RemoteAudit[]>;
  /** Delete an audit server-side (children cascade via FKs). */
  deleteAudit(auditId: string): Promise<void>;
  /** Scoping answers for one audit. */
  pullScopingAnswers(auditId: string): Promise<RemoteScopingAnswer[]>;
  /** Upsert scoping answers (PK audit_id+question_key; idempotent). */
  upsertScopingAnswers(rows: RemoteScopingAnswer[]): Promise<void>;
  /** Upsert corrective actions (id-idempotent). */
  upsertCorrectiveActions(rows: RemoteCorrectiveAction[]): Promise<void>;
  /** Append disclosure-log entries (id-idempotent; the trail is insert-only). */
  insertDisclosures(rows: RemoteDisclosure[]): Promise<void>;
  /** Append immutable events (the server table is insert-only). */
  insertEvents(events: RemoteEvent[]): Promise<void>;
}

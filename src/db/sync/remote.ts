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
  updated_at: string;
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

export interface RemoteAdapter {
  /** True when a backend is configured and a session exists. */
  isAvailable(): boolean;
  /** Audit items for an audit changed since `since` (null = full pull). */
  pullAuditItems(auditId: string, since: string | null): Promise<RemoteAuditItem[]>;
  /** Upsert merged/local-ahead audit items to the server. */
  upsertAuditItems(rows: RemoteAuditItem[]): Promise<void>;
  /** Upsert an audit header. */
  upsertAudit(audit: RemoteAudit): Promise<void>;
  /** Append immutable events (the server table is insert-only). */
  insertEvents(
    events: Array<{
      id: string;
      org_id: string;
      audit_id: string;
      audit_item_id: string;
      type: string;
      payload: Record<string, unknown>;
      created_at: string;
    }>,
  ): Promise<void>;
}

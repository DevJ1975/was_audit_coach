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

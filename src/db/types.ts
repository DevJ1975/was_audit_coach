/**
 * Domain row types — the local (SQLite) shape mirrors the Supabase schema
 * (Part 3) so that Phase 4 sync is a transport concern, not a remodel. Every
 * tenant row carries `org_id`. Screens NEVER see these directly except through
 * the repo seam (Non-Negotiable #4).
 */
import type { Rating } from '@soteria/scoring-engine';

export type Role = 'admin' | 'lead_auditor' | 'auditor' | 'site_manager' | 'counsel_viewer';

export type AuditStatus = 'draft' | 'in_progress' | 'complete' | 'archived';

export type AttachmentKind = 'photo' | 'document' | 'voice';

/**
 * Upload state for an evidence file (Phase 2 → cloud). `local` = captured on
 * this device, not yet in Storage; `synced` = the bytes are in the tenant
 * `evidence` bucket and the metadata row is on the server. Removal of a synced
 * attachment is a tombstone (see `Attachment.deleted_at`) so the deletion can
 * propagate to Storage before the local row is purged — never a network block.
 */
export type AttachmentSyncState = 'local' | 'synced';

export type CAStatus = 'open' | 'in_progress' | 'verified' | 'closed';

/** Sync state for the per-item rating-conflict policy (Phase 4). */
export type ItemSyncState = 'local' | 'synced' | 'needs_resolution';

/** A library item as loaded from the seed (clean, no auditor input). */
export interface LibraryItem {
  item_code: string;
  section_code: string;
  subsection: string | null;
  requirement: string;
  evidence_protocol: string;
  max_points: number;
  citation: string;
  sif_potential: boolean;
  content_hash: string;
  /** For state-plan items only; null for the 286 federal items. */
  state?: string | null;
}

export interface Audit {
  id: string;
  org_id: string;
  facility_id: string | null;
  title: string;
  status: AuditStatus;
  privileged: boolean;
  attorney_of_record: string | null;
  state_plan: string | null;
  /** Library version frozen at creation — later library edits never change an audit. */
  library_version_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** The 15 process-inventory scoping answers, plus facility metadata. */
export interface ScopingAnswer {
  audit_id: string;
  org_id: string;
  question_key: string;
  answer: boolean;
}

/** An audit item = a library item instantiated into a specific audit. */
export interface AuditItem {
  id: string;
  org_id: string;
  audit_id: string;
  item_code: string;
  section_code: string;
  /** false when a scoping answer deactivated this item's group. */
  applicable: boolean;
  rating: Rating | null;
  observations: string;
  recommendations: string;
  auditor_notes: string;
  /** Set when the current observations/recommendations text was AI-drafted then accepted. */
  ai_generated: boolean;
  sync_state: ItemSyncState;
  /**
   * The PEER's rating while sync_state is 'needs_resolution' — surfaced so the
   * lead auditor sees both candidates and picks (conflict policy). Null when
   * not conflicted. Never rendered as the item's rating.
   */
  conflict_rating: Rating | null;
  updated_at: string;
}

/** Immutable event — the analytics substrate AND the privilege trail (NN #6). */
export type AuditEventType =
  | 'item_instantiated'
  | 'rating_set'
  | 'observations_edit'
  | 'recommendations_edit'
  | 'notes_edit'
  | 'attachment_added'
  | 'attachment_removed'
  | 'ai_draft_accepted'
  | 'applicability_changed';

export interface AuditItemEvent {
  id: string;
  org_id: string;
  audit_id: string;
  audit_item_id: string;
  type: AuditEventType;
  /** JSON-serializable payload, e.g. { from: 'High', to: 'Low' } for rating_set. */
  payload: Record<string, unknown>;
  actor_id: string;
  created_at: string;
}

export interface Attachment {
  id: string;
  org_id: string;
  audit_item_id: string;
  kind: AttachmentKind;
  /** Durable local file URI (offline capture). Empty once a row is only remote. */
  uri: string;
  /** Object path in the tenant `evidence` bucket; null until uploaded. */
  storage_path: string | null;
  /** Whether the bytes have reached Storage (see AttachmentSyncState). */
  sync_state: AttachmentSyncState;
  /**
   * Tombstone stamp. Set when a *synced* attachment is removed so the upload
   * pass can delete the Storage object + server row before purging the local
   * row. Null for live rows; tombstoned rows never appear in listAttachments.
   */
  deleted_at: string | null;
  transcription: string | null;
  created_at: string;
}

export interface CorrectiveAction {
  id: string;
  org_id: string;
  audit_id: string;
  audit_item_id: string;
  /** Denormalized for the CA surface / severity sort. */
  rating: Rating;
  assigned_to: string | null;
  due_date: string | null;
  status: CAStatus;
  verified_by: string | null;
  close_date: string | null;
  closure_evidence_attachment_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DisclosureLogEntry {
  id: string;
  org_id: string;
  audit_id: string;
  actor_id: string;
  action: 'view' | 'export';
  created_at: string;
}

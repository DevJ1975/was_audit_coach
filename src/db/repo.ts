/**
 * THE SEAM (Non-Negotiable #4). Screens depend on this interface ONLY. The
 * SQLite driver, and later the sync plumbing, live behind it and never leak
 * into a screen. Swappable implementations: `memoryRepo` (tests/dev/reference)
 * and, in Phase 0/1, an expo-sqlite implementation with the identical surface.
 *
 * INVARIANT: every state mutation also appends an immutable `audit_item_events`
 * row (Non-Negotiable #6). Implementations must uphold this — it is enforced in
 * the in-memory reference and asserted by the repo tests.
 */
import type {
  Attachment,
  AttachmentKind,
  Audit,
  AuditItem,
  AuditItemEvent,
  AuditStatus,
  CorrectiveAction,
  DisclosureLogEntry,
  LibraryItem,
  ScopingAnswer,
} from './types';
import type { Rating } from '@soteria/scoring-engine';
import type { ScopingQuestion } from '@/domain/applicability';

/** Ambient services injected into an implementation for determinism/testability. */
export interface RepoDeps {
  now: () => string; // ISO timestamp
  newId: () => string;
}

export interface CreateAuditInput {
  org_id: string;
  created_by: string;
  title: string;
  facility_id?: string | null;
  privileged: boolean;
  attorney_of_record?: string | null;
  state_plan?: string | null;
  library_version_id: string;
  /** question_key → yes/no. */
  answers: Record<string, boolean>;
}

/** Everything needed to instantiate an audit's items from the frozen library. */
export interface AuditLibraryContext {
  /** Federal + selected-state items for this audit's frozen library version. */
  library: LibraryItem[];
  questions: ScopingQuestion[];
}

export interface Repo {
  // --- Audits ---------------------------------------------------------------
  createAudit(input: CreateAuditInput, ctx: AuditLibraryContext): Promise<Audit>;
  getAudit(id: string): Promise<Audit | null>;
  listAudits(org_id: string): Promise<Audit[]>;
  setAuditStatus(id: string, status: AuditStatus, actor_id: string): Promise<void>;

  // --- Scoping --------------------------------------------------------------
  getScopingAnswers(audit_id: string): Promise<ScopingAnswer[]>;

  // --- Audit items (each mutation appends an event) -------------------------
  getAuditItems(audit_id: string): Promise<AuditItem[]>;
  getAuditItem(id: string): Promise<AuditItem | null>;
  setRating(audit_item_id: string, rating: Rating | null, actor_id: string): Promise<AuditItem>;
  setText(
    audit_item_id: string,
    field: 'observations' | 'recommendations' | 'auditor_notes',
    value: string,
    actor_id: string,
    opts?: { ai_generated?: boolean },
  ): Promise<AuditItem>;
  setApplicable(audit_item_id: string, applicable: boolean, actor_id: string): Promise<AuditItem>;

  // --- Events (read; append is internal to the mutations above) -------------
  listEvents(audit_item_id: string): Promise<AuditItemEvent[]>;

  // --- Sync plumbing (Phase 4; behind the seam) -----------------------------
  /**
   * Upsert full audit_item rows that arrived from sync (server or a merge).
   * Sets fields + sync_state directly and does NOT append per-field events —
   * these are reconciled writes, not auditor edits. Creates rows that don't
   * exist locally (items authored on another device).
   */
  applyMergedItems(items: AuditItem[]): Promise<void>;

  // --- Attachments ----------------------------------------------------------
  addAttachment(
    audit_item_id: string,
    kind: AttachmentKind,
    uri: string,
    actor_id: string,
    transcription?: string | null,
  ): Promise<Attachment>;
  /**
   * Remove an attachment. A never-uploaded ('local') row is deleted outright; a
   * 'synced' row is tombstoned (deleted_at set) so the upload pass can delete the
   * Storage object + server row before the local row is purged. Either way an
   * immutable `attachment_removed` event is appended (NN #6) and the row stops
   * appearing in listAttachments immediately (offline-first — no network wait).
   */
  removeAttachment(attachment_id: string, actor_id: string): Promise<void>;
  /** Live (non-tombstoned) attachments for an item, oldest first. */
  listAttachments(audit_item_id: string): Promise<Attachment[]>;

  // --- Attachment sync (Phase 4; driven by AttachmentSync behind the seam) ---
  /** Captured-but-not-yet-uploaded rows (sync_state 'local', not tombstoned). */
  listPendingUploads(): Promise<Attachment[]>;
  /** Mark a row uploaded: record its Storage path and flip it to 'synced'. */
  markAttachmentSynced(attachment_id: string, storage_path: string): Promise<void>;
  /** Tombstoned rows whose Storage object + server row still need deleting. */
  listPendingRemovals(): Promise<Attachment[]>;
  /** Hard-delete a tombstoned row once its remote copies are gone. */
  purgeAttachment(attachment_id: string): Promise<void>;

  // --- Corrective actions (auto-populated from findings) --------------------
  listCorrectiveActions(audit_id: string): Promise<CorrectiveAction[]>;
  upsertCorrectiveAction(ca: CorrectiveAction): Promise<CorrectiveAction>;

  // --- Disclosure log (privilege trail) -------------------------------------
  logDisclosure(entry: Omit<DisclosureLogEntry, 'id' | 'created_at'>): Promise<void>;
  listDisclosures(audit_id: string): Promise<DisclosureLogEntry[]>;
}

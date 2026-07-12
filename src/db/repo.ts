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
  ReportBrief,
  ReportBriefContent,
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

/** Input to persist a freshly generated (unaccepted) legal brief. */
export interface NewReportBrief {
  audit_id: string;
  org_id: string;
  content: ReportBriefContent;
  /** Which Claude model drafted it. */
  model: string;
  library_version_id: string;
}

export interface Repo {
  // --- Audits ---------------------------------------------------------------
  createAudit(input: CreateAuditInput, ctx: AuditLibraryContext): Promise<Audit>;
  getAudit(id: string): Promise<Audit | null>;
  listAudits(org_id: string): Promise<Audit[]>;
  setAuditStatus(id: string, status: AuditStatus, actor_id: string): Promise<void>;

  /**
   * Delete an audit and ALL its local children (items, events, attachments,
   * CAs, disclosures, scoping). Returns the local evidence file uris so the
   * caller can best-effort delete the files (the repo owns rows, not files).
   * Remote deletion is the caller's concern (sync layer) — server FKs cascade.
   */
  deleteAudit(id: string): Promise<{ evidenceUris: string[] }>;
  /** Every attachment row for an audit (incl. tombstones) — delete/cleanup use. */
  listAuditAttachments(audit_id: string): Promise<Attachment[]>;

  // --- Scoping --------------------------------------------------------------
  getScopingAnswers(audit_id: string): Promise<ScopingAnswer[]>;
  /**
   * Change one scoping answer AFTER creation (the auditor discovered a missed
   * process on the floor) and recompute item applicability from the full
   * answer set. Every flipped item logs applicability_changed (NN #6). The
   * frozen library context comes from the caller — the audit's library version
   * never changes.
   */
  updateScopingAnswer(
    audit_id: string,
    question_key: string,
    answer: boolean,
    actor_id: string,
    ctx: AuditLibraryContext,
  ): Promise<void>;

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
  /**
   * Resolve a divergent-rating conflict: the LEAD AUDITOR picked `rating` after
   * seeing both candidates. Sets the rating, clears conflict_rating, marks the
   * row 'local' (so the resolution pushes), and logs a rating_set event whose
   * payload records both candidates — the resolution is auditable (NN #6).
   */
  resolveRatingConflict(audit_item_id: string, rating: Rating | null, actor_id: string): Promise<AuditItem>;
  /** Events not yet appended to the server log, oldest first. */
  listUnpushedEvents(audit_id: string): Promise<AuditItemEvent[]>;
  /** Mark events as pushed (after a successful server append). */
  markEventsPushed(event_ids: string[]): Promise<void>;
  /** Upsert an audit header that arrived from the server (no events). */
  applyRemoteAudit(audit: Audit): Promise<void>;
  /** Replace scoping answers that arrived from the server (no events). */
  applyScopingAnswers(audit_id: string, answers: ScopingAnswer[]): Promise<void>;
  /**
   * Insert attachment metadata rows that arrived from sync for items on this
   * device. Rows already present locally (any state, incl. tombstones) are left
   * untouched; new rows carry an empty uri (bytes live in Storage; the UI
   * resolves a signed URL from storage_path). No events — sync, not an edit.
   */
  applyRemoteAttachments(rows: Attachment[]): Promise<void>;

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
  /**
   * Captured-but-not-yet-uploaded rows (sync_state 'local', not tombstoned)
   * whose PARENT ITEM has already reached the server (item sync_state is not
   * 'local'). The filter makes uploads FK-safe by construction — evidence for
   * a never-synced audit simply waits until that audit's items push, instead
   * of failing the attachments FK on every pass.
   */
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
  /** Disclosures not yet appended to the server log (the log grows per view —
   *  without a cursor every sync re-sends the whole history forever). */
  listUnpushedDisclosures(audit_id: string): Promise<DisclosureLogEntry[]>;
  markDisclosuresPushed(ids: string[]): Promise<void>;

  // --- Report briefs (document-scale legal-grade AI narrative; audit-level) --
  //
  // One brief per audit; the row id mirrors the audit id, so acceptance is an
  // upsert-in-place and every device converges on the same row. AI generation is
  // NOT persisted — a human accepts the (edited) draft, and only then does it
  // become a durable, syncable record (AI drafts; humans accept — NN #2). A
  // regenerate-then-discard therefore never destroys a previously accepted brief.
  /** The accepted brief for an audit, or null if none has been accepted. */
  getReportBrief(audit_id: string): Promise<ReportBrief | null>;
  /**
   * A human accepts the (possibly edited) brief: upserts the single per-audit
   * row with the final content, stamps accepted_by/accepted_at, marks it 'local'
   * so it pushes, and logs a `brief_accepted` disclosure.
   */
  saveReportBrief(input: NewReportBrief, actor_id: string): Promise<ReportBrief>;
  /** Accepted briefs not yet pushed to the server. */
  listUnpushedBriefs(audit_id: string): Promise<ReportBrief[]>;
  markBriefsPushed(ids: string[]): Promise<void>;
  /** Upsert briefs that arrived from the server (pull, not an edit — no disclosure). */
  applyRemoteBriefs(rows: ReportBrief[]): Promise<void>;
}

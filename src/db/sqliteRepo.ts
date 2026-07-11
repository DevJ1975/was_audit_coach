/**
 * expo-sqlite implementation of the Repo seam. Behaviourally identical to
 * `memoryRepo` (the reference spec): every state mutation also appends an
 * immutable audit_item_events row (Non-Negotiable #6), all inside a transaction.
 * Screens depend on the Repo interface only and never see this file.
 */
import type { DB } from './database';
import type {
  Attachment,
  AttachmentKind,
  Audit,
  AuditItem,
  AuditItemEvent,
  AuditEventType,
  AuditStatus,
  CorrectiveAction,
  DisclosureLogEntry,
  ScopingAnswer,
} from './types';
import type {
  Repo,
  CreateAuditInput,
  AuditLibraryContext,
} from './repo';
import type { Rating } from '@soteria/scoring-engine';
import { computeApplicableCodes } from '@/domain/applicability';
import { compareByCode } from '@/domain/ordering';
import { newId, nowIso } from './ids';

// --- Row <-> domain mappers ---------------------------------------------------
const bool = (n: number | null | undefined): boolean => n === 1;
const int = (b: boolean): number => (b ? 1 : 0);

interface AuditRow {
  id: string; org_id: string; facility_id: string | null; title: string;
  status: string; privileged: number; attorney_of_record: string | null;
  state_plan: string | null; library_version_id: string; created_by: string;
  created_at: string; updated_at: string;
}
function toAudit(r: AuditRow): Audit {
  return {
    id: r.id, org_id: r.org_id, facility_id: r.facility_id, title: r.title,
    status: r.status as AuditStatus, privileged: bool(r.privileged),
    attorney_of_record: r.attorney_of_record, state_plan: r.state_plan,
    library_version_id: r.library_version_id, created_by: r.created_by,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

interface ItemRow {
  id: string; org_id: string; audit_id: string; item_code: string;
  section_code: string; applicable: number; rating: string | null;
  observations: string; recommendations: string; auditor_notes: string;
  ai_generated: number; sync_state: string; conflict_rating: string | null;
  updated_at: string;
}
function toItem(r: ItemRow): AuditItem {
  return {
    id: r.id, org_id: r.org_id, audit_id: r.audit_id, item_code: r.item_code,
    section_code: r.section_code, applicable: bool(r.applicable),
    rating: (r.rating as Rating | null) ?? null,
    observations: r.observations, recommendations: r.recommendations,
    auditor_notes: r.auditor_notes, ai_generated: bool(r.ai_generated),
    sync_state: r.sync_state as AuditItem['sync_state'],
    conflict_rating: (r.conflict_rating as Rating | null) ?? null,
    updated_at: r.updated_at,
  };
}

interface AttachmentRow {
  id: string; org_id: string; audit_item_id: string; kind: string; uri: string;
  storage_path: string | null; sync_state: string; deleted_at: string | null;
  transcription: string | null; created_at: string;
}
function toAttachment(r: AttachmentRow): Attachment {
  return {
    id: r.id, org_id: r.org_id, audit_item_id: r.audit_item_id,
    kind: r.kind as AttachmentKind, uri: r.uri,
    storage_path: r.storage_path, sync_state: r.sync_state as Attachment['sync_state'],
    deleted_at: r.deleted_at, transcription: r.transcription, created_at: r.created_at,
  };
}

interface EventRow {
  id: string; org_id: string; audit_id: string; audit_item_id: string;
  type: string; payload: string; actor_id: string; created_at: string;
}
function toEvent(r: EventRow): AuditItemEvent {
  return {
    id: r.id, org_id: r.org_id, audit_id: r.audit_id, audit_item_id: r.audit_item_id,
    type: r.type as AuditEventType, payload: JSON.parse(r.payload) as Record<string, unknown>,
    actor_id: r.actor_id, created_at: r.created_at,
  };
}

export function createSqliteRepo(db: DB): Repo {
  async function insertEvent(
    item: Pick<AuditItem, 'id' | 'org_id' | 'audit_id'>,
    type: AuditEventType,
    payload: Record<string, unknown>,
    actor_id: string,
  ): Promise<void> {
    await db.runAsync(
      `INSERT INTO audit_item_events (id, org_id, audit_id, audit_item_id, type, payload, actor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId(), item.org_id, item.audit_id, item.id, type, JSON.stringify(payload), actor_id, nowIso()],
    );
  }

  async function requireItem(id: string): Promise<AuditItem> {
    const row = await db.getFirstAsync<ItemRow>('SELECT * FROM audit_items WHERE id = ?', [id]);
    if (!row) throw new Error(`audit_item not found: ${id}`);
    return toItem(row);
  }

  const TEXT_EVENT: Record<'observations' | 'recommendations' | 'auditor_notes', AuditEventType> = {
    observations: 'observations_edit',
    recommendations: 'recommendations_edit',
    auditor_notes: 'notes_edit',
  };

  return {
    async createAudit(input: CreateAuditInput, ctx: AuditLibraryContext): Promise<Audit> {
      const id = newId();
      const ts = nowIso();
      const audit: Audit = {
        id, org_id: input.org_id, facility_id: input.facility_id ?? null,
        title: input.title, status: 'in_progress', privileged: input.privileged,
        attorney_of_record: input.attorney_of_record ?? null,
        state_plan: input.state_plan ?? null, library_version_id: input.library_version_id,
        created_by: input.created_by, created_at: ts, updated_at: ts,
      };
      const applicable = computeApplicableCodes(ctx.library, ctx.questions, input.answers);
      const relevant = ctx.library.filter((li) => li.state == null || li.state === input.state_plan);

      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `INSERT INTO audits (id, org_id, facility_id, title, status, privileged, attorney_of_record, state_plan, library_version_id, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, audit.org_id, audit.facility_id, audit.title, audit.status, int(audit.privileged),
           audit.attorney_of_record, audit.state_plan, audit.library_version_id, audit.created_by, ts, ts],
        );
        for (const [question_key, answer] of Object.entries(input.answers)) {
          await db.runAsync(
            `INSERT OR REPLACE INTO scoping_answers (audit_id, org_id, question_key, answer) VALUES (?, ?, ?, ?)`,
            [id, audit.org_id, question_key, int(answer)],
          );
        }
        for (const li of relevant) {
          const itemId = newId();
          const isApplicable = applicable.has(li.item_code);
          await db.runAsync(
            `INSERT INTO audit_items (id, org_id, audit_id, item_code, section_code, applicable, rating, observations, recommendations, auditor_notes, ai_generated, sync_state, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL, '', '', '', 0, 'local', ?)`,
            [itemId, audit.org_id, id, li.item_code, li.section_code, int(isApplicable), ts],
          );
          await insertEvent(
            { id: itemId, org_id: audit.org_id, audit_id: id },
            'item_instantiated',
            { applicable: isApplicable },
            input.created_by,
          );
        }
      });
      return audit;
    },

    async getAudit(id) {
      const r = await db.getFirstAsync<AuditRow>('SELECT * FROM audits WHERE id = ?', [id]);
      return r ? toAudit(r) : null;
    },

    async listAudits(org_id) {
      const rows = await db.getAllAsync<AuditRow>(
        'SELECT * FROM audits WHERE org_id = ? ORDER BY created_at DESC', [org_id],
      );
      return rows.map(toAudit);
    },

    async setAuditStatus(id, status: AuditStatus, _actor_id) {
      await db.runAsync('UPDATE audits SET status = ?, updated_at = ? WHERE id = ?', [status, nowIso(), id]);
    },

    async deleteAudit(id) {
      const uriRows = await db.getAllAsync<{ uri: string }>(
        `SELECT a.uri FROM attachments a JOIN audit_items i ON i.id = a.audit_item_id
          WHERE i.audit_id = ? AND a.uri != ''`, [id],
      );
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          'DELETE FROM attachments WHERE audit_item_id IN (SELECT id FROM audit_items WHERE audit_id = ?)', [id],
        );
        await db.runAsync('DELETE FROM audit_item_events WHERE audit_id = ?', [id]);
        await db.runAsync('DELETE FROM corrective_actions WHERE audit_id = ?', [id]);
        await db.runAsync('DELETE FROM disclosure_log WHERE audit_id = ?', [id]);
        await db.runAsync('DELETE FROM audit_items WHERE audit_id = ?', [id]);
        await db.runAsync('DELETE FROM scoping_answers WHERE audit_id = ?', [id]);
        await db.runAsync('DELETE FROM audits WHERE id = ?', [id]);
      });
      return { evidenceUris: uriRows.map((r) => r.uri) };
    },

    async listAuditAttachments(audit_id) {
      const rows = await db.getAllAsync<AttachmentRow>(
        `SELECT a.* FROM attachments a JOIN audit_items i ON i.id = a.audit_item_id
          WHERE i.audit_id = ? ORDER BY a.created_at`, [audit_id],
      );
      return rows.map(toAttachment);
    },

    async getScopingAnswers(audit_id) {
      const rows = await db.getAllAsync<{ audit_id: string; org_id: string; question_key: string; answer: number }>(
        'SELECT * FROM scoping_answers WHERE audit_id = ?', [audit_id],
      );
      return rows.map<ScopingAnswer>((r) => ({
        audit_id: r.audit_id, org_id: r.org_id, question_key: r.question_key, answer: bool(r.answer),
      }));
    },

    async updateScopingAnswer(audit_id, question_key, answer, actor_id, ctx) {
      const audit = await db.getFirstAsync<AuditRow>('SELECT * FROM audits WHERE id = ?', [audit_id]);
      if (!audit) throw new Error(`audit not found: ${audit_id}`);
      const ts = nowIso();
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `INSERT OR REPLACE INTO scoping_answers (audit_id, org_id, question_key, answer) VALUES (?, ?, ?, ?)`,
          [audit_id, audit.org_id, question_key, int(answer)],
        );
        // Recompute applicability from the FULL answer set; flip only the
        // deltas so each change is an auditable applicability_changed event.
        const rows = await db.getAllAsync<{ question_key: string; answer: number }>(
          'SELECT question_key, answer FROM scoping_answers WHERE audit_id = ?', [audit_id],
        );
        const answerMap = Object.fromEntries(rows.map((r) => [r.question_key, bool(r.answer)]));
        const applicable = computeApplicableCodes(ctx.library, ctx.questions, answerMap);
        // Narrow projection: 374 rows of free-text narrative are not needed
        // to diff a boolean.
        const itemRows = await db.getAllAsync<{ id: string; org_id: string; audit_id: string; item_code: string; applicable: number }>(
          'SELECT id, org_id, audit_id, item_code, applicable FROM audit_items WHERE audit_id = ?', [audit_id],
        );
        for (const r of itemRows) {
          const should = applicable.has(r.item_code);
          if (bool(r.applicable) !== should) {
            await db.runAsync(
              "UPDATE audit_items SET applicable = ?, sync_state = CASE sync_state WHEN 'synced' THEN 'local' ELSE sync_state END, updated_at = ? WHERE id = ?",
              [int(should), ts, r.id],
            );
            await insertEvent({ id: r.id, org_id: r.org_id, audit_id: r.audit_id }, 'applicability_changed', { applicable: should, via: question_key }, actor_id);
          }
        }
      });
    },

    async getAuditItems(audit_id) {
      const rows = await db.getAllAsync<ItemRow>(
        'SELECT * FROM audit_items WHERE audit_id = ?', [audit_id],
      );
      // Sort in JS with the shared comparator (numeric-aware, identical to
      // memoryRepo) rather than SQL's lexicographic ORDER BY.
      return rows.map(toItem).sort(compareByCode);
    },

    async getAuditItem(id) {
      const r = await db.getFirstAsync<ItemRow>('SELECT * FROM audit_items WHERE id = ?', [id]);
      return r ? toItem(r) : null;
    },

    async setRating(audit_item_id, rating: Rating | null, actor_id) {
      const before = await requireItem(audit_item_id);
      const ts = nowIso();
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          "UPDATE audit_items SET rating = ?, sync_state = CASE sync_state WHEN 'synced' THEN 'local' ELSE sync_state END, updated_at = ? WHERE id = ?",
          [rating, ts, audit_item_id],
        );
        await insertEvent(before, 'rating_set', { from: before.rating, to: rating }, actor_id);
      });
      return requireItem(audit_item_id);
    },

    async setText(audit_item_id, field, value, actor_id, opts) {
      const before = await requireItem(audit_item_id);
      const ts = nowIso();
      const aiGenerated = field !== 'auditor_notes' ? !!opts?.ai_generated : before.ai_generated;
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `UPDATE audit_items SET ${field} = ?, ai_generated = ?, sync_state = CASE sync_state WHEN 'synced' THEN 'local' ELSE sync_state END, updated_at = ? WHERE id = ?`,
          [value, int(aiGenerated), ts, audit_item_id],
        );
        await insertEvent(before, TEXT_EVENT[field], { length: value.length, ai_generated: !!opts?.ai_generated }, actor_id);
        if (field !== 'auditor_notes' && opts?.ai_generated) {
          await insertEvent(before, 'ai_draft_accepted', { field }, actor_id);
        }
      });
      return requireItem(audit_item_id);
    },

    async setApplicable(audit_item_id, applicable, actor_id) {
      const before = await requireItem(audit_item_id);
      if (before.applicable === applicable) return before;
      const ts = nowIso();
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          "UPDATE audit_items SET applicable = ?, sync_state = CASE sync_state WHEN 'synced' THEN 'local' ELSE sync_state END, updated_at = ? WHERE id = ?",
          [int(applicable), ts, audit_item_id],
        );
        await insertEvent(before, 'applicability_changed', { applicable }, actor_id);
      });
      return requireItem(audit_item_id);
    },

    async listEvents(audit_item_id) {
      const rows = await db.getAllAsync<EventRow>(
        'SELECT * FROM audit_item_events WHERE audit_item_id = ? ORDER BY created_at', [audit_item_id],
      );
      return rows.map(toEvent);
    },

    async applyMergedItems(rows) {
      await db.withTransactionAsync(async () => {
        for (const r of rows) {
          await db.runAsync(
            `INSERT INTO audit_items (id, org_id, audit_id, item_code, section_code, applicable, rating, observations, recommendations, auditor_notes, ai_generated, sync_state, conflict_rating, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET applicable=excluded.applicable, rating=excluded.rating,
               observations=excluded.observations, recommendations=excluded.recommendations,
               auditor_notes=excluded.auditor_notes, ai_generated=excluded.ai_generated,
               sync_state=excluded.sync_state, conflict_rating=excluded.conflict_rating,
               updated_at=excluded.updated_at`,
            [r.id, r.org_id, r.audit_id, r.item_code, r.section_code, int(r.applicable), r.rating,
             r.observations, r.recommendations, r.auditor_notes, int(r.ai_generated), r.sync_state,
             r.conflict_rating, r.updated_at],
          );
        }
      });
    },

    async resolveRatingConflict(audit_item_id, rating: Rating | null, actor_id) {
      const before = await requireItem(audit_item_id);
      const candidates = { local: before.rating, remote: before.conflict_rating };
      const ts = nowIso();
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `UPDATE audit_items SET rating = ?, conflict_rating = NULL, sync_state = 'local', updated_at = ? WHERE id = ?`,
          [rating, ts, audit_item_id],
        );
        await insertEvent(before, 'rating_set', { from: candidates.local, to: rating, resolution: true, candidates }, actor_id);
      });
      return requireItem(audit_item_id);
    },

    async listUnpushedEvents(audit_id) {
      const rows = await db.getAllAsync<EventRow>(
        'SELECT * FROM audit_item_events WHERE audit_id = ? AND pushed = 0 ORDER BY created_at', [audit_id],
      );
      return rows.map(toEvent);
    },

    async markEventsPushed(event_ids) {
      if (event_ids.length === 0) return;
      // SQLite parameter limit is 999 — chunk defensively (a long offline
      // stretch on a 374-item audit can accumulate thousands of events).
      for (let i = 0; i < event_ids.length; i += 500) {
        const chunk = event_ids.slice(i, i + 500);
        await db.runAsync(
          `UPDATE audit_item_events SET pushed = 1 WHERE id IN (${chunk.map(() => '?').join(',')})`,
          chunk,
        );
      }
    },

    async applyRemoteAudit(audit) {
      await db.runAsync(
        `INSERT INTO audits (id, org_id, facility_id, title, status, privileged, attorney_of_record, state_plan, library_version_id, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, status=excluded.status,
           privileged=excluded.privileged, attorney_of_record=excluded.attorney_of_record,
           state_plan=excluded.state_plan, facility_id=excluded.facility_id,
           updated_at=excluded.updated_at`,
        [audit.id, audit.org_id, audit.facility_id, audit.title, audit.status, int(audit.privileged),
         audit.attorney_of_record, audit.state_plan, audit.library_version_id, audit.created_by,
         audit.created_at, audit.updated_at],
      );
    },

    async applyScopingAnswers(audit_id, answers) {
      await db.withTransactionAsync(async () => {
        // Full replace — a stale local ghost row would silently distort the
        // applicability recompute (the inverted SCOPE rows make a ghost 'No'
        // activate whole groups).
        await db.runAsync('DELETE FROM scoping_answers WHERE audit_id = ?', [audit_id]);
        for (const a of answers) {
          await db.runAsync(
            `INSERT INTO scoping_answers (audit_id, org_id, question_key, answer) VALUES (?, ?, ?, ?)`,
            [audit_id, a.org_id, a.question_key, int(a.answer)],
          );
        }
      });
    },

    async applyRemoteAttachments(rows) {
      await db.withTransactionAsync(async () => {
        for (const r of rows) {
          // INSERT OR IGNORE: rows already known locally — including tombstones
          // awaiting remote deletion — must not be resurrected or overwritten.
          await db.runAsync(
            `INSERT OR IGNORE INTO attachments (id, org_id, audit_item_id, kind, uri, storage_path, sync_state, deleted_at, transcription, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [r.id, r.org_id, r.audit_item_id, r.kind, r.uri, r.storage_path, r.sync_state,
             r.deleted_at, r.transcription, r.created_at],
          );
        }
      });
    },

    async addAttachment(audit_item_id, kind: AttachmentKind, uri, actor_id, transcription) {
      const item = await requireItem(audit_item_id);
      const att: Attachment = {
        id: newId(), org_id: item.org_id, audit_item_id, kind, uri,
        storage_path: null, sync_state: 'local', deleted_at: null,
        transcription: transcription ?? null, created_at: nowIso(),
      };
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `INSERT INTO attachments (id, org_id, audit_item_id, kind, uri, storage_path, sync_state, deleted_at, transcription, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [att.id, att.org_id, att.audit_item_id, att.kind, att.uri,
           att.storage_path, att.sync_state, att.deleted_at, att.transcription, att.created_at],
        );
        await insertEvent(item, 'attachment_added', { attachment_id: att.id, kind }, actor_id);
      });
      return att;
    },

    async removeAttachment(attachment_id, actor_id) {
      const att = await db.getFirstAsync<{ audit_item_id: string; kind: string; sync_state: string; deleted_at: string | null }>(
        'SELECT audit_item_id, kind, sync_state, deleted_at FROM attachments WHERE id = ?', [attachment_id],
      );
      if (!att || att.deleted_at) return;
      const item = await db.getFirstAsync<ItemRow>('SELECT * FROM audit_items WHERE id = ?', [att.audit_item_id]);
      await db.withTransactionAsync(async () => {
        // Synced rows tombstone (the upload pass deletes the Storage object +
        // server row, then purges); never-uploaded rows have no remote copy.
        if (att.sync_state === 'synced') {
          await db.runAsync('UPDATE attachments SET deleted_at = ? WHERE id = ?', [nowIso(), attachment_id]);
        } else {
          await db.runAsync('DELETE FROM attachments WHERE id = ?', [attachment_id]);
        }
        if (item) await insertEvent(toItem(item), 'attachment_removed', { attachment_id, kind: att.kind }, actor_id);
      });
    },

    async listAttachments(audit_item_id) {
      const rows = await db.getAllAsync<AttachmentRow>(
        'SELECT * FROM attachments WHERE audit_item_id = ? AND deleted_at IS NULL ORDER BY created_at', [audit_item_id],
      );
      return rows.map(toAttachment);
    },

    async listPendingUploads() {
      // Parent row must exist server-side (item pushed, or conflicted — which
      // implies a server row) or the attachments FK rejects the metadata.
      const rows = await db.getAllAsync<AttachmentRow>(
        `SELECT a.* FROM attachments a
           JOIN audit_items i ON i.id = a.audit_item_id
          WHERE a.sync_state = 'local' AND a.deleted_at IS NULL AND i.sync_state != 'local'
          ORDER BY a.created_at`,
      );
      return rows.map(toAttachment);
    },

    async markAttachmentSynced(attachment_id, storage_path) {
      await db.runAsync(
        "UPDATE attachments SET sync_state = 'synced', storage_path = ? WHERE id = ?", [storage_path, attachment_id],
      );
    },

    async listPendingRemovals() {
      const rows = await db.getAllAsync<AttachmentRow>(
        'SELECT * FROM attachments WHERE deleted_at IS NOT NULL ORDER BY created_at',
      );
      return rows.map(toAttachment);
    },

    async purgeAttachment(attachment_id) {
      await db.runAsync('DELETE FROM attachments WHERE id = ?', [attachment_id]);
    },

    async listCorrectiveActions(audit_id) {
      const rows = await db.getAllAsync<CorrectiveAction & { status: string; rating: string }>(
        'SELECT * FROM corrective_actions WHERE audit_id = ?', [audit_id],
      );
      return rows.map((r) => ({ ...r, rating: r.rating as Rating, status: r.status as CorrectiveAction['status'] }));
    },

    async upsertCorrectiveAction(ca: CorrectiveAction) {
      const ts = nowIso();
      await db.runAsync(
        `INSERT INTO corrective_actions (id, org_id, audit_id, audit_item_id, rating, assigned_to, due_date, status, verified_by, close_date, closure_evidence_attachment_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET rating=excluded.rating, assigned_to=excluded.assigned_to, due_date=excluded.due_date,
           status=excluded.status, verified_by=excluded.verified_by, close_date=excluded.close_date,
           closure_evidence_attachment_id=excluded.closure_evidence_attachment_id, updated_at=excluded.updated_at`,
        [ca.id, ca.org_id, ca.audit_id, ca.audit_item_id, ca.rating, ca.assigned_to, ca.due_date, ca.status,
         ca.verified_by, ca.close_date, ca.closure_evidence_attachment_id, ca.created_at, ts],
      );
      return { ...ca, updated_at: ts };
    },

    async logDisclosure(entry) {
      await db.runAsync(
        `INSERT INTO disclosure_log (id, org_id, audit_id, actor_id, action, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [newId(), entry.org_id, entry.audit_id, entry.actor_id, entry.action, nowIso()],
      );
    },

    async listUnpushedDisclosures(audit_id) {
      const rows = await db.getAllAsync<DisclosureLogEntry & { action: string }>(
        'SELECT * FROM disclosure_log WHERE audit_id = ? AND pushed = 0 ORDER BY created_at', [audit_id],
      );
      return rows.map((r) => ({ ...r, action: r.action as DisclosureLogEntry['action'] }));
    },

    async markDisclosuresPushed(ids) {
      if (ids.length === 0) return;
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        await db.runAsync(
          `UPDATE disclosure_log SET pushed = 1 WHERE id IN (${chunk.map(() => '?').join(',')})`,
          chunk,
        );
      }
    },

    async listDisclosures(audit_id) {
      const rows = await db.getAllAsync<DisclosureLogEntry & { action: string }>(
        'SELECT * FROM disclosure_log WHERE audit_id = ? ORDER BY created_at', [audit_id],
      );
      return rows.map((r) => ({ ...r, action: r.action as DisclosureLogEntry['action'] }));
    },
  };
}

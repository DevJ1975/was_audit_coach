/**
 * In-memory reference implementation of the Repo seam. Used by tests and as the
 * canonical behaviour spec for the expo-sqlite implementation: same surface,
 * same event-log invariant, same conflict-free single-device semantics.
 *
 * Deliberately dependency-free (no SQLite, no platform) so audit-loop logic is
 * verifiable in pure Node today, before the Expo scaffold exists.
 */
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
  ReportBrief,
  ScopingAnswer,
} from './types';
import type {
  Repo,
  RepoDeps,
  CreateAuditInput,
  AuditLibraryContext,
  NewReportBrief,
} from './repo';
import type { Rating } from '@soteria/scoring-engine';
import { computeApplicableCodes } from '@/domain/applicability';
import { compareByCode } from '@/domain/ordering';

export function createMemoryRepo(deps: RepoDeps): Repo {
  const audits = new Map<string, Audit>();
  const scoping = new Map<string, ScopingAnswer[]>(); // audit_id →
  const items = new Map<string, AuditItem>(); // audit_item_id →
  const events: AuditItemEvent[] = [];
  const pushedEventIds = new Set<string>(); // storage-level push cursors
  const pushedDisclosureIds = new Set<string>();
  const attachments = new Map<string, Attachment>();
  const cas = new Map<string, CorrectiveAction>();
  const disclosures: DisclosureLogEntry[] = [];
  const reportBriefs = new Map<string, ReportBrief>(); // audit_id → one current brief
  const pushedBriefIds = new Set<string>();

  function appendEvent(
    item: AuditItem,
    type: AuditEventType,
    payload: Record<string, unknown>,
    actor_id: string,
  ): void {
    events.push({
      id: deps.newId(),
      org_id: item.org_id,
      audit_id: item.audit_id,
      audit_item_id: item.id,
      type,
      payload,
      actor_id,
      created_at: deps.now(),
    });
  }

  function requireItem(id: string): AuditItem {
    const it = items.get(id);
    if (!it) throw new Error(`audit_item not found: ${id}`);
    return it;
  }

  return {
    async createAudit(input: CreateAuditInput, ctx: AuditLibraryContext): Promise<Audit> {
      const id = deps.newId();
      const ts = deps.now();
      const audit: Audit = {
        id,
        org_id: input.org_id,
        facility_id: input.facility_id ?? null,
        title: input.title,
        status: 'in_progress',
        privileged: input.privileged,
        attorney_of_record: input.attorney_of_record ?? null,
        state_plan: input.state_plan ?? null,
        library_version_id: input.library_version_id,
        created_by: input.created_by,
        created_at: ts,
        updated_at: ts,
      };
      audits.set(id, audit);

      scoping.set(
        id,
        Object.entries(input.answers).map(([question_key, answer]) => ({
          audit_id: id,
          org_id: input.org_id,
          question_key,
          answer,
        })),
      );

      // Instantiate audit_items with applicability computed from the answers.
      // State-plan items are included only for the audit's selected state plan.
      const applicable = computeApplicableCodes(ctx.library, ctx.questions, input.answers);
      const relevant = ctx.library.filter(
        (li) => li.state == null || li.state === input.state_plan,
      );
      for (const li of relevant) {
        const itemId = deps.newId();
        const ai: AuditItem = {
          id: itemId,
          org_id: input.org_id,
          audit_id: id,
          item_code: li.item_code,
          section_code: li.section_code,
          applicable: applicable.has(li.item_code),
          rating: null,
          observations: '',
          recommendations: '',
          auditor_notes: '',
          ai_generated: false,
          sync_state: 'local',
          conflict_rating: null,
          updated_at: ts,
        };
        items.set(itemId, ai);
        appendEvent(ai, 'item_instantiated', { applicable: ai.applicable }, input.created_by);
      }
      return audit;
    },

    async getAudit(id) {
      return audits.get(id) ?? null;
    },

    async listAudits(org_id) {
      return [...audits.values()].filter((a) => a.org_id === org_id);
    },

    async setAuditStatus(id, status: AuditStatus, _actor_id) {
      const a = audits.get(id);
      if (!a) throw new Error(`audit not found: ${id}`);
      a.status = status;
      a.updated_at = deps.now();
    },

    async deleteAudit(id) {
      const itemIds = new Set([...items.values()].filter((i) => i.audit_id === id).map((i) => i.id));
      const evidenceUris: string[] = [];
      for (const [aid, a] of [...attachments]) {
        if (itemIds.has(a.audit_item_id)) {
          if (a.uri) evidenceUris.push(a.uri);
          attachments.delete(aid);
        }
      }
      for (const iid of itemIds) items.delete(iid);
      for (let i = events.length - 1; i >= 0; i--) if (events[i]!.audit_id === id) events.splice(i, 1);
      for (const [cid, ca] of [...cas]) if (ca.audit_id === id) cas.delete(cid);
      for (let i = disclosures.length - 1; i >= 0; i--) if (disclosures[i]!.audit_id === id) disclosures.splice(i, 1);
      for (const [bid, b] of [...reportBriefs]) if (b.audit_id === id) reportBriefs.delete(bid);
      scoping.delete(id);
      audits.delete(id);
      return { evidenceUris };
    },

    async listAuditAttachments(audit_id) {
      const itemIds = new Set([...items.values()].filter((i) => i.audit_id === audit_id).map((i) => i.id));
      return [...attachments.values()].filter((a) => itemIds.has(a.audit_item_id));
    },

    async getScopingAnswers(audit_id) {
      return scoping.get(audit_id) ?? [];
    },

    async updateScopingAnswer(audit_id, question_key, answer, actor_id, ctx) {
      const audit = audits.get(audit_id);
      if (!audit) throw new Error(`audit not found: ${audit_id}`);
      const current = scoping.get(audit_id) ?? [];
      const next = current.some((a) => a.question_key === question_key)
        ? current.map((a) => (a.question_key === question_key ? { ...a, answer } : a))
        : [...current, { audit_id, org_id: audit.org_id, question_key, answer }];
      scoping.set(audit_id, next);

      // Recompute applicability from the FULL answer set; flip only the deltas
      // so each change is an auditable applicability_changed event.
      const answerMap = Object.fromEntries(next.map((a) => [a.question_key, a.answer]));
      const applicable = computeApplicableCodes(ctx.library, ctx.questions, answerMap);
      for (const it of items.values()) {
        if (it.audit_id !== audit_id) continue;
        const should = applicable.has(it.item_code);
        if (it.applicable !== should) {
          it.applicable = should;
          if (it.sync_state === 'synced') it.sync_state = 'local';
          it.updated_at = deps.now();
          appendEvent(it, 'applicability_changed', { applicable: should, via: question_key }, actor_id);
        }
      }
    },

    async getAuditItems(audit_id) {
      return [...items.values()].filter((it) => it.audit_id === audit_id).sort(compareByCode);
    },

    async getAuditItem(id) {
      return items.get(id) ?? null;
    },

    async setRating(audit_item_id, rating: Rating | null, actor_id) {
      const it = requireItem(audit_item_id);
      const from = it.rating;
      it.rating = rating;
      if (it.sync_state === 'synced') it.sync_state = 'local'; // dirty — clock-independent push eligibility
      it.updated_at = deps.now();
      appendEvent(it, 'rating_set', { from, to: rating }, actor_id);
      return it;
    },

    async setText(audit_item_id, field, value, actor_id, opts) {
      const it = requireItem(audit_item_id);
      it[field] = value;
      if (it.sync_state === 'synced') it.sync_state = 'local';
      it.updated_at = deps.now();
      const type: AuditEventType =
        field === 'observations'
          ? 'observations_edit'
          : field === 'recommendations'
            ? 'recommendations_edit'
            : 'notes_edit';
      appendEvent(it, type, { length: value.length, ai_generated: !!opts?.ai_generated }, actor_id);
      // ai_generated tracks whether the CURRENT obs/rec text was AI-drafted then
      // accepted. Notes are auditor-only and never flip the flag.
      if (field !== 'auditor_notes') {
        it.ai_generated = !!opts?.ai_generated;
        if (opts?.ai_generated) appendEvent(it, 'ai_draft_accepted', { field }, actor_id);
      }
      return it;
    },

    async setApplicable(audit_item_id, applicable, actor_id) {
      const it = requireItem(audit_item_id);
      if (it.applicable !== applicable) {
        it.applicable = applicable;
        if (it.sync_state === 'synced') it.sync_state = 'local';
        it.updated_at = deps.now();
        appendEvent(it, 'applicability_changed', { applicable }, actor_id);
      }
      return it;
    },

    async listEvents(audit_item_id) {
      return events.filter((e) => e.audit_item_id === audit_item_id);
    },

    async applyMergedItems(rows) {
      for (const row of rows) items.set(row.id, { ...row });
    },

    async resolveRatingConflict(audit_item_id, rating: Rating | null, actor_id) {
      const it = requireItem(audit_item_id);
      const candidates = { local: it.rating, remote: it.conflict_rating };
      it.rating = rating;
      it.conflict_rating = null;
      it.sync_state = 'local'; // the resolution is a fresh local write → pushes
      it.updated_at = deps.now();
      appendEvent(it, 'rating_set', { from: candidates.local, to: rating, resolution: true, candidates }, actor_id);
      return it;
    },

    async listUnpushedEvents(audit_id) {
      return events.filter((e) => e.audit_id === audit_id && !pushedEventIds.has(e.id));
    },

    async markEventsPushed(event_ids) {
      for (const id of event_ids) pushedEventIds.add(id);
    },

    async applyRemoteAudit(audit) {
      const prev = audits.get(audit.id);
      // library_version_id / created_by / created_at are frozen at creation —
      // a header refresh updates the mutable fields only.
      audits.set(
        audit.id,
        prev
          ? { ...audit, library_version_id: prev.library_version_id, created_by: prev.created_by, created_at: prev.created_at }
          : { ...audit },
      );
    },

    async applyScopingAnswers(audit_id, answers) {
      scoping.set(audit_id, answers.map((a) => ({ ...a })));
    },

    async applyRemoteAttachments(rows) {
      for (const row of rows) {
        if (!attachments.has(row.id)) attachments.set(row.id, { ...row });
      }
    },

    async addAttachment(audit_item_id, kind: AttachmentKind, uri, actor_id, transcription) {
      const it = requireItem(audit_item_id);
      const att: Attachment = {
        id: deps.newId(),
        org_id: it.org_id,
        audit_item_id,
        kind,
        uri,
        storage_path: null,
        sync_state: 'local',
        deleted_at: null,
        transcription: transcription ?? null,
        created_at: deps.now(),
      };
      attachments.set(att.id, att);
      appendEvent(it, 'attachment_added', { attachment_id: att.id, kind }, actor_id);
      return att;
    },

    async removeAttachment(attachment_id, actor_id) {
      const att = attachments.get(attachment_id);
      if (!att || att.deleted_at) return;
      // A synced row is tombstoned so its Storage object + server row can be
      // deleted before the local row is purged; a never-uploaded row has no
      // remote copy, so it goes immediately.
      if (att.sync_state === 'synced') {
        attachments.set(attachment_id, { ...att, deleted_at: deps.now() });
      } else {
        attachments.delete(attachment_id);
      }
      const it = items.get(att.audit_item_id);
      if (it) appendEvent(it, 'attachment_removed', { attachment_id, kind: att.kind }, actor_id);
    },

    async listAttachments(audit_item_id) {
      return [...attachments.values()].filter((a) => a.audit_item_id === audit_item_id && !a.deleted_at);
    },

    async listPendingUploads() {
      return [...attachments.values()].filter((a) => {
        if (a.sync_state !== 'local' || a.deleted_at) return false;
        return items.get(a.audit_item_id)?.sync_state !== 'local'; // parent row exists server-side
      });
    },

    async markAttachmentSynced(attachment_id, storage_path) {
      const att = attachments.get(attachment_id);
      if (att) attachments.set(attachment_id, { ...att, sync_state: 'synced', storage_path });
    },

    async listPendingRemovals() {
      return [...attachments.values()].filter((a) => a.deleted_at != null);
    },

    async purgeAttachment(attachment_id) {
      attachments.delete(attachment_id);
    },

    async listCorrectiveActions(audit_id) {
      return [...cas.values()].filter((c) => c.audit_id === audit_id);
    },

    async upsertCorrectiveAction(ca: CorrectiveAction) {
      cas.set(ca.id, { ...ca, updated_at: deps.now() });
      return cas.get(ca.id)!;
    },

    async logDisclosure(entry) {
      disclosures.push({ ...entry, id: deps.newId(), created_at: deps.now() });
    },

    async listUnpushedDisclosures(audit_id) {
      return disclosures.filter((d) => d.audit_id === audit_id && !pushedDisclosureIds.has(d.id));
    },

    async markDisclosuresPushed(ids) {
      for (const id of ids) pushedDisclosureIds.add(id);
    },

    async listDisclosures(audit_id) {
      return disclosures.filter((d) => d.audit_id === audit_id);
    },

    async getReportBrief(audit_id) {
      // Keyed by audit_id (row id mirrors it); only accepted briefs are stored.
      return reportBriefs.get(audit_id) ?? null;
    },

    async saveReportBrief(input: NewReportBrief, actor_id) {
      const ts = deps.now();
      const prev = reportBriefs.get(input.audit_id);
      const brief: ReportBrief = {
        id: input.audit_id, // one brief per audit; id mirrors the audit id
        org_id: input.org_id,
        audit_id: input.audit_id,
        content: input.content,
        model: input.model,
        library_version_id: input.library_version_id,
        generated_at: prev?.generated_at ?? ts,
        generated_by: prev?.generated_by ?? actor_id,
        accepted_by: actor_id,
        accepted_at: ts,
        ai_generated: true,
        sync_state: 'local',
        updated_at: ts,
      };
      reportBriefs.set(brief.id, brief);
      pushedBriefIds.delete(brief.id); // re-arm the push cursor
      disclosures.push({
        id: deps.newId(), org_id: input.org_id, audit_id: input.audit_id,
        actor_id, action: 'brief_accepted', created_at: ts,
      });
      return brief;
    },

    async listUnpushedBriefs(audit_id) {
      // Only accepted briefs are ever stored, so all are eligible.
      return [...reportBriefs.values()].filter(
        (b) => b.audit_id === audit_id && !pushedBriefIds.has(b.id),
      );
    },

    async markBriefsPushed(ids) {
      for (const id of ids) pushedBriefIds.add(id);
    },

    async applyRemoteBriefs(rows) {
      for (const row of rows) reportBriefs.set(row.id, { ...row });
    },
  };
}

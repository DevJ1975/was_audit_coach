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
  ScopingAnswer,
} from './types';
import type {
  Repo,
  RepoDeps,
  CreateAuditInput,
  AuditLibraryContext,
} from './repo';
import type { Rating } from '@soteria/scoring-engine';
import { computeApplicableCodes } from '@/domain/applicability';
import { compareByCode } from '@/domain/ordering';

export function createMemoryRepo(deps: RepoDeps): Repo {
  const audits = new Map<string, Audit>();
  const scoping = new Map<string, ScopingAnswer[]>(); // audit_id →
  const items = new Map<string, AuditItem>(); // audit_item_id →
  const events: AuditItemEvent[] = [];
  const attachments = new Map<string, Attachment>();
  const cas = new Map<string, CorrectiveAction>();
  const disclosures: DisclosureLogEntry[] = [];

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

    async getScopingAnswers(audit_id) {
      return scoping.get(audit_id) ?? [];
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
      it.updated_at = deps.now();
      appendEvent(it, 'rating_set', { from, to: rating }, actor_id);
      return it;
    },

    async setText(audit_item_id, field, value, actor_id, opts) {
      const it = requireItem(audit_item_id);
      it[field] = value;
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

    async addAttachment(audit_item_id, kind: AttachmentKind, uri, actor_id, transcription) {
      const it = requireItem(audit_item_id);
      const att: Attachment = {
        id: deps.newId(),
        org_id: it.org_id,
        audit_item_id,
        kind,
        uri,
        transcription: transcription ?? null,
        created_at: deps.now(),
      };
      attachments.set(att.id, att);
      appendEvent(it, 'attachment_added', { attachment_id: att.id, kind }, actor_id);
      return att;
    },

    async removeAttachment(attachment_id, actor_id) {
      const att = attachments.get(attachment_id);
      if (!att) return;
      attachments.delete(attachment_id);
      const it = items.get(att.audit_item_id);
      if (it) appendEvent(it, 'attachment_removed', { attachment_id, kind: att.kind }, actor_id);
    },

    async listAttachments(audit_item_id) {
      return [...attachments.values()].filter((a) => a.audit_item_id === audit_item_id);
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

    async listDisclosures(audit_id) {
      return disclosures.filter((d) => d.audit_id === audit_id);
    },
  };
}

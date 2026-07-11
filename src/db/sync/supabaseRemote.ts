/**
 * Supabase implementation of RemoteAdapter. RLS enforces tenant isolation on the
 * server, so these calls only ever touch the caller's org rows.
 *
 * NOTE: the server stores a row-level `updated_at`, so this adapter stamps all of
 * a row's fields with that single timestamp (row-level LWW). The reconcile core
 * supports true per-field LWW when richer stamps are supplied (e.g. derived from
 * the local event log) — that refinement plugs in without changing this seam.
 *
 * Not exercised in CI (needs a live backend + auth); typechecked only. Verify on
 * device against an applied schema.
 */
import { getSupabase, hasSession } from '@/db/supabase';
import type {
  RemoteAdapter,
  RemoteAuditItem,
  RemoteAudit,
  RemoteEvent,
  RemoteScopingAnswer,
  RemoteCorrectiveAction,
  RemoteDisclosure,
} from './remote';

/**
 * Normalize a server timestamp to the app's canonical ISO form. Postgres
 * returns '2026-07-11T12:00:00.123456+00:00'; local stamps are nowIso()'s
 * '...Z' with milliseconds. The app compares stamps LEXICOGRAPHICALLY (LWW,
 * cursors), and across the two formats that comparison misorders — '+' sorts
 * below '0'..'9' — so every pulled timestamp is converted at this boundary and
 * only 'Z'-form strings ever circulate. Millisecond truncation is safe: a
 * cursor that is microseconds early only re-pulls boundary rows, and
 * reconcile is idempotent.
 */
function isoZ(ts: string): string {
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? ts : new Date(ms).toISOString();
}

export function createSupabaseRemote(): RemoteAdapter {
  return {
    isAvailable() {
      // Configured AND signed in — anon pushes only bounce off RLS/grants.
      return getSupabase() != null && hasSession();
    },

    async pullAuditItems(auditId, since) {
      const supabase = getSupabase();
      if (!supabase) return [];
      let query = supabase.from('audit_items').select('*').eq('audit_id', auditId);
      if (since) query = query.gt('updated_at', since);
      const { data, error } = await query;
      if (error) throw new Error(`pullAuditItems: ${error.message}`);
      return ((data ?? []) as RemoteAuditItem[]).map((r) => ({ ...r, updated_at: isoZ(r.updated_at) }));
    },

    async upsertAuditItems(rows) {
      if (rows.length === 0) return;
      const supabase = getSupabase();
      if (!supabase) return;
      const { error } = await supabase.from('audit_items').upsert(rows, { onConflict: 'id' });
      if (error) throw new Error(`upsertAuditItems: ${error.message}`);
    },

    async upsertAudit(audit: RemoteAudit) {
      const supabase = getSupabase();
      if (!supabase) return;
      const { error } = await supabase.from('audits').upsert(audit, { onConflict: 'id' });
      if (error) throw new Error(`upsertAudit: ${error.message}`);
    },

    async pullAudits() {
      const supabase = getSupabase();
      if (!supabase) return [];
      // RLS scopes to the caller's org (and hides privileged audits from
      // uncleared roles) — no client-side filter needed or trusted.
      const { data, error } = await supabase.from('audits').select('*');
      if (error) throw new Error(`pullAudits: ${error.message}`);
      return ((data ?? []) as RemoteAudit[]).map((a) => ({
        ...a,
        updated_at: isoZ(a.updated_at),
        ...(a.created_at ? { created_at: isoZ(a.created_at) } : {}),
      }));
    },

    async pullScopingAnswers(auditId) {
      const supabase = getSupabase();
      if (!supabase) return [];
      const { data, error } = await supabase
        .from('audit_scoping_answers')
        .select('*')
        .eq('audit_id', auditId);
      if (error) throw new Error(`pullScopingAnswers: ${error.message}`);
      return (data ?? []) as RemoteScopingAnswer[];
    },

    async upsertScopingAnswers(rows: RemoteScopingAnswer[]) {
      if (rows.length === 0) return;
      const supabase = getSupabase();
      if (!supabase) return;
      const { error } = await supabase
        .from('audit_scoping_answers')
        .upsert(rows, { onConflict: 'audit_id,question_key' });
      if (error) throw new Error(`upsertScopingAnswers: ${error.message}`);
    },

    async upsertCorrectiveActions(rows: RemoteCorrectiveAction[]) {
      if (rows.length === 0) return;
      const supabase = getSupabase();
      if (!supabase) return;
      const { error } = await supabase.from('corrective_actions').upsert(rows, { onConflict: 'id' });
      if (error) throw new Error(`upsertCorrectiveActions: ${error.message}`);
    },

    async insertDisclosures(rows: RemoteDisclosure[]) {
      if (rows.length === 0) return;
      const supabase = getSupabase();
      if (!supabase) return;
      // Insert-only trail — ignore duplicates (same id) on retry.
      const { error } = await supabase.from('disclosure_log').upsert(rows, {
        onConflict: 'id',
        ignoreDuplicates: true,
      });
      if (error) throw new Error(`insertDisclosures: ${error.message}`);
    },

    async insertEvents(events: RemoteEvent[]) {
      if (events.length === 0) return;
      const supabase = getSupabase();
      if (!supabase) return;
      // Immutable log — ignore duplicates (same id) on retry.
      const { error } = await supabase.from('audit_item_events').upsert(events, {
        onConflict: 'id',
        ignoreDuplicates: true,
      });
      if (error) throw new Error(`insertEvents: ${error.message}`);
    },
  };
}

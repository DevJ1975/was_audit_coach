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
import { getSupabase } from '@/db/supabase';
import type { RemoteAdapter, RemoteAuditItem, RemoteAudit } from './remote';

export function createSupabaseRemote(): RemoteAdapter {
  return {
    isAvailable() {
      return getSupabase() != null;
    },

    async pullAuditItems(auditId, since) {
      const supabase = getSupabase();
      if (!supabase) return [];
      let query = supabase.from('audit_items').select('*').eq('audit_id', auditId);
      if (since) query = query.gt('updated_at', since);
      const { data, error } = await query;
      if (error) throw new Error(`pullAuditItems: ${error.message}`);
      return (data ?? []) as RemoteAuditItem[];
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

    async insertEvents(events) {
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

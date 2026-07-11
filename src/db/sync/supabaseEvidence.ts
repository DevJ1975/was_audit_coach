/**
 * Supabase implementation of EvidenceRemote — the evidence Storage bucket plus
 * the `attachments` metadata table. RLS scopes both: the bucket policy checks the
 * org_id path prefix against the caller's JWT, and the table policy checks
 * org_id = auth_org_id(), so these calls only ever touch the caller's tenant.
 *
 * Not exercised in CI (needs a live backend + auth + a real file); typechecked
 * only and covered indirectly by the AttachmentSync unit tests through a fake.
 * Verify on device against the applied 0001 schema.
 */
import { getSupabase } from '@/db/supabase';
import type { EvidenceRemote, EvidenceBlob, RemoteAttachment } from './remote';

const BUCKET = 'evidence';

export function createSupabaseEvidence(): EvidenceRemote {
  return {
    isAvailable() {
      return getSupabase() != null;
    },

    async uploadEvidence(path: string, blob: EvidenceBlob) {
      const supabase = getSupabase();
      if (!supabase) return;
      // upsert so a retried upload (e.g. after the metadata insert failed) is a
      // safe overwrite rather than a duplicate-object error.
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob.data, {
        contentType: blob.contentType,
        upsert: true,
      });
      if (error) throw new Error(`uploadEvidence: ${error.message}`);
    },

    async upsertAttachments(rows: RemoteAttachment[]) {
      if (rows.length === 0) return;
      const supabase = getSupabase();
      if (!supabase) return;
      const { error } = await supabase.from('attachments').upsert(rows, { onConflict: 'id' });
      if (error) throw new Error(`upsertAttachments: ${error.message}`);
    },

    async deleteEvidence(paths: string[]) {
      if (paths.length === 0) return;
      const supabase = getSupabase();
      if (!supabase) return;
      const { error } = await supabase.storage.from(BUCKET).remove(paths);
      if (error) throw new Error(`deleteEvidence: ${error.message}`);
    },

    async deleteAttachments(ids: string[]) {
      if (ids.length === 0) return;
      const supabase = getSupabase();
      if (!supabase) return;
      const { error } = await supabase.from('attachments').delete().in('id', ids);
      if (error) throw new Error(`deleteAttachments: ${error.message}`);
    },

    async createSignedUrl(path: string, expiresInSec: number) {
      const supabase = getSupabase();
      if (!supabase) return null;
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSec);
      if (error) return null;
      return data?.signedUrl ?? null;
    },
  };
}

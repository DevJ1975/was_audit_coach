/**
 * Idempotent Supabase loader (Phase C1/C2). Runs under the SERVICE ROLE (RLS
 * bypass — the corpus tables have no API write policies by design). Diffs by
 * content_hash so an unchanged eCFR issue plans zero writes; changed documents
 * get their chunks replaced atomically per document.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (required to load)
 *      VOYAGE_API_KEY (optional — omit to load FTS-only, embed later)
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { planLoad, type LoadPlan } from './diff';
import { embedDocuments, hasVoyageKey } from './embed';
import type { RegChunk, RegDocument } from './types';

const UPSERT_BATCH = 100;

export function canLoad(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function serviceClient(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

/** Page through existing (id, content_hash) — PostgREST caps rows per request. */
async function existingHashes(db: SupabaseClient, parts: string[]) {
  const rows: { id: string; content_hash: string }[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('reg_documents')
      .select('id, content_hash')
      .eq('jurisdiction', 'federal')
      .in('part', parts)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`reg_documents read failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/**
 * Embed chunks loaded FTS-only (embedding IS NULL) — the backfill for a corpus
 * loaded before VOYAGE_API_KEY existed. Returns the number embedded.
 */
export async function embedMissing(log: (msg: string) => void): Promise<number> {
  if (!hasVoyageKey()) throw new Error('--embed-missing needs VOYAGE_API_KEY.');
  const db = serviceClient();
  const PAGE = 200;
  let total = 0;
  for (;;) {
    const { data, error } = await db
      .from('reg_chunks')
      .select('id, text')
      .is('embedding', null)
      .order('id')
      .limit(PAGE);
    if (error) throw new Error(`reg_chunks read failed: ${error.message}`);
    if (!data || data.length === 0) return total;
    const vectors = await embedDocuments(data.map((c) => c.text));
    for (let i = 0; i < data.length; i++) {
      const { error: upErr } = await db
        .from('reg_chunks')
        .update({ embedding: vectors[i] })
        .eq('id', data[i]!.id);
      if (upErr) throw new Error(`reg_chunks update failed: ${upErr.message}`);
    }
    total += data.length;
    log(`  embedded ${total} chunks…`);
  }
}

export interface LoadResult {
  plan: LoadPlan;
  chunksWritten: number;
  embedded: boolean;
}

export async function loadCorpus(
  documents: RegDocument[],
  chunks: RegChunk[],
  parts: string[],
  log: (msg: string) => void,
): Promise<LoadResult> {
  const db = serviceClient();
  const plan = planLoad(await existingHashes(db, parts), documents);
  const dirty = new Set([...plan.create, ...plan.update]);
  log(
    `plan: ${plan.create.length} new, ${plan.update.length} changed, ` +
      `${plan.unchanged.length} unchanged, ${plan.remove.length} removed`,
  );
  if (dirty.size === 0 && plan.remove.length === 0) {
    return { plan, chunksWritten: 0, embedded: false };
  }

  const docsToWrite = documents.filter((d) => dirty.has(d.id));
  const chunksToWrite = chunks.filter((c) => dirty.has(c.document_id));

  const embedded = hasVoyageKey();
  if (embedded && chunksToWrite.length > 0) {
    log(`embedding ${chunksToWrite.length} chunks via Voyage…`);
    const vectors = await embedDocuments(
      chunksToWrite.map((c) => c.text),
      (done, total) => log(`  embedded ${done}/${total}`),
    );
    chunksToWrite.forEach((c, i) => (c.embedding = vectors[i]));
  } else if (chunksToWrite.length > 0) {
    log('VOYAGE_API_KEY not set — loading FTS-only (embeddings NULL).');
  }

  // Documents first (chunks FK on them). paragraphs is ETL-internal — strip it.
  for (let i = 0; i < docsToWrite.length; i += UPSERT_BATCH) {
    const batch = docsToWrite.slice(i, i + UPSERT_BATCH).map(({ paragraphs: _p, ...row }) => row);
    const { error } = await db.from('reg_documents').upsert(batch, { onConflict: 'id' });
    if (error) throw new Error(`reg_documents upsert failed: ${error.message}`);
  }

  // Replace chunks per dirty document — count can shrink, so delete-then-insert.
  const dirtyIds = [...dirty];
  for (let i = 0; i < dirtyIds.length; i += UPSERT_BATCH) {
    const { error } = await db
      .from('reg_chunks')
      .delete()
      .in('document_id', dirtyIds.slice(i, i + UPSERT_BATCH));
    if (error) throw new Error(`reg_chunks delete failed: ${error.message}`);
  }
  for (let i = 0; i < chunksToWrite.length; i += UPSERT_BATCH) {
    const { error } = await db.from('reg_chunks').insert(chunksToWrite.slice(i, i + UPSERT_BATCH));
    if (error) throw new Error(`reg_chunks insert failed: ${error.message}`);
    log(`  chunks ${Math.min(i + UPSERT_BATCH, chunksToWrite.length)}/${chunksToWrite.length}`);
  }

  // Upstream removals (e.g. a section newly reserved). Cascade clears chunks.
  if (plan.remove.length > 0) {
    const { error } = await db.from('reg_documents').delete().in('id', plan.remove);
    if (error) throw new Error(`reg_documents delete failed: ${error.message}`);
  }

  return { plan, chunksWritten: chunksToWrite.length, embedded };
}

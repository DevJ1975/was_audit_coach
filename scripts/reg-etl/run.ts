/**
 * Regulation-corpus ETL (Phases C1–C2, SOTERIA_CHAT_KB_PLAN.md).
 *
 *   npm run reg-etl                          # fetch → parse → chunk → load
 *   npm run reg-etl -- --parts=1904,1910     # subset of parts
 *   npm run reg-etl -- --dry-run             # no writes, print counts only
 *   npm run reg-etl -- --out=data/reg-corpus # also write JSONL artifacts
 *
 * Loading requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (service role: the
 * corpus tables accept no API writes). With VOYAGE_API_KEY set, chunks are
 * embedded (voyage-law-2, 1024-dim); without it the corpus loads FTS-only.
 * Idempotent: unchanged content_hash ⇒ zero writes. Weekly freshness (C7)
 * re-runs exactly this.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FEDERAL_PARTS, fetchPartXml, latestIssueDate } from './ecfr';
import { parsePartXml } from './parse';
import { chunkDocument } from './chunk';
import { canLoad, embedMissing, loadCorpus } from './load';
import { corpusSqlBatches } from './gen_sql';
import type { RegChunk, RegDocument } from './types';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  // Backfill mode: embed already-loaded chunks whose embedding is NULL (e.g.
  // the corpus was loaded FTS-only before a Voyage key existed). The hash-diff
  // would otherwise never revisit unchanged documents.
  if (flag('embed-missing')) {
    if (!canLoad()) throw new Error('--embed-missing needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.');
    const n = await embedMissing((m) => console.log(m));
    console.log(`embedded ${n} previously-unembedded chunks`);
    return;
  }

  const parts = arg('parts')?.split(',').map((p) => p.trim()) ?? [...FEDERAL_PARTS];
  const date = arg('date') ?? (await latestIssueDate());
  const dryRun = flag('dry-run');
  console.log(`eCFR title 29 @ ${date} — parts: ${parts.join(', ')}${dryRun ? ' (dry run)' : ''}`);

  const documents: RegDocument[] = [];
  const chunks: RegChunk[] = [];
  for (const part of parts) {
    const xml = await fetchPartXml(date, part);
    const parsed = parsePartXml(xml, date);
    const partChunks = parsed.documents.flatMap(chunkDocument);
    documents.push(...parsed.documents);
    chunks.push(...partChunks);
    console.log(
      `  part ${part}: ${parsed.documents.length} documents, ${partChunks.length} chunks ` +
        `(${(xml.length / 1e6).toFixed(1)} MB xml)`,
    );
  }
  console.log(`total: ${documents.length} documents, ${chunks.length} chunks`);

  const out = arg('out');
  if (out) {
    const dir = resolve(process.cwd(), out);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, 'documents.jsonl'),
      documents.map(({ paragraphs: _p, ...d }) => JSON.stringify(d)).join('\n'),
    );
    writeFileSync(resolve(dir, 'chunks.jsonl'), chunks.map((c) => JSON.stringify(c)).join('\n'));
    console.log(`wrote JSONL artifacts to ${dir}`);
  }

  // No-service-key load path: batched idempotent SQL for the SQL editor / MCP.
  const sqlOut = arg('sql-out');
  if (sqlOut) {
    const dir = resolve(process.cwd(), sqlOut);
    mkdirSync(dir, { recursive: true });
    const batches = corpusSqlBatches(documents, chunks);
    for (const b of batches) writeFileSync(resolve(dir, b.name), b.sql);
    console.log(
      `wrote ${batches.length} SQL batches to ${dir} ` +
        `(${batches.reduce((n, b) => n + b.docCount, 0)} docs, ` +
        `${batches.reduce((n, b) => n + b.chunkCount, 0)} chunks)`,
    );
  }

  if (dryRun) return;
  if (!canLoad()) {
    console.log('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — skipping load.');
    console.log('Set them (service role) and re-run to populate reg_documents/reg_chunks.');
    return;
  }
  const result = await loadCorpus(documents, chunks, parts, (m) => console.log(m));
  console.log(
    `loaded: ${result.chunksWritten} chunks written` +
      (result.embedded ? ' (embedded)' : ' (FTS-only — set VOYAGE_API_KEY to embed)'),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

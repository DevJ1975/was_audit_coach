/**
 * SQL emission for the regulation corpus (Phase C1/C2 alternate load path).
 * Mirrors scripts/gen_cloud_seed.ts: when no service-role key is available
 * (SQL editor, MCP execute_sql), the corpus loads as batched SQL files.
 *
 * Batches are grouped by WHOLE documents: each batch upserts its documents,
 * deletes their existing chunks (counts can shrink), and inserts the new
 * chunks — so any batch is independently idempotent and re-runnable.
 */
import type { RegChunk, RegDocument } from './types';

/** SQL string literal with quote-doubling. */
export function q(v: string | null | undefined): string {
  if (v == null) return 'null';
  return `'${v.replace(/'/g, "''")}'`;
}

function vec(embedding: number[] | undefined): string {
  if (!embedding) return 'null';
  return `'[${embedding.join(',')}]'::vector`;
}

function docRow(d: RegDocument): string {
  return `(${q(d.id)},${q(d.jurisdiction)},${q(d.citation)},${q(d.title)},${q(d.heading_path)},${q(d.part)},${q(d.body)},${q(d.source_url)},${d.last_amended ? q(d.last_amended) : 'null'},${q(d.version)},${q(d.content_hash)})`;
}

function chunkRow(c: RegChunk): string {
  return `(${q(c.id)},${q(c.document_id)},${c.ordinal},${q(c.jurisdiction)},${q(c.citation)},${q(c.heading_path)},${q(c.text)},${c.token_count},${vec(c.embedding)})`;
}

export function batchSql(docs: RegDocument[], chunks: RegChunk[]): string {
  const ids = docs.map((d) => q(d.id)).join(',');
  return [
    `insert into reg_documents (id,jurisdiction,citation,title,heading_path,part,body,source_url,last_amended,version,content_hash) values`,
    docs.map(docRow).join(',\n'),
    `on conflict (id) do update set jurisdiction=excluded.jurisdiction, citation=excluded.citation, title=excluded.title, heading_path=excluded.heading_path, part=excluded.part, body=excluded.body, source_url=excluded.source_url, last_amended=excluded.last_amended, version=excluded.version, content_hash=excluded.content_hash, fetched_at=now();`,
    `delete from reg_chunks where document_id in (${ids});`,
    `insert into reg_chunks (id,document_id,ordinal,jurisdiction,citation,heading_path,text,token_count,embedding) values`,
    chunks.map(chunkRow).join(',\n') + ';',
  ].join('\n');
}

export interface SqlBatch {
  name: string; // 'reg_corpus_001.sql'
  sql: string;
  docCount: number;
  chunkCount: number;
}

/**
 * Split the corpus into ~`targetBytes` SQL files, never splitting a document's
 * chunks across batches.
 */
export function corpusSqlBatches(
  documents: RegDocument[],
  chunks: RegChunk[],
  targetBytes = 400_000,
): SqlBatch[] {
  const chunksByDoc = new Map<string, RegChunk[]>();
  for (const c of chunks) {
    const list = chunksByDoc.get(c.document_id) ?? [];
    list.push(c);
    chunksByDoc.set(c.document_id, list);
  }

  const batches: SqlBatch[] = [];
  let docBuf: RegDocument[] = [];
  let chunkBuf: RegChunk[] = [];
  let size = 0;

  const emit = (): void => {
    if (docBuf.length === 0) return;
    batches.push({
      name: `reg_corpus_${String(batches.length + 1).padStart(3, '0')}.sql`,
      sql: batchSql(docBuf, chunkBuf),
      docCount: docBuf.length,
      chunkCount: chunkBuf.length,
    });
    docBuf = [];
    chunkBuf = [];
    size = 0;
  };

  for (const doc of documents) {
    const docChunks = chunksByDoc.get(doc.id) ?? [];
    const docSize = doc.body.length * 2 + docChunks.reduce((n, c) => n + c.text.length, 0);
    if (docBuf.length > 0 && size + docSize > targetBytes) emit();
    docBuf.push(doc);
    chunkBuf.push(...docChunks);
    size += docSize;
  }
  emit();
  return batches;
}

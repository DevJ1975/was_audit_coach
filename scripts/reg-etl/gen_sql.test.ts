import { describe, expect, it } from 'vitest';
import { corpusSqlBatches, q } from './gen_sql';
import type { RegChunk, RegDocument } from './types';

const doc = (id: string, body = 'text'): RegDocument => ({
  id,
  jurisdiction: 'federal',
  citation: `29 CFR ${id.replace('ecfr:', '')}`,
  title: "Auditor's title — with 'quotes'",
  heading_path: 'Part › Section',
  part: '1910',
  body,
  paragraphs: [body],
  source_url: 'https://www.ecfr.gov/x',
  last_amended: null,
  version: '2026-07-09',
  content_hash: 'h',
});

const chunk = (docId: string, ordinal: number, embedding?: number[]): RegChunk => ({
  id: `${docId}#${ordinal}`,
  document_id: docId,
  ordinal,
  jurisdiction: 'federal',
  citation: '29 CFR x',
  heading_path: 'p',
  text: "chunk with 'quote'",
  token_count: 5,
  embedding,
});

describe('gen_sql', () => {
  it('escapes single quotes and renders null', () => {
    expect(q("auditor's")).toBe("'auditor''s'");
    expect(q(null)).toBe('null');
  });

  it('keeps a document and ALL its chunks in the same batch', () => {
    const docs = [doc('ecfr:a', 'x'.repeat(500)), doc('ecfr:b', 'y'.repeat(500))];
    const chunks = [chunk('ecfr:a', 0), chunk('ecfr:a', 1), chunk('ecfr:b', 0)];
    const batches = corpusSqlBatches(docs, chunks, 1200); // force a split
    expect(batches.length).toBe(2);
    expect(batches[0]!.sql).toContain("'ecfr:a#0'");
    expect(batches[0]!.sql).toContain("'ecfr:a#1'");
    expect(batches[0]!.sql).not.toContain("'ecfr:b#0'");
    expect(batches[1]!.sql).toContain("'ecfr:b#0'");
  });

  it('emits idempotent SQL: upsert docs, delete-then-insert chunks', () => {
    const [b] = corpusSqlBatches([doc('ecfr:a')], [chunk('ecfr:a', 0)]);
    expect(b!.sql).toContain('on conflict (id) do update');
    expect(b!.sql).toContain("delete from reg_chunks where document_id in ('ecfr:a')");
    expect(b!.sql).toContain('insert into reg_chunks');
    expect(b!.sql).not.toContain(' fts'); // generated column never written
  });

  it('renders embeddings as vector literals, null when absent', () => {
    const [withVec] = corpusSqlBatches([doc('ecfr:a')], [chunk('ecfr:a', 0, [0.1, -0.2])]);
    expect(withVec!.sql).toContain("'[0.1,-0.2]'::vector");
    const [without] = corpusSqlBatches([doc('ecfr:a')], [chunk('ecfr:a', 0)]);
    expect(without!.sql).toMatch(/,5,null\)/);
  });
});

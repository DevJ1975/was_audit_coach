/**
 * Retrieval smoke eval (Phase C2 acceptance). The shape checks always run in
 * CI. The LIVE recall test needs a populated corpus (npm run reg-etl) and runs
 * only when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set; with
 * VOYAGE_API_KEY it exercises full hybrid retrieval (recall@10 ≥ 0.9),
 * without it FTS-only (≥ 0.6 — semantic questions like "eyewash" have no
 * lexical match in 1910.151; that gap is exactly why the embeddings exist).
 */
import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import smoke from './retrieval_smoke_set.json';

const questions = smoke.questions as { q: string; expect: string }[];
const canRunLive = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const hasVoyage = Boolean(process.env.VOYAGE_API_KEY);

describe('retrieval smoke set (shape)', () => {
  it('has at least 20 questions, each expecting a federal citation', () => {
    expect(questions.length).toBeGreaterThanOrEqual(20);
    for (const row of questions) {
      expect(row.q.length).toBeGreaterThan(10);
      expect(row.expect).toMatch(/^29 CFR 19\d\d/);
    }
  });
});

async function embedQuery(q: string): Promise<number[] | null> {
  if (!hasVoyage) return null;
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      input: [q],
      model: process.env.VOYAGE_MODEL ?? 'voyage-law-2',
      input_type: 'query',
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  return data.data[0]?.embedding ?? null;
}

describe.skipIf(!canRunLive)('retrieval recall@10 (live corpus)', () => {
  it(
    `surfaces the expected section for the smoke set (${hasVoyage ? 'hybrid' : 'FTS-only'})`,
    async () => {
      const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false },
      });
      const misses: string[] = [];
      for (const row of questions) {
        const { data, error } = await db.rpc('search_regulations', {
          q: row.q,
          q_embedding: await embedQuery(row.q),
          jurisdictions: ['federal'],
          match_count: 10,
        });
        expect(error).toBeNull();
        const hit = (data ?? []).some((r: { citation: string }) =>
          r.citation.startsWith(row.expect),
        );
        if (!hit) misses.push(`${row.q} → expected ${row.expect}`);
      }
      const recall = (questions.length - misses.length) / questions.length;
      // eslint-disable-next-line no-console
      if (misses.length) console.warn('retrieval misses:\n  ' + misses.join('\n  '));
      expect(recall).toBeGreaterThanOrEqual(hasVoyage ? 0.9 : 0.6);
    },
    120_000,
  );
});

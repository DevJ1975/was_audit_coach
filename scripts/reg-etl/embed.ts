/**
 * Voyage AI embeddings (Phase C2). voyage-law-2 is legal-domain-tuned and
 * 1024-dim, matching reg_chunks.embedding vector(1024). Without VOYAGE_API_KEY
 * the pipeline still works — chunks load with NULL embeddings and the
 * search_regulations RPC degrades to FTS-only.
 */

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const BATCH = 64;

export function voyageModel(): string {
  return process.env.VOYAGE_MODEL ?? 'voyage-law-2';
}

export function hasVoyageKey(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY);
}

async function embedBatch(
  texts: string[],
  inputType: 'document' | 'query',
): Promise<number[][]> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(VOYAGE_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ input: texts, model: voyageModel(), input_type: inputType }),
    });
    if (res.ok) {
      const data = (await res.json()) as { data: { index: number; embedding: number[] }[] };
      return [...data.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    }
    if (attempt >= 4 || (res.status < 500 && res.status !== 429)) {
      throw new Error(`Voyage ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    await new Promise((r) => setTimeout(r, attempt * 3000));
  }
}

/** Embed document chunks in order; returns one vector per input text. */
export async function embedDocuments(
  texts: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const vectors = await embedBatch(texts.slice(i, i + BATCH), 'document');
    out.push(...vectors);
    onProgress?.(Math.min(i + BATCH, texts.length), texts.length);
  }
  return out;
}

/**
 * Citation verification for soteria-chat (Phase C3). Pure module — no Deno
 * APIs — shared by the Edge Function and the vitest suite.
 *
 * The model is instructed to mark every regulatory claim with an inline
 * [c:<chunk_id>] token, using only chunk ids returned by search_regulations in
 * THIS conversation. This resolver is the structural guarantee behind
 * "no answer ships an unretrieved citation": tokens whose chunk_id was never
 * retrieved are stripped; surviving tokens become numbered [n] markers mapped
 * to source metadata. Refs are numbered per regulation citation (two chunks of
 * § 1910.147 share one card), in order of first appearance.
 */

export interface RetrievedChunk {
  chunk_id: string;
  citation: string;
  heading_path: string;
  jurisdiction: string;
  source_url: string;
  last_amended: string | null;
}

export interface ResolvedCitation {
  ref: number;
  citation: string;
  heading_path: string;
  jurisdiction: string;
  source_url: string;
  last_amended: string | null;
}

const TOKEN = /\[c:([^\]\s]+)\]/g;

export function resolveCitations(
  text: string,
  retrieved: ReadonlyMap<string, RetrievedChunk>,
): { text: string; citations: ResolvedCitation[] } {
  const refByCitation = new Map<string, ResolvedCitation>();

  let out = text.replace(TOKEN, (_match, chunkId: string) => {
    const chunk = retrieved.get(chunkId);
    if (!chunk) return ''; // unverified — strip, never render
    let entry = refByCitation.get(chunk.citation);
    if (!entry) {
      entry = {
        ref: refByCitation.size + 1,
        citation: chunk.citation,
        heading_path: chunk.heading_path,
        jurisdiction: chunk.jurisdiction,
        source_url: chunk.source_url,
        last_amended: chunk.last_amended,
      };
      refByCitation.set(chunk.citation, entry);
    }
    return `[${entry.ref}]`;
  });

  out = out
    .replace(/\[(\d+)\](\[\1\])+/g, '[$1]') // adjacent duplicates of the same ref
    .replace(/ +([.,;:!?)])/g, '$1') // space orphaned by a stripped token
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return { text: out, citations: [...refByCitation.values()] };
}

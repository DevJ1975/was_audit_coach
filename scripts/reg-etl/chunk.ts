/**
 * Structure-aware chunking (Phase C2). Chunks respect the regulation's own
 * paragraph boundaries and target ~500–900 tokens. Every chunk's indexed text
 * is prefixed with a "<citation> — <title>" header line so a query like
 * "1910.147" matches every chunk of that section lexically and semantically —
 * this replaces sliding-window overlap.
 */
import type { RegChunk, RegDocument } from './types';

export const TARGET_TOKENS = 800; // upper bound before a chunk is emitted
export const HARD_MAX_TOKENS = 1000; // single paragraphs beyond this get split

/** Cheap token estimate (~4 chars/token for English legal prose). */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

/** Split an oversized paragraph at sentence boundaries near the target size. */
function splitOversized(paragraph: string): string[] {
  const sentences = paragraph.match(/[^.;]+[.;]?\s*/g) ?? [paragraph];
  const parts: string[] = [];
  let buf = '';
  for (const s of sentences) {
    if (buf && estimateTokens(buf + s) > TARGET_TOKENS) {
      parts.push(buf.trim());
      buf = '';
    }
    buf += s;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

/** Greedy paragraph packing: emit when adding the next block would overflow. */
export function packParagraphs(paragraphs: string[]): string[] {
  const blocks = paragraphs.flatMap((p) =>
    estimateTokens(p) > HARD_MAX_TOKENS ? splitOversized(p) : [p],
  );
  const chunks: string[] = [];
  let buf: string[] = [];
  let bufTokens = 0;
  for (const block of blocks) {
    const t = estimateTokens(block);
    if (buf.length > 0 && bufTokens + t > TARGET_TOKENS) {
      chunks.push(buf.join('\n'));
      buf = [];
      bufTokens = 0;
    }
    buf.push(block);
    bufTokens += t;
  }
  if (buf.length > 0) chunks.push(buf.join('\n'));
  return chunks;
}

export function chunkDocument(doc: RegDocument): RegChunk[] {
  const header = `${doc.citation} — ${doc.title}`;
  return packParagraphs(doc.paragraphs).map((body, i) => {
    const text = `${header}\n${body}`;
    return {
      id: `${doc.id}#${i}`,
      document_id: doc.id,
      ordinal: i,
      jurisdiction: doc.jurisdiction,
      citation: doc.citation,
      heading_path: doc.heading_path,
      text,
      token_count: estimateTokens(text),
    };
  });
}

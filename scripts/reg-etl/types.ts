/**
 * Regulation-corpus ETL types (Phase C1, SOTERIA_CHAT_KB_PLAN.md).
 * Row shapes mirror supabase/migrations/0003_reg_corpus.sql exactly.
 */

export interface RegDocument {
  id: string;            // deterministic: 'ecfr:1910.147', 'ecfr:1904:appendix-a-…'
  jurisdiction: string;  // 'federal' for the eCFR pipeline
  citation: string;      // '29 CFR 1910.147'
  title: string;
  heading_path: string;  // 'Part 1910 — … › Subpart J — … › § 1910.147 …'
  part: string;          // '1910'
  body: string;          // normalized full text
  /** Block-level text units (paragraphs, notes, table rows) — chunker input. */
  paragraphs: string[];
  source_url: string;
  last_amended: string | null; // ISO date from the source credit, when parseable
  version: string;             // eCFR issue date the text was pulled at
  content_hash: string;
}

export interface RegChunk {
  id: string;            // '<document_id>#<ordinal>'
  document_id: string;
  ordinal: number;
  jurisdiction: string;
  citation: string;
  heading_path: string;
  text: string;          // citation header line + body slice (what gets embedded/FTS'd)
  token_count: number;
  embedding?: number[];  // attached by the indexer when a Voyage key is configured
}

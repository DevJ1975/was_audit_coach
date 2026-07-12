/**
 * Pure formatting helpers for the legal brief — deliberately free of any network
 * or platform import (no Supabase) so they stay unit-testable in Node, exactly
 * like src/ai/prompts.ts. reportBrief.ts (which does touch the network) re-uses
 * these.
 */
import { EXEC_SUMMARY_TAGS, type ExecSummaryTag } from './prompts';

/** The fixed, human-reviewable compliance statement rendered as the report's
 *  disclaimer. Deliberately NOT AI-generated — it is a legal-safety assertion,
 *  so it ships as a constant the auditor can edit before accepting. */
export const LEGAL_DISCLAIMER =
  'This report was prepared with AI assistance. The narrative sections were AI-drafted, ' +
  'then reviewed, edited, and accepted by the qualified human auditor named herein. All ' +
  'ratings, scores, and effective maximums shown were determined solely by the auditor ' +
  'using a fixed, validated scoring methodology — not by AI. The AI-assisted content is ' +
  'safety documentation, not legal advice, and creates no attorney-client relationship; ' +
  'it is provided for review by the client’s counsel. This assessment reflects ' +
  'conditions observed at a point in time and is not exhaustive.';

/** Split the executive-summary pass's tagged output into its four sections.
 *  If the model omitted the tags, the whole text is kept as the exec summary
 *  rather than lost. */
export function parseExecSummary(text: string): Record<ExecSummaryTag, string> {
  const out: Record<ExecSummaryTag, string> = {
    EXEC_SUMMARY: '', METHODOLOGY: '', CHAIN_OF_CUSTODY: '', LIMITATIONS: '',
  };
  const positions = EXEC_SUMMARY_TAGS
    .map((tag) => ({ tag, index: text.indexOf(`[${tag}]`), len: tag.length + 2 }))
    .filter((p) => p.index >= 0)
    .sort((a, b) => a.index - b.index);
  if (positions.length === 0) {
    out.EXEC_SUMMARY = text.trim();
    return out;
  }
  for (let i = 0; i < positions.length; i++) {
    const cur = positions[i]!;
    const next = positions[i + 1];
    out[cur.tag] = text.slice(cur.index + cur.len, next ? next.index : text.length).trim();
  }
  return out;
}

/**
 * Legal-grade report brief orchestrator (Phase 5). Drives the TWO agents that
 * wrap the deterministic findings report:
 *
 *   1. CSP agent      — per finding, drafts the technical hazard/risk narrative.
 *   2. Attorney agent — per finding, refines that narrative for legal
 *                       defensibility; and once for the whole audit, drafts the
 *                       counsel-facing executive summary / methodology /
 *                       chain-of-custody / limitations sections.
 *
 * Each step is one grounded call to the `report-brief` Edge Function (the key
 * lives server-side). The orchestration lives here so every call stays small and
 * resumable. This returns DRAFT text only — nothing is stored until a human
 * accepts it (repo.saveReportBrief). Ratings/scores are never produced here:
 * the deterministic renderer owns them (Non-Negotiable #2).
 */
import { getSupabase } from '@/db/supabase';
import { unwrapFunctionError } from './invokeError';
import {
  buildCspFindingNarrative,
  buildAttorneyFindingReview,
  buildExecSummary,
  type BuiltPrompt,
  type GroundingItem,
  type FindingDigest,
  type BriefAuditContext,
} from './prompts';
import { LEGAL_DISCLAIMER, parseExecSummary } from './reportBriefFormat';
import type { ReportBriefContent } from '@/db/types';

export { LEGAL_DISCLAIMER, parseExecSummary } from './reportBriefFormat';

/** One finding's grounding for the two per-finding passes. */
export interface BriefFindingInput {
  audit_item_id: string;
  section_code: string;
  grounding: GroundingItem;
  /** The auditor's determination — context only. */
  rating: string;
  observation: string;
  recommendation: string;
  sif_potential: boolean;
}

export interface BuildBriefInput {
  context: BriefAuditContext;
  findings: BriefFindingInput[];
  scoreSnapshot?: ReportBriefContent['scoreSnapshot'];
}

export interface BriefProgress {
  done: number;
  total: number;
  /** Human-readable current step, e.g. "Refining finding 6 of 24…". */
  label: string;
}

export type BuildBriefResult =
  | { ok: true; content: ReportBriefContent; warnings: string[]; model: string }
  | { ok: false; error: string };

/** Concurrency for per-finding work — small, to stay well under any rate limit
 *  while keeping wall-clock reasonable on a 30-finding audit. */
const CONCURRENCY = 4;

/** One grounded call to the report-brief function. Text only, by construction. */
async function callBrief(
  prompt: BuiltPrompt,
): Promise<{ ok: true; text: string; model?: string } | { ok: false; error: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: 'AI connects when the app is online and signed in.' };
  try {
    const { data, error } = await supabase.functions.invoke<{ text?: string; model?: string; error?: string }>(
      'report-brief',
      { body: { kind: prompt.kind, system: prompt.system, user: prompt.user, maxTokens: prompt.maxTokens } },
    );
    if (error) return { ok: false, error: (await unwrapFunctionError(error, 'Report brief request failed.')).message };
    if (!data?.text) return { ok: false, error: data?.error ?? 'No text returned.' };
    return { ok: true, text: data.text.trim(), model: data.model };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Run `tasks` with bounded concurrency, preserving input order in the results. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Generate a full legal brief draft. Reports progress as steps complete. A
 * finding whose narrative fails is skipped (recorded in `warnings`) rather than
 * failing the whole run; only a missing executive summary is fatal (it is the
 * spine of the document).
 */
export async function generateReportBrief(
  input: BuildBriefInput,
  onProgress?: (p: BriefProgress) => void,
): Promise<BuildBriefResult> {
  const { findings } = input;
  const total = findings.length * 2 + 1; // CSP + attorney per finding, plus exec summary
  let done = 0;
  const warnings: string[] = [];
  const tick = (label: string): void => onProgress?.({ done, total, label });
  tick('Starting…');

  const findingNarratives: Record<string, string> = {};

  await mapLimit(findings, CONCURRENCY, async (f, i) => {
    const label = `${f.grounding.item_code} (${i + 1} of ${findings.length})`;
    // Pass 1 — CSP drafts the technical narrative.
    tick(`Drafting ${label}…`);
    const csp = await callBrief(
      buildCspFindingNarrative(f.grounding, f.rating, f.observation, f.recommendation, f.sif_potential),
    );
    done++;
    if (!csp.ok) {
      warnings.push(`${f.grounding.item_code}: ${csp.error}`);
      done++; // skip the attorney step for this finding
      return;
    }
    // Pass 2 — attorney refines it for legal defensibility.
    tick(`Refining ${label}…`);
    const refined = await callBrief(buildAttorneyFindingReview(f.grounding, csp.text));
    done++;
    findingNarratives[f.audit_item_id] = refined.ok ? refined.text : csp.text;
    if (!refined.ok) warnings.push(`${f.grounding.item_code} (legal refine): ${refined.error}`);
  });

  // Executive-summary pass — the attorney agent's document-level sections.
  tick('Drafting the executive summary…');
  const digests: FindingDigest[] = findings.map((f) => ({
    item_code: f.grounding.item_code,
    section_code: f.section_code,
    rating: f.rating,
    sif_potential: f.sif_potential,
    requirement: f.grounding.requirement,
    citation: f.grounding.citation,
  }));
  const exec = await callBrief(buildExecSummary(input.context, digests));
  done++;
  tick('Done');
  if (!exec.ok) return { ok: false, error: `Executive summary failed: ${exec.error}` };

  const parsed = parseExecSummary(exec.text);
  const content: ReportBriefContent = {
    execSummary: parsed.EXEC_SUMMARY,
    methodology: parsed.METHODOLOGY,
    chainOfCustody: parsed.CHAIN_OF_CUSTODY,
    limitations: parsed.LIMITATIONS,
    legalDisclaimer: LEGAL_DISCLAIMER,
    findingNarratives,
    citations: [], // reserved for a future retrieval-grounded citation pass
    scoreSnapshot: input.scoreSnapshot,
  };
  return { ok: true, content, warnings, model: exec.model ?? 'claude-opus-4-8' };
}

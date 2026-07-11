/**
 * Grounded prompt builders (Phase 3). Pure functions — no network, no model
 * calls — so they are unit-testable and identical on client and server.
 *
 * Every builder embeds the item's own requirement / evidence protocol / citation
 * as grounding (no vector DB needed at 374 items) and forbids the model from
 * stating or implying a `rating`. AI DRAFTS; HUMANS RATE (Non-Negotiable #2).
 */

export interface GroundingItem {
  item_code: string;
  requirement: string;
  evidence_protocol: string;
  citation: string;
}

export interface BuiltPrompt {
  system: string;
  user: string;
  /** Output cap — bounded so drafts stay short and cheap. */
  maxTokens: number;
  /** Logical kind, echoed back for metering/logging. */
  kind: PromptKind;
}

export type PromptKind = 'observation_polish' | 'recommendation_draft' | 'aria_coach';

/** Shared guardrail: the model must never touch the rating. */
const NEVER_RATE =
  'NEVER state, imply, suggest, or recommend a rating, score, tier, severity, or ' +
  'pass/fail judgment. Rating is the human auditor\'s job alone. Do not use words ' +
  'like "compliant", "non-compliant", "Low", "High", "Very High", "finding", or ' +
  '"deficiency" as a verdict. Describe only what was observed or required.';

function grounding(item: GroundingItem): string {
  return [
    `Item: ${item.item_code}`,
    `Citation: ${item.citation}`,
    `Regulatory requirement: ${item.requirement}`,
    `Evidence protocol (what the auditor inspects): ${item.evidence_protocol}`,
  ].join('\n');
}

/**
 * Observation Polish — raw dictation → precise, professional observation.
 * ≤80 words. Never invents details not present in the raw note. Never rates.
 */
export function buildObservationPolish(item: GroundingItem, rawObservation: string): BuiltPrompt {
  const system = [
    'You are an EHS audit editor. Rewrite the auditor\'s rough field note into one ',
    'precise, professional observation in past tense. Preserve every concrete detail ',
    '(counts, locations, dates, equipment) exactly; do NOT invent, infer, or add facts ',
    'that are not in the raw note. Keep it to 80 words or fewer. Return ONLY the polished ',
    'observation text — no preamble, no headings, no quotes.\n',
    NEVER_RATE,
  ].join('');
  const user = [
    grounding(item),
    '',
    'Raw dictated note to polish:',
    rawObservation.trim(),
  ].join('\n');
  return { system, user, maxTokens: 400, kind: 'observation_polish' };
}

/**
 * Recommendation Draft — from the auditor's chosen rating + their observation,
 * draft a specific corrective recommendation in a consultant voice. Concrete,
 * not "develop a program". The rating is INPUT context only — the model states
 * a corrective action, never re-judges or echoes the rating as a verdict.
 */
export function buildRecommendationDraft(
  item: GroundingItem,
  auditorRating: string,
  observation: string,
): BuiltPrompt {
  const system = [
    'You are a senior EHS consultant drafting a corrective recommendation for an ',
    'audit finding. Write specific, actionable steps grounded in the requirement and ',
    'evidence protocol — reference concrete artifacts, sampling, or controls, not vague ',
    'advice like "develop a program". 120 words or fewer. Return ONLY the recommendation ',
    'text — no preamble, no headings.\n',
    NEVER_RATE +
      ' The auditor\'s rating is provided only as context for how urgent the fix is; do ' +
      'not restate it as a verdict.',
  ].join('');
  const user = [
    grounding(item),
    '',
    `Auditor's rating (context only, do not echo as a verdict): ${auditorRating}`,
    `Auditor's observation: ${observation.trim()}`,
  ].join('\n');
  return { system, user, maxTokens: 500, kind: 'recommendation_draft' };
}

/**
 * ARIA Coach — answers the auditor's question using ONLY the item's requirement,
 * evidence protocol, and citation. If the answer isn't supported by that grounding,
 * it says so rather than guessing.
 */
export function buildAriaCoach(item: GroundingItem, question: string): BuiltPrompt {
  const system = [
    'You are ARIA, an audit-coaching assistant. Answer the auditor\'s question using ',
    'ONLY the regulatory requirement, evidence protocol, and citation provided for this ',
    'item. If the question cannot be answered from that grounding, say exactly: ',
    '"That isn\'t covered by this item\'s requirement or evidence protocol." Do not use ',
    'outside knowledge or invent regulations. Cite the provided citation when relevant. ',
    '150 words or fewer.\n',
    NEVER_RATE,
  ].join('');
  const user = [grounding(item), '', `Auditor's question: ${question.trim()}`].join('\n');
  return { system, user, maxTokens: 500, kind: 'aria_coach' };
}

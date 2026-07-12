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

export type PromptKind =
  | 'observation_polish'
  | 'recommendation_draft'
  | 'aria_coach'
  // Legal-grade report brief (two-agent: CSP writes, attorney refines & frames).
  | 'csp_finding_narrative'
  | 'attorney_review'
  | 'exec_summary';

/** Shared guardrail: the model must never touch the rating. */
const NEVER_RATE =
  'NEVER state, imply, suggest, or recommend a rating, score, tier, severity, or ' +
  'pass/fail judgment. Rating is the human auditor\'s job alone. Do not use words ' +
  'like "compliant", "non-compliant", "Low", "High", "Very High", "finding", or ' +
  '"deficiency" as a verdict. Describe only what was observed or required.';

/**
 * v1 legal-safety guardrail: the AI never mints legal authority. The finding's
 * authoritative citation is rendered deterministically from the seed library, so
 * the narrative refers to "the cited standard" and never writes a section number.
 * This eliminates hallucinated-law risk with no retrieval dependency. (A future
 * enhancement can add corpus-retrieved, chunk-verified citations.)
 */
const NO_INVENTED_LAW =
  'Do NOT write any statute, CFR, or code section number, and do not invent ' +
  'regulations or legal authority. Refer to "the cited standard" or "the applicable ' +
  'requirement"; the report shows the authoritative citation separately.';

/**
 * The attorney-review persona is a legal-READINESS reviewer, not the client's
 * lawyer. Keeps the app clear of unauthorized-practice-of-law and of
 * manufacturing admissions against the client.
 */
const NOT_LEGAL_ADVICE =
  'You are NOT the client\'s attorney and this is NOT legal advice; you form no ' +
  'attorney-client relationship. Do not render legal conclusions, opinions on ' +
  'liability, or litigation strategy. Improve only the factual precision, structure, ' +
  'and neutral framing of the safety documentation for the client\'s attorney to review.';

/** A compact, read-only digest of one finding for the executive-summary pass. */
export interface FindingDigest {
  item_code: string;
  section_code: string;
  /** The auditor's determination — context only, never re-judged. */
  rating: string;
  sif_potential: boolean;
  requirement: string;
  citation: string;
}

/** Read-only audit context for the executive-summary (attorney) pass. */
export interface BriefAuditContext {
  title: string;
  statePlan: string | null;
  auditorName?: string | null;
  overall: { rawScore: number; effectiveMax: number; percent: number | null; tier: string | null };
  findingCount: number;
  sifCount: number;
  highPlusCount: number;
}

/** Tags the executive-summary pass emits, one section per tag (parsed client-side). */
export const EXEC_SUMMARY_TAGS = ['EXEC_SUMMARY', 'METHODOLOGY', 'CHAIN_OF_CUSTODY', 'LIMITATIONS'] as const;
export type ExecSummaryTag = (typeof EXEC_SUMMARY_TAGS)[number];

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

// ————— Legal-grade findings report (two-agent: CSP → attorney) ————————————————
//
// The report brief is an AI-drafted narrative layer wrapping the deterministic
// report. Scores/ratings/citations are NEVER produced here — they come from the
// scoring engine and the seed library. These builders produce prose only, and a
// human accepts (and may edit) every section before it is stored (NN #2).

/**
 * CSP finding narrative — the Certified Safety Professional agent. Writes the
 * technical hazard/exposure/mechanism-of-harm characterization for ONE finding,
 * grounded strictly in the item's requirement, evidence protocol, and the
 * auditor's observation. Rating/SIF are severity context only. Emits no citations.
 */
export function buildCspFindingNarrative(
  item: GroundingItem,
  rating: string,
  observation: string,
  recommendation: string,
  sifPotential: boolean,
): BuiltPrompt {
  const system = [
    'You are a Certified Safety Professional (CSP) documenting the technical risk ',
    'narrative for ONE audit finding, for a formal findings report that the client\'s ',
    'attorney will review. In 130 words or fewer, characterize the hazard, the mechanism ',
    'of harm and who is exposed, and how the condition relates to the cited standard. ',
    'Ground every statement in the requirement, evidence protocol, and the auditor\'s ',
    'observation — do not speculate beyond them or invent facts. Neutral, precise, ',
    'non-inflammatory language. Return ONLY the narrative prose — no headings, no lists.\n',
    NEVER_RATE +
      ' The auditor\'s rating and SIF flag are context for severity framing only; never ' +
      'restate them as verdicts.\n',
    NO_INVENTED_LAW,
  ].join('');
  const user = [
    grounding(item),
    '',
    `Auditor's rating (context only, do not echo as a verdict): ${rating}`,
    `SIF (serious-injury-or-fatality) potential flagged by the auditor: ${sifPotential ? 'yes' : 'no'}`,
    `Auditor's observation: ${observation.trim() || '(none recorded)'}`,
    `Auditor's recommendation: ${recommendation.trim() || '(none recorded)'}`,
  ].join('\n');
  return { system, user, maxTokens: 700, kind: 'csp_finding_narrative' };
}

/**
 * Attorney review — the legal-readiness reviewer agent. Takes the CSP narrative
 * for one finding and refines it for legal defensibility: separates fact from
 * professional opinion, ties assertions to the cited standard, and strips
 * conclusory/liability-charged language. Not legal advice; never rates.
 */
export function buildAttorneyFindingReview(item: GroundingItem, cspNarrative: string): BuiltPrompt {
  const system = [
    'You are a legal-readiness reviewer refining one finding narrative so it is defensible ',
    'in a formal report. Rewrite the CSP narrative to: state observed facts and ',
    'professional opinion separately; tie each assertion to the cited standard or the ',
    'recorded observation; remove speculation and any conclusory or liability-charged ',
    'wording (e.g. "gross negligence", "knew", "willful", "reckless", "egregious"). ',
    'Preserve all concrete details. 130 words or fewer. Return ONLY the revised narrative ',
    '— no headings.\n',
    NOT_LEGAL_ADVICE + '\n',
    NEVER_RATE + '\n',
    NO_INVENTED_LAW,
  ].join('');
  const user = [
    grounding(item),
    '',
    'CSP narrative to refine for legal defensibility:',
    cspNarrative.trim(),
  ].join('\n');
  return { system, user, maxTokens: 700, kind: 'attorney_review' };
}

/**
 * Executive summary — the attorney agent's document-level pass. Emits four
 * tagged sections (EXEC_SUMMARY_TAGS) in one response, parsed client-side.
 * Uses only the read-only facts provided; states plainly that ratings/scores
 * were human-determined. Not legal advice; never rates; emits no citations.
 */
export function buildExecSummary(context: BriefAuditContext, findings: FindingDigest[]): BuiltPrompt {
  const overall =
    `${context.overall.rawScore} / ${context.overall.effectiveMax}` +
    (context.overall.percent == null ? '' : ` (${context.overall.percent.toFixed(1)}%)`) +
    (context.overall.tier ? `, tier ${context.overall.tier}` : '');
  const system = [
    'You are a legal-readiness reviewer preparing the front matter of a formal EHS audit ',
    'findings report for the client\'s attorney. Produce EXACTLY these four sections, each ',
    'introduced by its tag alone on its own line:\n',
    '[EXEC_SUMMARY] a counsel-facing summary of the overall posture and the material ',
    'findings and regulatory-exposure themes — do not restate every finding.\n',
    '[METHODOLOGY] how the audit was conducted: the standard/workbook basis, applicability ',
    'scoping, that scores were computed by a fixed, validated engine (not by AI), and the ',
    'audit\'s limitations.\n',
    '[CHAIN_OF_CUSTODY] an evidentiary-integrity attestation: every rating and edit is ',
    'captured as an immutable, timestamped, attributed event, and the item library version ',
    'was frozen at audit creation.\n',
    '[LIMITATIONS] that this is a point-in-time assessment of observed conditions and is ',
    'not exhaustive.\n',
    'You MUST state that all ratings and scores were determined by the qualified human ',
    'auditor, not by AI. Neutral, precise, non-conclusory language; use only the facts ',
    'given. Under ~450 words total.\n',
    NOT_LEGAL_ADVICE + '\n',
    NEVER_RATE + '\n',
    NO_INVENTED_LAW,
  ].join('');
  const digest = findings.length
    ? findings
        .map(
          (f) =>
            `${f.item_code} (${f.section_code}) rating=${f.rating}${f.sif_potential ? ' SIF' : ''} — ` +
            `standard ${f.citation}: ${f.requirement}`,
        )
        .join('\n')
    : '(no findings)';
  const user = [
    `Report title: ${context.title}`,
    `Jurisdiction: ${context.statePlan ?? 'Federal OSHA General Industry'}`,
    context.auditorName ? `Auditor: ${context.auditorName}` : '',
    `Overall (auditor-determined — context only, do not re-judge): ${overall}`,
    `Findings: ${context.findingCount} total · ${context.highPlusCount} High/Very High · ${context.sifCount} SIF-potential.`,
    '',
    'Findings digest (rating is the auditor\'s determination — context only):',
    digest,
  ]
    .filter(Boolean)
    .join('\n');
  return { system, user, maxTokens: 1400, kind: 'exec_summary' };
}

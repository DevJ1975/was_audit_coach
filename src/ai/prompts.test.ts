import { describe, it, expect } from 'vitest';
import {
  buildObservationPolish,
  buildRecommendationDraft,
  buildAriaCoach,
  buildCspFindingNarrative,
  buildAttorneyFindingReview,
  buildExecSummary,
  EXEC_SUMMARY_TAGS,
  type GroundingItem,
  type FindingDigest,
  type BriefAuditContext,
} from './prompts';

const ITEM: GroundingItem = {
  item_code: 'CS-2',
  requirement: 'Each identified permit-required confined space must be posted with danger signs.',
  evidence_protocol: 'Walk to 100% of identified PRCS and confirm signage is posted and legible.',
  citation: '29 CFR 1910.146(c)(2)',
};

// Words that would indicate the model was invited to render a verdict/rating.
const RATING_WORDS = /\b(rating|score|tier|non-?compliant|pass\/fail|Very High|assign a)\b/i;

describe('all prompt builders embed the item grounding', () => {
  const built = [
    buildObservationPolish(ITEM, 'saw a couple spaces with no signs'),
    buildRecommendationDraft(ITEM, 'Low', 'two PRCS lacked danger signs'),
    buildAriaCoach(ITEM, 'how many spaces do I need to check?'),
  ];
  it('includes requirement, evidence protocol, and citation in every prompt', () => {
    for (const p of built) {
      expect(p.user).toContain(ITEM.citation);
      expect(p.user).toContain('Regulatory requirement');
      expect(p.user).toContain('Evidence protocol');
      expect(p.user).toContain(ITEM.item_code);
    }
  });
  it('every system prompt forbids setting a rating (Non-Negotiable #2)', () => {
    for (const p of built) {
      expect(p.system).toMatch(/NEVER state, imply, suggest, or recommend a rating/i);
    }
  });
  it('bounds the output length', () => {
    for (const p of built) {
      expect(p.maxTokens).toBeGreaterThan(0);
      expect(p.maxTokens).toBeLessThanOrEqual(500);
    }
  });
});

describe('Observation Polish', () => {
  it('carries the raw dictation and an 80-word ceiling instruction', () => {
    const p = buildObservationPolish(ITEM, 'raw note here');
    expect(p.kind).toBe('observation_polish');
    expect(p.user).toContain('raw note here');
    expect(p.system).toMatch(/80 words or fewer/);
    expect(p.system).toMatch(/do NOT invent/i);
  });
});

describe('Recommendation Draft', () => {
  it('passes the rating as context only and forbids "develop a program" vagueness', () => {
    const p = buildRecommendationDraft(ITEM, 'High', 'obs text');
    expect(p.kind).toBe('recommendation_draft');
    expect(p.user).toMatch(/context only, do not echo as a verdict/i);
    expect(p.user).toContain('obs text');
    expect(p.system).toMatch(/develop a program/); // named as the anti-pattern to avoid
  });
});

describe('ARIA Coach', () => {
  it('restricts answers to the grounding and defines the not-covered fallback', () => {
    const p = buildAriaCoach(ITEM, 'q');
    expect(p.kind).toBe('aria_coach');
    expect(p.system).toMatch(/ONLY the regulatory requirement, evidence protocol, and citation/i);
    expect(p.system).toContain("isn't covered by this item's requirement");
  });
});

// ————— Legal-grade report brief (two-agent) ————————————————————————————————

const NEVER_RATE_RE = /NEVER state, imply, suggest, or recommend a rating/i;
const NO_LAW_RE = /Do NOT write any statute, CFR, or code section number/i;
const NOT_LEGAL_ADVICE_RE = /NOT legal advice/i;

describe('CSP finding narrative', () => {
  const p = buildCspFindingNarrative(ITEM, 'High', 'two PRCS lacked danger signs', 'post signage', true);
  it('is grounded, never rates, and never mints law', () => {
    expect(p.kind).toBe('csp_finding_narrative');
    expect(p.system).toMatch(/Certified Safety Professional/);
    expect(p.system).toMatch(NEVER_RATE_RE);
    expect(p.system).toMatch(NO_LAW_RE);
    expect(p.user).toContain(ITEM.citation);
    expect(p.user).toContain('Evidence protocol');
  });
  it('passes the rating and SIF flag as context only', () => {
    expect(p.user).toMatch(/context only, do not echo as a verdict/i);
    expect(p.user).toMatch(/SIF .* flagged by the auditor: yes/i);
    expect(p.user).toContain('two PRCS lacked danger signs');
  });
});

describe('Attorney finding review', () => {
  const p = buildAttorneyFindingReview(ITEM, 'The hazard is exposure to an engulfment risk.');
  it('is legal-readiness only (not legal advice), strips liability language, never rates', () => {
    expect(p.kind).toBe('attorney_review');
    expect(p.system).toMatch(NOT_LEGAL_ADVICE_RE);
    expect(p.system).toMatch(/gross negligence|willful|reckless/i); // named as words to remove
    expect(p.system).toMatch(NEVER_RATE_RE);
    expect(p.system).toMatch(NO_LAW_RE);
    expect(p.user).toContain('engulfment risk');
  });
});

describe('Executive summary', () => {
  const context: BriefAuditContext = {
    title: 'Acme Q3',
    statePlan: null,
    overall: { rawScore: 98.6, effectiveMax: 160, percent: 61.6, tier: 'Bronze' },
    findingCount: 2,
    sifCount: 1,
    highPlusCount: 1,
  };
  const digests: FindingDigest[] = [
    { item_code: 'CS-1', section_code: 'CS', rating: 'Very High', sif_potential: true, requirement: 'r', citation: '29 CFR 1910.146' },
  ];
  const p = buildExecSummary(context, digests);
  it('requests the four tagged sections and asserts human-determined scores', () => {
    expect(p.kind).toBe('exec_summary');
    for (const tag of EXEC_SUMMARY_TAGS) expect(p.system).toContain(`[${tag}]`);
    expect(p.system).toMatch(/ratings and scores were determined by the qualified human auditor, not\s+by AI/i);
    expect(p.system).toMatch(NOT_LEGAL_ADVICE_RE);
    expect(p.system).toMatch(NEVER_RATE_RE);
  });
  it('feeds the overall numbers and finding digest as read-only context', () => {
    expect(p.user).toMatch(/98\.6 \/ 160/);
    expect(p.user).toMatch(/do not re-judge/i);
    expect(p.user).toContain('CS-1');
  });
});

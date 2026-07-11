import { describe, it, expect } from 'vitest';
import {
  buildObservationPolish,
  buildRecommendationDraft,
  buildAriaCoach,
  type GroundingItem,
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

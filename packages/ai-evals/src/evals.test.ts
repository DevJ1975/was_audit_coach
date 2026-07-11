import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import {
  buildObservationPolish,
  buildRecommendationDraft,
  buildAriaCoach,
  type GroundingItem,
} from '@/ai/prompts';
import { checkDraft, hasNoRatingLanguage, citesOnlyAllowed, withinWordLimit } from './checks';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../../..');

// Golden set — synthetic raw notes grounded in a real library item.
const ITEM: GroundingItem = {
  item_code: 'CS-2',
  requirement: 'Each identified permit-required confined space must be posted with danger signs.',
  evidence_protocol: 'Walk 100% of identified PRCS; confirm signage is posted and legible.',
  citation: '29 CFR 1910.146(c)(2)',
};

describe('prompt builders satisfy the eval contract for a golden item', () => {
  it('every builder embeds grounding, forbids rating, and bounds length', () => {
    const prompts = [
      buildObservationPolish(ITEM, 'two of the tanks had no danger signs on the hatch'),
      buildRecommendationDraft(ITEM, 'Low', 'two PRCS lacked danger signs'),
      buildAriaCoach(ITEM, 'what percent of spaces must I check?'),
    ];
    for (const p of prompts) {
      expect(p.user).toContain(ITEM.citation); // grounding present
      expect(p.system).toMatch(/NEVER state, imply/i); // never-rate guardrail
      expect(p.maxTokens).toBeLessThanOrEqual(500); // bounded output
    }
  });
});

describe('checkDraft — a good draft passes all checks', () => {
  it('accepts a grounded, verdict-free, correctly-cited observation', () => {
    const good =
      'Two permit-required confined spaces were observed without posted danger signs at ' +
      'the tank hatches, per 29 CFR 1910.146(c)(2). The remaining spaces carried legible signage.';
    const r = checkDraft(good, ITEM.citation, 80);
    expect(r).toEqual({ withinLimit: true, noRatingLanguage: true, citationOk: true, invented: [] });
  });
});

describe('checkDraft — bad drafts are caught', () => {
  it('flags invented regulations (citation fidelity)', () => {
    const invented = 'Signage was missing, violating 29 CFR 1926.1200(a) and OSHA 1910.147.';
    const r = citesOnlyAllowed(invented, ITEM.citation);
    expect(r.ok).toBe(false);
    expect(r.invented.length).toBeGreaterThan(0);
  });

  it('flags rating / verdict language', () => {
    expect(hasNoRatingLanguage('This is a finding; I would rate it High.')).toBe(false);
    expect(hasNoRatingLanguage('The area was non-compliant.')).toBe(false);
    expect(hasNoRatingLanguage('Two spaces lacked danger signs.')).toBe(true);
  });

  it('flags overlong drafts', () => {
    const long = Array.from({ length: 120 }, () => 'word').join(' ');
    expect(withinWordLimit(long, 80)).toBe(false);
  });
});

// The load-bearing guard for Non-Negotiable #2: prove by static inspection that
// no AI code path can set a rating. AI text may only flow into repo.setText.
describe('NON-NEGOTIABLE #2: no code path lets AI set a rating', () => {
  const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');

  it('the AI client never references setRating', () => {
    expect(read('src/ai/client.ts')).not.toMatch(/setRating/);
    expect(read('src/ai/prompts.ts')).not.toMatch(/setRating/);
  });

  it('the item card only feeds accepted AI drafts into setText, not setRating', () => {
    const card = read('src/app/audit/[auditId]/item/[id].tsx');
    // Every setRating call is driven by the RatingSelector's onChange (onRate),
    // never by an AI draft. The AI accept handlers call setText with ai_generated.
    expect(card).toMatch(/setText\([^)]*ai_generated:\s*true/);
    // Guard: no line both requests an AI draft and sets a rating.
    for (const line of card.split('\n')) {
      if (/requestDraft|aiDraft|polish|ariaAnswer/i.test(line)) {
        expect(line).not.toMatch(/setRating/);
      }
    }
  });
});

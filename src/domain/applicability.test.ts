import { describe, it, expect } from 'vitest';
import { computeApplicableCodes, isQuestionActive, type ScopingQuestion } from './applicability.js';
import type { LibraryItem } from '@/db/types.js';

function lib(item_code: string, section_code: string): LibraryItem {
  return {
    item_code,
    section_code,
    subsection: null,
    requirement: `req ${item_code}`,
    evidence_protocol: `evid ${item_code}`,
    max_points: 8,
    citation: '29 CFR 1910.x',
    sif_potential: false,
    content_hash: item_code,
  };
}

const LIBRARY: LibraryItem[] = [
  lib('CS-1', 'CS'), // gated by PRCS question (section CS)
  lib('PIT-1', 'PIT'), // gated by forklift question (section PIT)
  lib('FP-16', 'FP'), // gated by an INVERTED question (item-level)
  lib('WW-1', 'WW'), // ungated baseline item — always applicable
];

const QUESTIONS: ScopingQuestion[] = [
  { key: 'q_prcs', question: 'Permit-required confined spaces?', activates: ['CS'] },
  { key: 'q_forklift', question: 'Forklifts?', activates: ['PIT'] },
  { key: 'q_standpipe', question: 'Standpipe systems?', activates: ['FP-16'], applies_on: 'No' },
];

describe('isQuestionActive polarity', () => {
  it('Yes-polarity: active only when answered Yes', () => {
    const q = QUESTIONS[0]!;
    expect(isQuestionActive(q, true)).toBe(true);
    expect(isQuestionActive(q, false)).toBe(false);
    expect(isQuestionActive(q, undefined)).toBe(false);
  });

  it('inverted No-polarity: active only when answered No', () => {
    const q = QUESTIONS[2]!;
    expect(isQuestionActive(q, false)).toBe(true);
    expect(isQuestionActive(q, true)).toBe(false);
  });
});

describe('computeApplicableCodes', () => {
  it('activates gated sections by their answers; baseline items always apply', () => {
    const applicable = computeApplicableCodes(LIBRARY, QUESTIONS, {
      q_prcs: true,
      q_forklift: false,
      q_standpipe: true, // Yes → inverted question inactive → FP-16 NOT applicable
    });
    expect(applicable.has('CS-1')).toBe(true); // PRCS yes
    expect(applicable.has('PIT-1')).toBe(false); // forklift no
    expect(applicable.has('FP-16')).toBe(false); // standpipe yes → inverted → inactive
    expect(applicable.has('WW-1')).toBe(true); // ungated baseline
  });

  it('inverted question activates its item on a No answer', () => {
    const applicable = computeApplicableCodes(LIBRARY, QUESTIONS, {
      q_prcs: false,
      q_forklift: true,
      q_standpipe: false, // No → inverted question active → FP-16 applies
    });
    expect(applicable.has('CS-1')).toBe(false);
    expect(applicable.has('PIT-1')).toBe(true);
    expect(applicable.has('FP-16')).toBe(true);
    expect(applicable.has('WW-1')).toBe(true);
  });
});

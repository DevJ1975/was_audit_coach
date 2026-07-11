import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  itemScore,
  effectiveMax,
  scoreSection,
  scoreAudit,
  tierFor,
  round1,
  isFinding,
  sortFindingsBySeverity,
  type ScorableItem,
} from './scoring.js';
import type { Rating } from './constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(
  __dirname,
  '../../../src/seed/pilot_validation_fixture.json',
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as {
  expected: { rawScore: number; effectiveMax: number; percent: number; tier: string };
  items: ScorableItem[];
};

describe('§1.2 SACRED validation case — Confined Space pilot data', () => {
  it('produces exactly 98.6 / 160 / 61.625% / Bronze', () => {
    const s = scoreSection(fixture.items);
    expect(s.rawScore).toBe(98.6);
    expect(s.effectiveMax).toBe(160);
    expect(s.percent).toBeCloseTo(61.625, 3);
    expect(s.tier).toBe('Bronze');
  });

  it('matches the expected block embedded in the fixture', () => {
    const s = scoreSection(fixture.items);
    expect(s.rawScore).toBe(fixture.expected.rawScore);
    expect(s.effectiveMax).toBe(fixture.expected.effectiveMax);
    expect(s.percent).toBeCloseTo(fixture.expected.percent, 3);
    expect(s.tier).toBe(fixture.expected.tier);
  });

  it('overall score of a single-section audit equals that section', () => {
    const overall = scoreAudit({ CS: fixture.items });
    expect(overall.rawScore).toBe(98.6);
    expect(overall.effectiveMax).toBe(160);
    expect(overall.percent).toBeCloseTo(61.625, 3);
    expect(overall.tier).toBe('Bronze');
  });
});

describe('round1 — matches workbook ROUND(x, 1)', () => {
  it('rounds half up to one decimal', () => {
    expect(round1(6 * 0.85)).toBe(5.1); // 5.1
    expect(round1(8 * 0.85)).toBe(6.8); // 6.8
    expect(round1(8 * 0.7)).toBe(5.6); // 5.6
    expect(round1(8 * 0.3)).toBe(2.4); // 2.4
    expect(round1(2.45)).toBe(2.5);
  });
});

describe('itemScore & effectiveMax semantics', () => {
  it('Not Applicable earns 0 and is excluded from the denominator', () => {
    const na: ScorableItem = { item_code: 'X-1', max_points: 10, rating: 'Not Applicable' };
    expect(itemScore(na)).toBe(0);
    expect(effectiveMax(na)).toBe(0);
  });

  it('an UNRATED item earns 0 but KEEPS its max in the denominator', () => {
    const unrated: ScorableItem = { item_code: 'X-2', max_points: 10, rating: null };
    expect(itemScore(unrated)).toBe(0);
    expect(effectiveMax(unrated)).toBe(10);
  });

  it('Best Practice and Verified both earn full points', () => {
    expect(itemScore({ item_code: 'X-3', max_points: 10, rating: 'Best Practice' })).toBe(10);
    expect(itemScore({ item_code: 'X-4', max_points: 10, rating: 'Verified' })).toBe(10);
  });

  it('Very High earns 0 but still counts toward the denominator', () => {
    const vh: ScorableItem = { item_code: 'X-5', max_points: 8, rating: 'Very High' };
    expect(itemScore(vh)).toBe(0);
    expect(effectiveMax(vh)).toBe(8);
  });
});

describe('section with all items N/A yields null score (denominator 0)', () => {
  it('returns null fraction/percent/tier', () => {
    const s = scoreSection([
      { item_code: 'Y-1', max_points: 6, rating: 'Not Applicable' },
      { item_code: 'Y-2', max_points: 8, rating: 'Not Applicable' },
    ]);
    expect(s.effectiveMax).toBe(0);
    expect(s.fraction).toBeNull();
    expect(s.percent).toBeNull();
    expect(s.tier).toBeNull();
  });
});

describe('tier thresholds', () => {
  it('maps fractions to the correct tier at each boundary', () => {
    expect(tierFor(0.99)).toBe('Excellence Leader');
    expect(tierFor(1.0)).toBe('Excellence Leader');
    expect(tierFor(0.9)).toBe('Gold');
    expect(tierFor(0.899)).toBe('Silver');
    expect(tierFor(0.8)).toBe('Silver');
    expect(tierFor(0.51)).toBe('Bronze');
    expect(tierFor(0.509)).toBe('Developing');
    expect(tierFor(0)).toBe('Developing');
  });
});

describe('findings', () => {
  it('classifies Low/Moderate/High/Very High as findings; others not', () => {
    const findings: Rating[] = ['Low', 'Moderate', 'High', 'Very High'];
    const notFindings: (Rating | null)[] = ['Best Practice', 'Verified', 'Not Applicable', null];
    for (const r of findings) expect(isFinding(r)).toBe(true);
    for (const r of notFindings) expect(isFinding(r)).toBe(false);
  });

  it('sorts findings Very High → High → Moderate → Low, stable within severity', () => {
    const input = [
      { item_code: 'A', rating: 'Low' as Rating },
      { item_code: 'B', rating: 'Very High' as Rating },
      { item_code: 'C', rating: 'Moderate' as Rating },
      { item_code: 'D', rating: 'High' as Rating },
      { item_code: 'E', rating: 'Very High' as Rating },
    ];
    const sorted = sortFindingsBySeverity(input).map((f) => f.item_code);
    expect(sorted).toEqual(['B', 'E', 'D', 'C', 'A']);
  });
});

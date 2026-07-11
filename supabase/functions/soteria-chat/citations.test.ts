import { describe, expect, it } from 'vitest';
import { resolveCitations, type RetrievedChunk } from './citations';

const chunk = (id: string, citation: string): [string, RetrievedChunk] => [
  id,
  {
    chunk_id: id,
    citation,
    heading_path: `Part › ${citation}`,
    jurisdiction: 'federal',
    source_url: `https://www.ecfr.gov/current/${id}`,
    last_amended: '2020-01-01',
  },
];

const retrieved = new Map([
  chunk('ecfr:1910.147#0', '29 CFR 1910.147'),
  chunk('ecfr:1910.147#3', '29 CFR 1910.147'),
  chunk('ecfr:1904.1#0', '29 CFR 1904.1'),
]);

describe('resolveCitations', () => {
  it('numbers verified citations in order of first appearance', () => {
    const r = resolveCitations(
      'LOTO requires training [c:ecfr:1910.147#0]. Small employers are exempt [c:ecfr:1904.1#0]. See also [c:ecfr:1910.147#0].',
      retrieved,
    );
    expect(r.text).toBe(
      'LOTO requires training [1]. Small employers are exempt [2]. See also [1].',
    );
    expect(r.citations.map((c) => [c.ref, c.citation])).toEqual([
      [1, '29 CFR 1910.147'],
      [2, '29 CFR 1904.1'],
    ]);
  });

  it('STRIPS citations the model invented (never retrieved this turn)', () => {
    const r = resolveCitations(
      'Machines must be guarded [c:ecfr:1910.212#0].',
      retrieved,
    );
    expect(r.text).toBe('Machines must be guarded.');
    expect(r.citations).toHaveLength(0);
  });

  it('merges two chunks of the same section into one reference', () => {
    const r = resolveCitations(
      'Scope [c:ecfr:1910.147#0] and periodic inspection [c:ecfr:1910.147#3].',
      retrieved,
    );
    expect(r.text).toBe('Scope [1] and periodic inspection [1].');
    expect(r.citations).toHaveLength(1);
    expect(r.citations[0]!.citation).toBe('29 CFR 1910.147');
  });

  it('collapses adjacent duplicate refs', () => {
    const r = resolveCitations(
      'Training is annual [c:ecfr:1910.147#0][c:ecfr:1910.147#3].',
      retrieved,
    );
    expect(r.text).toBe('Training is annual [1].');
  });

  it('returns prose untouched when there are no tokens', () => {
    const r = resolveCitations('I could not find that in the corpus.', retrieved);
    expect(r.text).toBe('I could not find that in the corpus.');
    expect(r.citations).toHaveLength(0);
  });

  it('carries source metadata through for the citation cards', () => {
    const r = resolveCitations('See [c:ecfr:1904.1#0].', retrieved);
    expect(r.citations[0]).toMatchObject({
      ref: 1,
      source_url: 'https://www.ecfr.gov/current/ecfr:1904.1#0',
      last_amended: '2020-01-01',
      jurisdiction: 'federal',
    });
  });
});

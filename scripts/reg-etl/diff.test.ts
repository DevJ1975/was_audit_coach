import { describe, expect, it } from 'vitest';
import { planLoad } from './diff';

const row = (id: string, content_hash: string) => ({ id, content_hash });

describe('planLoad (content_hash idempotency)', () => {
  it('plans zero writes when nothing changed — the re-run invariant', () => {
    const docs = [row('ecfr:1910.147', 'aaa'), row('ecfr:1904.1', 'bbb')];
    const plan = planLoad(docs, docs);
    expect(plan.create).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
    expect(plan.remove).toHaveLength(0);
    expect(plan.unchanged).toHaveLength(2);
  });

  it('classifies new, changed, and removed documents', () => {
    const existing = [row('a', 'h1'), row('b', 'h2'), row('c', 'h3')];
    const incoming = [row('a', 'h1'), row('b', 'CHANGED'), row('d', 'h4')];
    const plan = planLoad(existing, incoming);
    expect(plan.unchanged).toEqual(['a']);
    expect(plan.update).toEqual(['b']);
    expect(plan.create).toEqual(['d']);
    expect(plan.remove).toEqual(['c']);
  });

  it('handles a first run (nothing existing)', () => {
    const plan = planLoad([], [row('a', 'h1')]);
    expect(plan.create).toEqual(['a']);
    expect(plan.unchanged).toHaveLength(0);
  });
});

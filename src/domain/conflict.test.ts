import { describe, it, expect } from 'vitest';
import { lww, resolveRating, mergeAuditItem, type MergeableItem } from './conflict';
import type { Rating } from '@soteria/scoring-engine';

const T1 = '2026-07-11T10:00:00.000Z';
const T2 = '2026-07-11T11:00:00.000Z';

describe('lww — last-write-wins per field', () => {
  it('takes the newer value', () => {
    expect(lww({ value: 'a', at: T1 }, { value: 'b', at: T2 })).toBe('b');
    expect(lww({ value: 'a', at: T2 }, { value: 'b', at: T1 })).toBe('a');
  });
  it('breaks ties toward remote (server canonical)', () => {
    expect(lww({ value: 'local', at: T1 }, { value: 'remote', at: T1 })).toBe('remote');
  });
});

describe('resolveRating — NEVER silently overwrites a divergent rating', () => {
  it('agreement is not a conflict', () => {
    expect(resolveRating('High', 'High')).toEqual({ rating: 'High', needsResolution: false });
  });

  it('an unrated side yields to the side that rated (no base)', () => {
    expect(resolveRating(null, 'Low')).toEqual({ rating: 'Low', needsResolution: false });
    expect(resolveRating('Low', null)).toEqual({ rating: 'Low', needsResolution: false });
  });

  it('two different non-null ratings with no base → needs_resolution, keeps both candidates', () => {
    const r = resolveRating('High', 'Low');
    expect(r.needsResolution).toBe(true);
    expect(r.candidates).toEqual({ local: 'High', remote: 'Low' });
    expect(r.rating).toBe('High'); // displayed value unchanged; NOT silently overwritten
  });

  it('with base: only the side that changed wins (no conflict)', () => {
    // base High; local unchanged (High), remote changed to Low → remote wins
    expect(resolveRating('High', 'Low', 'High')).toEqual({ rating: 'Low', needsResolution: false });
    // base High; local changed to Moderate, remote unchanged (High) → local wins
    expect(resolveRating('Moderate', 'High', 'High')).toEqual({ rating: 'Moderate', needsResolution: false });
  });

  it('with base: both sides changed to different values → needs_resolution', () => {
    const r = resolveRating('Moderate', 'Low', 'High');
    expect(r.needsResolution).toBe(true);
    expect(r.candidates).toEqual({ local: 'Moderate', remote: 'Low' });
  });
});

function stamp<T>(value: T, at: string) {
  return { value, at };
}
function item(overrides: Partial<MergeableItem>): MergeableItem {
  return {
    rating: stamp<Rating | null>(null, T1),
    observations: stamp('', T1),
    recommendations: stamp('', T1),
    auditor_notes: stamp('', T1),
    applicable: stamp(true, T1),
    ai_generated: stamp(false, T1),
    ...overrides,
  };
}

describe('mergeAuditItem', () => {
  it('merges text fields by LWW and marks synced when rating agrees', () => {
    const local = item({
      observations: stamp('local obs', T2),
      recommendations: stamp('old rec', T1),
      rating: stamp<Rating | null>('Low', T1),
    });
    const remote = item({
      observations: stamp('remote obs', T1),
      recommendations: stamp('new rec', T2),
      rating: stamp<Rating | null>('Low', T2),
    });
    const merged = mergeAuditItem(local, remote);
    expect(merged.observations).toBe('local obs'); // local newer
    expect(merged.recommendations).toBe('new rec'); // remote newer
    expect(merged.rating).toBe('Low');
    expect(merged.sync_state).toBe('synced');
  });

  it('flags needs_resolution and preserves both ratings on divergence', () => {
    const local = item({ rating: stamp<Rating | null>('Very High', T2) });
    const remote = item({ rating: stamp<Rating | null>('Moderate', T2) });
    const merged = mergeAuditItem(local, remote);
    expect(merged.sync_state).toBe('needs_resolution');
    expect(merged.rating).toBe('Very High'); // local value retained, not overwritten
    expect(merged.ratingCandidates).toEqual({ local: 'Very High', remote: 'Moderate' });
  });
});

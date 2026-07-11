import { describe, it, expect } from 'vitest';
import { reconcile, type SyncItem } from './reconcile';
import type { MergeableItem } from '@/domain/conflict';
import type { Rating } from '@soteria/scoring-engine';

const T1 = '2026-07-11T10:00:00.000Z';
const T2 = '2026-07-11T11:00:00.000Z';

function fields(o: Partial<{ rating: [Rating | null, string]; obs: [string, string] }>): MergeableItem {
  return {
    rating: { value: o.rating?.[0] ?? null, at: o.rating?.[1] ?? T1 },
    observations: { value: o.obs?.[0] ?? '', at: o.obs?.[1] ?? T1 },
    recommendations: { value: '', at: T1 },
    auditor_notes: { value: '', at: T1 },
    applicable: { value: true, at: T1 },
    ai_generated: { value: false, at: T1 },
  };
}
function item(id: string, f: MergeableItem): SyncItem {
  return { id, audit_id: 'a1', item_code: id, fields: f };
}

describe('reconcile', () => {
  it('pushes local-only rows and applies remote-only rows', () => {
    const local = [item('L', fields({ rating: ['Low', T1] }))];
    const remote = [item('R', fields({ rating: ['High', T1] }))];
    const plan = reconcile(local, remote);
    expect(plan.pushToRemote.map((p) => p.id)).toEqual(['L']);
    expect(plan.applyLocal.map((p) => p.id)).toEqual(['R']);
    expect(plan.conflicts).toEqual([]);
  });

  it('remote-newer text is applied locally, not pushed', () => {
    const local = [item('X', fields({ obs: ['old', T1] }))];
    const remote = [item('X', fields({ obs: ['new', T2] }))];
    const plan = reconcile(local, remote);
    expect(plan.applyLocal.find((p) => p.id === 'X')?.merged.observations).toBe('new');
    expect(plan.pushToRemote).toEqual([]);
  });

  it('local-newer text is pushed, not overwritten locally', () => {
    const local = [item('X', fields({ obs: ['mine', T2] }))];
    const remote = [item('X', fields({ obs: ['theirs', T1] }))];
    const plan = reconcile(local, remote);
    expect(plan.pushToRemote.find((p) => p.id === 'X')?.merged.observations).toBe('mine');
    expect(plan.applyLocal).toEqual([]);
  });

  it('divergent ratings flag a conflict and are NOT pushed (never clobber the peer)', () => {
    const local = [item('X', fields({ rating: ['Very High', T2] }))];
    const remote = [item('X', fields({ rating: ['Moderate', T2] }))];
    const plan = reconcile(local, remote);
    expect(plan.conflicts).toEqual(['X']);
    expect(plan.pushToRemote).toEqual([]); // do not overwrite the remote rating
    const applied = plan.applyLocal.find((p) => p.id === 'X');
    expect(applied?.merged.sync_state).toBe('needs_resolution');
    expect(applied?.merged.rating).toBe('Very High'); // local value retained
  });

  it('an unrated side takes the peer rating without conflict', () => {
    const local = [item('X', fields({ rating: [null, T1] }))];
    const remote = [item('X', fields({ rating: ['Low', T2] }))];
    const plan = reconcile(local, remote);
    expect(plan.conflicts).toEqual([]);
    expect(plan.applyLocal.find((p) => p.id === 'X')?.merged.rating).toBe('Low');
  });
});

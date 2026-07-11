import { describe, it, expect } from 'vitest';
import { detectRepeatFindings, medianDaysToCloseBySeverity, isOverdue } from './analytics';
import type { CorrectiveAction } from '@/db/types';
import type { Rating } from '@soteria/scoring-engine';

describe('detectRepeatFindings', () => {
  it('flags item_codes that are findings across 2+ audits, most-frequent first', () => {
    const repeats = detectRepeatFindings([
      { audit_id: 'a1', item_codes: ['CS-1', 'CS-2', 'PP-1'] },
      { audit_id: 'a2', item_codes: ['CS-1', 'PP-1'] },
      { audit_id: 'a3', item_codes: ['CS-1'] },
    ]);
    expect(repeats.map((r) => r.item_code)).toEqual(['CS-1', 'PP-1']);
    expect(repeats[0]).toMatchObject({ item_code: 'CS-1', count: 3 });
    expect(repeats[1]).toMatchObject({ item_code: 'PP-1', count: 2 });
  });

  it('returns nothing when no item repeats', () => {
    expect(detectRepeatFindings([{ audit_id: 'a1', item_codes: ['CS-1'] }, { audit_id: 'a2', item_codes: ['CS-2'] }])).toEqual([]);
  });
});

function ca(rating: Rating, created: string, close: string | null, status: CorrectiveAction['status']): CorrectiveAction {
  return {
    id: `${rating}-${created}`, org_id: 'o', audit_id: 'a', audit_item_id: 'i', rating,
    assigned_to: null, due_date: null, status, verified_by: null, close_date: close,
    closure_evidence_attachment_id: null, created_at: created, updated_at: created,
  };
}

describe('medianDaysToCloseBySeverity', () => {
  it('computes the median close time per severity for closed CAs only', () => {
    const result = medianDaysToCloseBySeverity([
      ca('High', '2026-07-01T00:00:00Z', '2026-07-05T00:00:00Z', 'closed'), // 4d
      ca('High', '2026-07-01T00:00:00Z', '2026-07-11T00:00:00Z', 'closed'), // 10d
      ca('High', '2026-07-01T00:00:00Z', '2026-07-13T00:00:00Z', 'closed'), // 12d → median 10
      ca('Low', '2026-07-01T00:00:00Z', '2026-07-03T00:00:00Z', 'closed'), // 2d
      ca('Low', '2026-07-01T00:00:00Z', null, 'open'), // ignored (not closed)
    ]);
    expect(result.High).toBe(10);
    expect(result.Low).toBe(2);
  });
});

describe('isOverdue', () => {
  const now = '2026-07-11T00:00:00Z';
  it('is true only for open/in-progress CAs past their due date', () => {
    expect(isOverdue({ ...ca('High', now, null, 'open'), due_date: '2026-07-01' }, now)).toBe(true);
    expect(isOverdue({ ...ca('High', now, null, 'open'), due_date: '2026-08-01' }, now)).toBe(false);
    expect(isOverdue({ ...ca('High', now, '2026-07-10', 'closed'), due_date: '2026-07-01' }, now)).toBe(false);
    expect(isOverdue({ ...ca('High', now, null, 'open'), due_date: null }, now)).toBe(false);
  });
});

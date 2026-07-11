/**
 * Analytics seeds (Phase 5, task 4). Pure functions over the immutable event /
 * CA record. Two starter signals: repeat-finding detection across audits of the
 * same facility, and median days-to-close by severity.
 */
import type { FindingRating } from '@soteria/scoring-engine';
import type { CorrectiveAction } from '@/db/types';

export interface AuditFindingSet {
  audit_id: string;
  /** item_codes that were findings (Low+) in this audit. */
  item_codes: string[];
}

export interface RepeatFinding {
  item_code: string;
  auditIds: string[];
  count: number;
}

/**
 * Given the finding sets for audits OF THE SAME FACILITY, return item_codes that
 * recur as findings across two or more audits — the repeat-offender signal.
 */
export function detectRepeatFindings(audits: AuditFindingSet[]): RepeatFinding[] {
  const byCode = new Map<string, Set<string>>();
  for (const a of audits) {
    for (const code of a.item_codes) {
      let set = byCode.get(code);
      if (!set) {
        set = new Set();
        byCode.set(code, set);
      }
      set.add(a.audit_id);
    }
  }
  return [...byCode.entries()]
    .filter(([, ids]) => ids.size >= 2)
    .map(([item_code, ids]) => ({ item_code, auditIds: [...ids], count: ids.size }))
    .sort((a, b) => b.count - a.count || a.item_code.localeCompare(b.item_code, undefined, { numeric: true }));
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const MS_PER_DAY = 86_400_000;

/**
 * Median days from CA creation to close, grouped by the finding severity.
 * Only closed CAs with both timestamps are counted.
 */
export function medianDaysToCloseBySeverity(
  cas: CorrectiveAction[],
): Partial<Record<FindingRating, number>> {
  const byRating = new Map<FindingRating, number[]>();
  for (const ca of cas) {
    if (ca.status !== 'closed' || !ca.close_date) continue;
    const created = Date.parse(ca.created_at);
    const closed = Date.parse(ca.close_date);
    if (Number.isNaN(created) || Number.isNaN(closed)) continue;
    const days = Math.max(0, Math.round((closed - created) / MS_PER_DAY));
    const rating = ca.rating as FindingRating;
    (byRating.get(rating) ?? byRating.set(rating, []).get(rating)!).push(days);
  }
  const out: Partial<Record<FindingRating, number>> = {};
  for (const [rating, days] of byRating) out[rating] = median(days);
  return out;
}

/** True when a CA is open/in-progress and its due date is in the past. */
export function isOverdue(ca: CorrectiveAction, nowIso: string): boolean {
  if (ca.status === 'closed' || ca.status === 'verified' || !ca.due_date) return false;
  return Date.parse(ca.due_date) < Date.parse(nowIso);
}

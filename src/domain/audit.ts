/**
 * Audit-assembly domain logic — pure builders and derivations. No storage,
 * no platform. The repo persists what these produce; screens read the
 * derivations (findings, CA queue) through the repo seam.
 */
import {
  scoreAudit,
  isFinding,
  sortFindingsBySeverity,
  type OverallScore,
  type Rating,
} from '@soteria/scoring-engine';
import type { AuditItem, CorrectiveAction, LibraryItem } from '@/db/types';

/** Group applicable audit items by section for the scoring engine. */
export function itemsBySection(
  auditItems: AuditItem[],
  library: Map<string, LibraryItem>,
): Record<string, { item_code: string; max_points: number; rating: Rating | null }[]> {
  const out: Record<string, { item_code: string; max_points: number; rating: Rating | null }[]> = {};
  for (const ai of auditItems) {
    if (!ai.applicable) continue; // deactivated items are not scored
    const lib = library.get(ai.item_code);
    if (!lib) continue;
    (out[ai.section_code] ??= []).push({
      item_code: ai.item_code,
      max_points: lib.max_points,
      rating: ai.rating,
    });
  }
  return out;
}

/** Live overall + per-section score for an audit. */
export function scoreForAudit(
  auditItems: AuditItem[],
  library: Map<string, LibraryItem>,
): OverallScore {
  return scoreAudit(itemsBySection(auditItems, library));
}

export interface Finding {
  audit_item_id: string;
  item_code: string;
  section_code: string;
  rating: Rating; // always a finding rating
  requirement: string;
  citation: string;
  observations: string;
  recommendations: string;
  sif_potential: boolean;
}

/**
 * Findings = every applicable item rated Low/Moderate/High/Very High, sorted
 * Very High → High → Moderate → Low (the report + CA queue order).
 */
export function deriveFindings(
  auditItems: AuditItem[],
  library: Map<string, LibraryItem>,
): Finding[] {
  const findings: Finding[] = [];
  for (const ai of auditItems) {
    if (!ai.applicable || !isFinding(ai.rating)) continue;
    const lib = library.get(ai.item_code);
    if (!lib) continue;
    findings.push({
      audit_item_id: ai.id,
      item_code: ai.item_code,
      section_code: ai.section_code,
      rating: ai.rating,
      requirement: lib.requirement,
      citation: lib.citation,
      observations: ai.observations,
      recommendations: ai.recommendations,
      sif_potential: lib.sif_potential,
    });
  }
  return sortFindingsBySeverity(findings);
}

/**
 * Reconcile the corrective-action queue against current findings.
 * Every finding gets a CA (auto-populated). Existing CAs are preserved (keep
 * assignee/status/etc.); CAs whose item is no longer a finding are returned as
 * `orphaned` so the caller can decide (typically close/remove). New CAs are
 * created open. Result is severity-sorted for the CA surface.
 */
export interface CAReconciliation {
  create: Array<Pick<CorrectiveAction, 'audit_item_id' | 'rating'>>;
  keep: CorrectiveAction[];
  orphaned: CorrectiveAction[];
}

export function reconcileCorrectiveActions(
  findings: Finding[],
  existing: CorrectiveAction[],
): CAReconciliation {
  const byItem = new Map(existing.map((ca) => [ca.audit_item_id, ca]));
  const findingItems = new Set(findings.map((f) => f.audit_item_id));

  const create: CAReconciliation['create'] = [];
  const keep: CorrectiveAction[] = [];
  for (const f of findings) {
    const ca = byItem.get(f.audit_item_id);
    if (ca) keep.push({ ...ca, rating: f.rating });
    else create.push({ audit_item_id: f.audit_item_id, rating: f.rating });
  }
  const orphaned = existing.filter((ca) => !findingItems.has(ca.audit_item_id));
  return { create, keep, orphaned };
}

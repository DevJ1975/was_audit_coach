/**
 * Idempotent load planning (Phase C1). Pure diff over `content_hash` — the same
 * versioning pattern as the item library. Re-running the ETL against an
 * unchanged eCFR issue must plan zero writes; the freshness cron (Phase C7)
 * reuses this to touch only what actually changed.
 */

export interface HashRow {
  id: string;
  content_hash: string;
}

export interface LoadPlan {
  create: string[];    // new document ids
  update: string[];    // existing ids whose content_hash changed
  unchanged: string[];
  remove: string[];    // ids no longer present upstream (e.g. newly reserved)
}

export function planLoad(existing: HashRow[], incoming: HashRow[]): LoadPlan {
  const have = new Map(existing.map((r) => [r.id, r.content_hash]));
  const seen = new Set<string>();
  const plan: LoadPlan = { create: [], update: [], unchanged: [], remove: [] };

  for (const row of incoming) {
    seen.add(row.id);
    const prior = have.get(row.id);
    if (prior === undefined) plan.create.push(row.id);
    else if (prior !== row.content_hash) plan.update.push(row.id);
    else plan.unchanged.push(row.id);
  }
  for (const row of existing) {
    if (!seen.has(row.id)) plan.remove.push(row.id);
  }
  return plan;
}

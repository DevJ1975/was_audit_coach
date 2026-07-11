/**
 * Corrective-action queue (Phase 5). Auto-populates from findings (Low+),
 * severity-sorted, and persists through the repo seam. Loads on focus with
 * stable deps so it never loops on the derived findings array.
 */
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useRepo, useSession } from '@/db/RepoProvider';
import { libraryByCode } from '@/seed';
import { deriveFindings, reconcileCorrectiveActions } from '@/domain/audit';
import { newId, nowIso } from '@/db/ids';
import { sortFindingsBySeverity } from '@soteria/scoring-engine';
import type { Audit, CorrectiveAction } from '@/db/types';

export interface CaItemMeta {
  item_code: string;
  requirement: string;
  sif_potential: boolean;
}

export function useCorrectiveActions(auditId: string): {
  audit: Audit | null;
  cas: CorrectiveAction[];
  itemMeta: Record<string, CaItemMeta>;
  update: (ca: CorrectiveAction) => Promise<void>;
  reload: () => Promise<void>;
} {
  const repo = useRepo();
  const session = useSession();
  const [audit, setAudit] = useState<Audit | null>(null);
  const [cas, setCas] = useState<CorrectiveAction[]>([]);
  const [itemMeta, setItemMeta] = useState<Record<string, CaItemMeta>>({});

  const load = useCallback(async () => {
    const [a, items] = await Promise.all([repo.getAudit(auditId), repo.getAuditItems(auditId)]);
    const findings = deriveFindings(items, libraryByCode);

    const meta: Record<string, CaItemMeta> = {};
    for (const it of items) {
      const lib = libraryByCode.get(it.item_code);
      meta[it.id] = {
        item_code: it.item_code,
        requirement: lib?.requirement ?? '',
        sif_potential: lib?.sif_potential ?? false,
      };
    }
    const existing = await repo.listCorrectiveActions(auditId);
    const plan = reconcileCorrectiveActions(findings, existing);

    // Create a CA for every new finding; refresh the rating on kept ones.
    for (const c of plan.create) {
      const ts = nowIso();
      await repo.upsertCorrectiveAction({
        id: newId(), org_id: session.org_id, audit_id: auditId, audit_item_id: c.audit_item_id,
        rating: c.rating, assigned_to: null, due_date: null, status: 'open',
        verified_by: null, close_date: null, closure_evidence_attachment_id: null,
        created_at: ts, updated_at: ts,
      });
    }
    for (const k of plan.keep) await repo.upsertCorrectiveAction(k);

    const fresh = await repo.listCorrectiveActions(auditId);
    setAudit(a);
    setItemMeta(meta);
    setCas(sortFindingsBySeverity(fresh));
  }, [repo, auditId, session.org_id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const update = useCallback(
    async (ca: CorrectiveAction) => {
      await repo.upsertCorrectiveAction(ca);
      await load();
    },
    [repo, load],
  );

  return { audit, cas, itemMeta, update, reload: load };
}

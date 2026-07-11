/**
 * Thin data hooks over the repo seam. Reads hit local SQLite and resolve
 * instantly offline; screens reload on focus so live scores stay current.
 */
import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useRepo } from '@/db/RepoProvider';
import { useSession } from '@/db/RepoProvider';
import type { Audit, AuditItem } from '@/db/types';
import { libraryByCode } from '@/seed';
import { scoreForAudit, deriveFindings, type Finding } from '@/domain/audit';
import type { OverallScore } from '@soteria/scoring-engine';

export function useAudits(): { audits: Audit[]; loading: boolean; reload: () => void } {
  const repo = useRepo();
  const session = useSession();
  const [audits, setAudits] = useState<Audit[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    let active = true;
    setLoading(true);
    repo
      .listAudits(session.org_id)
      .then((a) => active && setAudits(a))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [repo, session.org_id]);

  useFocusEffect(useCallback(() => reload(), [reload]));
  return { audits, loading, reload };
}

export interface AuditData {
  audit: Audit | null;
  items: AuditItem[];
  score: OverallScore;
  findings: Finding[];
  loading: boolean;
  reload: () => void;
}

export function useAuditData(auditId: string): AuditData {
  const repo = useRepo();
  const [audit, setAudit] = useState<Audit | null>(null);
  const [items, setItems] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [a, its] = await Promise.all([repo.getAudit(auditId), repo.getAuditItems(auditId)]);
    setAudit(a);
    setItems(its);
    setLoading(false);
  }, [repo, auditId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const score = scoreForAudit(items, libraryByCode);
  const findings = deriveFindings(items, libraryByCode);
  return { audit, items, score, findings, loading, reload: () => void load() };
}

/** Load a single audit item + subscribe to a reload trigger (Item Card). */
export function useAuditItem(itemId: string): {
  item: AuditItem | null;
  loading: boolean;
  reload: () => Promise<void>;
} {
  const repo = useRepo();
  const [item, setItem] = useState<AuditItem | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const it = await repo.getAuditItem(itemId);
    setItem(it);
    setLoading(false);
  }, [repo, itemId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { item, loading, reload };
}

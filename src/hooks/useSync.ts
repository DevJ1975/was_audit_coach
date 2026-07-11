/**
 * useSync — a manual "sync now" trigger for one audit. Offline-first: when no
 * backend/session is present it is simply unavailable and the audit loop is
 * unaffected. Pushes the audit header (so the FK exists) then reconciles items.
 */
import { useCallback, useMemo, useState } from 'react';
import { useRepo } from '@/db/RepoProvider';
import { createSync } from '@/db/sync';
import type { SyncSummary } from '@/db/sync';

export function useSync(auditId: string): {
  sync: () => Promise<void>;
  syncing: boolean;
  summary: SyncSummary | null;
  available: boolean;
} {
  const repo = useRepo();
  // One engine per repo instance so the pull cursor persists across the session.
  const { engine, remote } = useMemo(() => createSync(repo), [repo]);
  const [syncing, setSyncing] = useState(false);
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const available = remote.isAvailable();

  const sync = useCallback(async () => {
    if (!available || syncing) return;
    setSyncing(true);
    try {
      const audit = await repo.getAudit(auditId);
      if (audit) {
        await remote.upsertAudit({
          id: audit.id, org_id: audit.org_id, title: audit.title, status: audit.status,
          privileged: audit.privileged, attorney_of_record: audit.attorney_of_record,
          state_plan: audit.state_plan, library_version_id: audit.library_version_id,
          updated_at: audit.updated_at,
        });
      }
      setSummary(await engine.syncAudit(auditId));
    } finally {
      setSyncing(false);
    }
  }, [available, syncing, repo, engine, remote, auditId]);

  return { sync, syncing, summary, available };
}

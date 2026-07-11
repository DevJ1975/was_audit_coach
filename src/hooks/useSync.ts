/**
 * useSync — a manual "sync now" trigger for one audit. Offline-first: when no
 * backend/session is present the audit loop is unaffected; sync is deferred,
 * never blocking — and never silent: failures surface as `error`, a skipped
 * run (availability lost between render and tap) surfaces as `skipped`, and a
 * configured-but-signed-out build reports `signInNeeded` so the screen routes
 * to login instead of showing a dead button.
 */
import { useCallback, useMemo, useState } from 'react';
import { useRepo } from '@/db/RepoProvider';
import { useAuth } from '@/auth/AuthProvider';
import { isBackendConfigured, hasSession } from '@/db/supabase';
import { createSync, runFullSync, errorMessage, type FullSyncResult } from '@/db/sync';

export function useSync(auditId: string): {
  sync: () => Promise<void>;
  syncing: boolean;
  result: FullSyncResult | null;
  error: string | null;
  available: boolean;
  signInNeeded: boolean;
} {
  const repo = useRepo();
  // Subscribing to auth context makes availability REACTIVE: sign-in/out and
  // the cold-start INITIAL_SESSION all re-render this hook, so the button
  // state never depends on an incidental re-render elsewhere.
  useAuth();
  // Bundle is a per-repo singleton — the pull cursor survives remounts.
  const { remote } = useMemo(() => createSync(repo), [repo]);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<FullSyncResult | null>(null);
  const available = remote.isAvailable();
  const signInNeeded = isBackendConfigured && !hasSession();

  const sync = useCallback(async () => {
    if (!available || syncing) return;
    setSyncing(true);
    try {
      setResult(await runFullSync(repo, auditId));
    } catch (e) {
      // runFullSync guards each step, so this is unexpected — still never silent.
      setResult({ skipped: false, items: null, evidence: null, eventsPushed: 0, error: errorMessage(e) });
    } finally {
      setSyncing(false);
    }
  }, [available, syncing, repo, auditId]);

  return { sync, syncing, result, error: result?.error ?? null, available, signInNeeded };
}

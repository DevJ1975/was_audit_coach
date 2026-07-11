/**
 * useCloudPull — discover audits that exist on the server but not on this
 * device (a teammate's audit, or this user's own after a reinstall) and
 * materialize them locally. Manual trigger on the audit list; available only
 * when signed in. Without this, sync was single-device-outbound only and a
 * lost device meant lost data even though everything was on the server.
 */
import { useCallback, useMemo, useState } from 'react';
import { useRepo } from '@/db/RepoProvider';
import { useAuth } from '@/auth/AuthProvider';
import { createSync, pullRemoteAudits, type CloudPullResult } from '@/db/sync';

export function useCloudPull(onDone?: () => void): {
  pull: () => Promise<void>;
  pulling: boolean;
  result: CloudPullResult | null;
  available: boolean;
} {
  const repo = useRepo();
  // Auth subscription keeps `available` reactive to sign-in/out (see useSync).
  useAuth();
  const { remote } = useMemo(() => createSync(repo), [repo]);
  const [pulling, setPulling] = useState(false);
  const [result, setResult] = useState<CloudPullResult | null>(null);

  const pull = useCallback(async () => {
    if (pulling) return;
    setPulling(true);
    try {
      const r = await pullRemoteAudits(repo);
      setResult(r);
      if (r.added > 0) onDone?.();
    } finally {
      setPulling(false);
    }
  }, [repo, pulling, onDone]);

  return { pull, pulling, result, available: remote.isAvailable() };
}

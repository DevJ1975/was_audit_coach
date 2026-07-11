/**
 * useDeleteAudit — destructive, so the UI drives a two-tap confirm and this
 * hook does the work: server first when signed in (rows cascade via FKs;
 * Storage objects best-effort), then the local cascade, then the local
 * evidence files. Offline/local-only audits just delete locally; an audit
 * that DID sync and is deleted offline can reappear via "Check cloud" — the
 * confirm copy says which kind of delete this is.
 */
import { useCallback, useMemo, useState } from 'react';
import { useRepo } from '@/db/RepoProvider';
import { useAuth } from '@/auth/AuthProvider';
import { createSync, errorMessage } from '@/db/sync';
import { deleteEvidenceFile } from '@/attachments/capture';

export function useDeleteAudit(): {
  deleteAudit: (auditId: string) => Promise<boolean>;
  deleting: boolean;
  error: string | null;
  /** True when the delete will also remove the audit from the cloud. */
  cloudDelete: boolean;
} {
  const repo = useRepo();
  useAuth(); // keep cloudDelete reactive to sign-in/out
  const { remote, evidence } = useMemo(() => createSync(repo), [repo]);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteAudit = useCallback(
    async (auditId: string): Promise<boolean> => {
      if (deleting) return false;
      setDeleting(true);
      setError(null);
      try {
        if (remote.isAvailable()) {
          // Storage objects don't cascade with the rows — collect paths first.
          const paths = (await repo.listAuditAttachments(auditId))
            .map((a) => a.storage_path)
            .filter((p): p is string => !!p);
          await remote.deleteAudit(auditId); // server rows cascade
          if (paths.length) {
            try {
              await evidence.deleteEvidence(paths);
            } catch {
              // Orphaned Storage objects cost pennies; the audit data is gone.
            }
          }
        }
        const { evidenceUris } = await repo.deleteAudit(auditId);
        for (const uri of evidenceUris) void deleteEvidenceFile(uri);
        return true;
      } catch (e) {
        setError(errorMessage(e));
        return false;
      } finally {
        setDeleting(false);
      }
    },
    [repo, remote, evidence, deleting],
  );

  return { deleteAudit, deleting, error, cloudDelete: remote.isAvailable() };
}

/**
 * Attachments for one audit item — all reads/writes go through the repo seam,
 * so every add/remove lands in SQLite instantly (offline-first) and appends an
 * immutable event (attachment_added / attachment_removed).
 */
import { useCallback, useEffect, useState } from 'react';
import { useRepo, useSession } from '@/db/RepoProvider';
import type { Attachment, AttachmentKind } from '@/db/types';

export function useAttachments(auditItemId: string): {
  attachments: Attachment[];
  add: (kind: AttachmentKind, uri: string, transcription?: string) => Promise<void>;
  remove: (attachmentId: string) => Promise<void>;
} {
  const repo = useRepo();
  const session = useSession();
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const reload = useCallback(async () => {
    setAttachments(await repo.listAttachments(auditItemId));
  }, [repo, auditItemId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const add = useCallback(
    async (kind: AttachmentKind, uri: string, transcription?: string) => {
      await repo.addAttachment(auditItemId, kind, uri, session.user_id, transcription ?? null);
      await reload();
    },
    [repo, auditItemId, session.user_id, reload],
  );

  const remove = useCallback(
    async (attachmentId: string) => {
      await repo.removeAttachment(attachmentId, session.user_id);
      await reload();
    },
    [repo, session.user_id, reload],
  );

  return { attachments, add, remove };
}

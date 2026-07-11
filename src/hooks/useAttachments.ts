/**
 * Attachments for one audit item — all reads/writes go through the repo seam,
 * so every add/remove lands in SQLite instantly (offline-first) and appends an
 * immutable event (attachment_added / attachment_removed).
 *
 * `resolveUri` makes remote-only evidence viewable: a row pulled from sync has
 * no local file (uri ''), so viewing signs a short-lived Storage URL from its
 * storage_path. Local files short-circuit without touching the network.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRepo, useSession } from '@/db/RepoProvider';
import { createSync } from '@/db/sync';
import type { Attachment, AttachmentKind } from '@/db/types';

/** Signed URLs outlive any realistic viewing session but expire same-shift. */
const SIGNED_URL_TTL_SEC = 3600;

export function useAttachments(auditItemId: string): {
  attachments: Attachment[];
  add: (kind: AttachmentKind, uri: string, transcription?: string) => Promise<void>;
  remove: (attachmentId: string) => Promise<void>;
  /** Viewable URI for an attachment: local file, or a signed Storage URL. */
  resolveUri: (att: Attachment) => Promise<string | null>;
} {
  const repo = useRepo();
  const session = useSession();
  const { evidence } = useMemo(() => createSync(repo), [repo]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const reload = useCallback(async () => {
    setAttachments(await repo.listAttachments(auditItemId));
  }, [repo, auditItemId]);

  const resolveUri = useCallback(
    async (att: Attachment): Promise<string | null> => {
      if (att.uri) return att.uri;
      if (!att.storage_path || !evidence.isAvailable()) return null;
      return evidence.createSignedUrl(att.storage_path, SIGNED_URL_TTL_SEC);
    },
    [evidence],
  );

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

  return { attachments, add, remove, resolveUri };
}

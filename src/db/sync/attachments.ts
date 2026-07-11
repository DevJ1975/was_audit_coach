/**
 * AttachmentSync (Phase 4 transport) — pushes captured evidence to Storage and
 * its metadata row to the server, then reconciles removals. Deliberately kept
 * apart from SyncEngine (audit-item sync) so the CI-tested reconcile core is
 * untouched; this layer is the evidence upload loop only.
 *
 * Offline-first (NN #3): capture already wrote the file + row to SQLite; this
 * runs later, when connectivity exists, and is a no-op when the remote is
 * unavailable. Every file is best-effort and independent — one unreadable photo
 * or a dropped connection fails just that row (counted), never the whole batch,
 * and the next sync retries it (uploads are id-idempotent upserts).
 *
 * Direction is upload-only for now: pulling attachments authored on *another*
 * device (and resolving them to signed URLs for viewing) is the next increment.
 */
import type { Attachment, AttachmentKind } from '@/db/types';
import type { EvidenceRemote, EvidenceBlob, RemoteAttachment } from './remote';

/** The slice of the repo the attachment sync needs. The real Repo satisfies it. */
export interface AttachmentLocal {
  /** Pending uploads whose PARENT ITEM already reached the server (FK-safe). */
  listPendingUploads(): Promise<Attachment[]>;
  markAttachmentSynced(attachment_id: string, storage_path: string): Promise<void>;
  listPendingRemovals(): Promise<Attachment[]>;
  purgeAttachment(attachment_id: string): Promise<void>;
  applyRemoteAttachments(rows: Attachment[]): Promise<void>;
}

/** Reads a durable local file into upload-ready bytes (capture.loadForUpload). */
export type LoadForUpload = (uri: string) => Promise<EvidenceBlob>;

export interface AttachmentSyncSummary {
  skipped: boolean;
  uploaded: number;
  removed: number;
  /** Metadata rows pulled from the server (evidence captured elsewhere). */
  pulled: number;
  /** Rows that errored this pass; they stay pending and retry next sync. */
  failed: number;
}

/** The file extension of a uri (lower-case, ≤5 chars), or 'dat' when absent. */
export function extFromUri(uri: string): string {
  const base = uri.split('?')[0]!.split('#')[0]!;
  const dot = base.lastIndexOf('.');
  const slash = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'));
  // No dot, a dot that's part of a directory name, or a leading dot ⇒ no ext.
  if (dot <= slash + 1) return 'dat';
  return base.slice(dot + 1).toLowerCase().slice(0, 5);
}

/**
 * Tenant-scoped Storage object path: `org_id/audit_item_id/attachment_id.ext`.
 * The leading org_id segment is what the `evidence` bucket RLS policy checks, so
 * this layout is load-bearing for isolation, not just tidiness.
 */
export function evidencePath(att: Pick<Attachment, 'org_id' | 'audit_item_id' | 'id' | 'uri'>): string {
  return `${att.org_id}/${att.audit_item_id}/${att.id}.${extFromUri(att.uri)}`;
}

function toRemoteRow(att: Attachment, storage_path: string): RemoteAttachment {
  return {
    id: att.id, org_id: att.org_id, audit_item_id: att.audit_item_id,
    kind: att.kind, storage_path, transcription: att.transcription, created_at: att.created_at,
  };
}

export class AttachmentSync {
  constructor(
    private readonly local: AttachmentLocal,
    private readonly remote: EvidenceRemote,
    private readonly loadFile: LoadForUpload,
  ) {}

  /**
   * One evidence pass. Uploads and removals are GLOBAL — the repo's
   * listPendingUploads is FK-safe by construction (only evidence whose parent
   * item already reached the server), so photos captured in audit A flush on
   * ANY sync once A's items have pushed, never stranding evidence behind the
   * one audit the user happens to open. When `auditId` is given, remote
   * metadata for that audit is also pulled, so evidence captured on other
   * devices becomes visible here (bytes stay in Storage; the UI signs URLs on
   * demand).
   */
  async syncAttachments(auditId?: string): Promise<AttachmentSyncSummary> {
    if (!this.remote.isAvailable()) {
      return { skipped: true, uploaded: 0, removed: 0, pulled: 0, failed: 0 };
    }
    let uploaded = 0;
    let removed = 0;
    let pulled = 0;
    let failed = 0;

    // Removals first — free the Storage object + server row for tombstoned
    // attachments, then purge the local row. Ordering before uploads keeps a
    // just-deleted item from being re-examined as pending.
    for (const att of await this.local.listPendingRemovals()) {
      try {
        if (att.storage_path) await this.remote.deleteEvidence([att.storage_path]);
        await this.remote.deleteAttachments([att.id]);
        await this.local.purgeAttachment(att.id);
        removed++;
      } catch {
        failed++;
      }
    }

    // Uploads — bytes to Storage, then the metadata row, then flip to synced.
    // Each step is idempotent so a retry after a partial failure is safe.
    for (const att of await this.local.listPendingUploads()) {
      try {
        const path = evidencePath(att);
        const blob = await this.loadFile(att.uri);
        await this.remote.uploadEvidence(path, blob);
        await this.remote.upsertAttachments([toRemoteRow(att, path)]);
        await this.local.markAttachmentSynced(att.id, path);
        uploaded++;
      } catch {
        failed++;
      }
    }

    // Pull — metadata rows authored on other devices for this audit. Locally
    // known ids (including tombstones) are never overwritten or resurrected.
    if (auditId) {
      try {
        const remoteRows = await this.remote.pullAttachments(auditId);
        const asLocal = remoteRows.map((r) => toLocalRow(r));
        await this.local.applyRemoteAttachments(asLocal);
        pulled = asLocal.length;
      } catch {
        failed++;
      }
    }

    return { skipped: false, uploaded, removed, pulled, failed };
  }
}

/** A server metadata row as a local Attachment: no local file (uri empty) —
 *  the bytes live in Storage and viewing resolves a signed URL on demand. */
function toLocalRow(r: RemoteAttachment): Attachment {
  return {
    id: r.id, org_id: r.org_id, audit_item_id: r.audit_item_id,
    kind: r.kind as AttachmentKind, uri: '', storage_path: r.storage_path,
    sync_state: 'synced', deleted_at: null,
    transcription: r.transcription, created_at: r.created_at,
  };
}

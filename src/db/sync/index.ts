/**
 * Sync wiring — assembles the SyncEngine with the Supabase remote and the repo
 * (which satisfies the SyncLocal port). Kept behind the seam; screens use the
 * useSync hook, never this directly.
 */
import type { Repo } from '@/db/repo';
import { nowIso } from '@/db/ids';
import { SyncEngine } from './engine';
import { AttachmentSync } from './attachments';
import { createSupabaseRemote } from './supabaseRemote';
import { createSupabaseEvidence } from './supabaseEvidence';
import { loadForUpload } from '@/attachments/capture';
import type { RemoteAdapter } from './remote';

export function createSync(repo: Repo): {
  engine: SyncEngine;
  remote: RemoteAdapter;
  attachments: AttachmentSync;
} {
  const remote = createSupabaseRemote();
  // Repo exposes getAuditItems + applyMergedItems, satisfying SyncLocal.
  const engine = new SyncEngine(repo, remote, nowIso);
  // Repo also satisfies AttachmentLocal; capture.loadForUpload reads the files.
  const attachments = new AttachmentSync(repo, createSupabaseEvidence(), loadForUpload);
  return { engine, remote, attachments };
}

export { SyncEngine } from './engine';
export { AttachmentSync } from './attachments';
export type { SyncSummary, SyncLocal } from './engine';
export type { AttachmentSyncSummary } from './attachments';

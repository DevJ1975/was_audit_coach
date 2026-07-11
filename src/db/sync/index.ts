/**
 * Sync wiring — assembles the SyncEngine with the Supabase remote and the repo
 * (which satisfies the SyncLocal port). Kept behind the seam; screens use the
 * useSync hook, never this directly.
 */
import type { Repo } from '@/db/repo';
import { nowIso } from '@/db/ids';
import { SyncEngine } from './engine';
import { createSupabaseRemote } from './supabaseRemote';
import type { RemoteAdapter } from './remote';

export function createSync(repo: Repo): { engine: SyncEngine; remote: RemoteAdapter } {
  const remote = createSupabaseRemote();
  // Repo exposes getAuditItems + applyMergedItems, satisfying SyncLocal.
  const engine = new SyncEngine(repo, remote, nowIso);
  return { engine, remote };
}

export { SyncEngine } from './engine';
export type { SyncSummary, SyncLocal } from './engine';

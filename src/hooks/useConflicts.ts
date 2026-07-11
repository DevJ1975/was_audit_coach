/**
 * useConflicts — the lead auditor's rating-conflict resolution for one audit
 * (conflict policy: divergent offline ratings flag needs_resolution and are
 * never auto-resolved; a human sees both candidates and picks). The conflict
 * LIST is derived by the screen from items it already loads — this hook owns
 * only the resolution action.
 *
 * Resolution is online-only and compare-and-set: the peer may have re-rated
 * since the conflict was flagged, so before pushing we verify the server still
 * holds the candidate the lead actually looked at. On mismatch the candidate
 * is refreshed and the lead must look again — a stale snapshot must never
 * silently overwrite a newer rating (the conflict policy's whole point).
 */
import { useCallback, useMemo, useState } from 'react';
import { useRepo, useSession } from '@/db/RepoProvider';
import { createSync, errorMessage } from '@/db/sync';
import { auditItemToRemote } from '@/db/sync/remote';
import { nowIso } from '@/db/ids';
import type { AuditItem } from '@/db/types';
import type { Rating } from '@soteria/scoring-engine';

export function useConflicts(auditId: string): {
  /** Item id being resolved, or null. */
  resolving: string | null;
  error: string | null;
  /** Resolve one conflict; resolves cleanly even when the outcome is
   *  "candidates changed — look again" (surfaced via `error`). */
  resolve: (item: AuditItem, choice: 'mine' | 'theirs') => Promise<void>;
} {
  const repo = useRepo();
  const session = useSession();
  const { remote } = useMemo(() => createSync(repo), [repo]);
  const [resolving, setResolving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolve = useCallback(
    async (item: AuditItem, choice: 'mine' | 'theirs') => {
      if (resolving) return;
      if (!remote.isAvailable()) {
        // A resolution that can't push through would re-flag on the next sync
        // (the pick still differs from the peer's server rating) — refuse
        // honestly rather than pretend it's settled.
        setError('Connect and sign in to resolve conflicts.');
        return;
      }
      setResolving(item.id);
      setError(null);
      try {
        // Compare-and-set guard: fetch the server's CURRENT rating for this
        // item and make sure it's still the candidate we showed the lead.
        const serverRows = await remote.pullAuditItems(item.audit_id, null);
        const server = serverRows.find((r) => r.id === item.id);
        if (server && server.rating === item.rating) {
          // The peer adopted this device's rating meanwhile — nothing to pick.
          await repo.applyMergedItems([
            { ...item, conflict_rating: null, sync_state: 'synced', updated_at: nowIso() },
          ]);
          return;
        }
        if (server && server.rating !== item.conflict_rating) {
          // Candidate is stale: refresh it and make the lead look again.
          await repo.applyMergedItems([
            { ...item, conflict_rating: server.rating ?? null, updated_at: item.updated_at },
          ]);
          setError('The rating changed on the server — review the updated value.');
          return;
        }

        const rating: Rating | null = choice === 'mine' ? item.rating : item.conflict_rating;
        const resolved = await repo.resolveRatingConflict(item.id, rating, session.user_id);
        // Push-through: land the resolution on the server now, then mark the
        // row synced so reconcile sees agreement instead of a fresh conflict.
        const ts = nowIso();
        await remote.upsertAuditItems([auditItemToRemote(resolved, ts)]);
        await repo.applyMergedItems([{ ...resolved, sync_state: 'synced', updated_at: ts }]);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setResolving(null);
      }
    },
    [repo, remote, session.user_id, resolving],
  );

  return { resolving, error, resolve };
}

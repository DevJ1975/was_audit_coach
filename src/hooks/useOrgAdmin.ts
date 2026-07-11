/**
 * useOrgAdmin — tenant administration for the Organization screen. Online-only
 * admin operations (members, invites, rename) against RLS-guarded tables and
 * the set_member_role RPC; every mutation is authorized SERVER-side by policy
 * or definer-function checks — the role gate here is only UX. Follows the
 * hooks-bridge precedent (useSync): screens never import supabase directly.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { getSupabase, hasSession } from '@/db/supabase';
import type { Role } from '@/db/types';
import { errorMessage } from '@/db/sync';

export interface OrgMember {
  id: string;
  email: string | null;
  role: Role;
}

export interface OrgInvite {
  id: string;
  email: string;
  role: Role;
}

export function useOrgAdmin(): {
  available: boolean;
  isAdmin: boolean;
  canInvite: boolean;
  orgName: string;
  members: OrgMember[];
  invites: OrgInvite[];
  busy: boolean;
  error: string | null;
  reload: () => Promise<void>;
  invite: (email: string, role: Role) => Promise<boolean>;
  revokeInvite: (id: string) => Promise<void>;
  setRole: (userId: string, role: Role) => Promise<void>;
  renameOrg: (name: string) => Promise<void>;
} {
  const { identity, session } = useAuth();
  const available = useMemo(() => getSupabase() != null && hasSession(), [session]);
  const isAdmin = identity.role === 'admin';
  const canInvite = isAdmin || identity.role === 'lead_auditor';

  const [orgName, setOrgName] = useState('');
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase || !hasSession()) return;
    setError(null);
    try {
      const [org, mem, inv] = await Promise.all([
        supabase.from('orgs').select('name').eq('id', identity.org_id).maybeSingle(),
        supabase.from('profiles').select('id, email, role').order('created_at'),
        canInvite ? supabase.from('org_invites').select('id, email, role').order('created_at') : Promise.resolve({ data: [], error: null }),
      ]);
      if (org.error) throw new Error(org.error.message);
      if (mem.error) throw new Error(mem.error.message);
      if (inv.error) throw new Error(inv.error.message);
      setOrgName(org.data?.name ?? identity.org_id);
      setMembers((mem.data ?? []) as OrgMember[]);
      setInvites((inv.data ?? []) as OrgInvite[]);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [identity.org_id, canInvite]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(
    async (op: () => Promise<void>): Promise<boolean> => {
      if (busy) return false;
      setBusy(true);
      setError(null);
      try {
        await op();
        await reload();
        return true;
      } catch (e) {
        setError(errorMessage(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, reload],
  );

  const invite = useCallback(
    (email: string, role: Role) =>
      run(async () => {
        const supabase = getSupabase();
        if (!supabase) throw new Error('Backend not configured.');
        const { error: err } = await supabase.from('org_invites').insert({
          org_id: identity.org_id,
          email: email.trim().toLowerCase(),
          role,
        });
        if (err) {
          throw new Error(
            err.code === '23505' ? 'That email already has a pending invite.' : err.message,
          );
        }
      }),
    [run, identity.org_id],
  );

  const revokeInvite = useCallback(
    async (id: string) => {
      await run(async () => {
        const supabase = getSupabase();
        if (!supabase) throw new Error('Backend not configured.');
        const { error: err } = await supabase.from('org_invites').delete().eq('id', id);
        if (err) throw new Error(err.message);
      });
    },
    [run],
  );

  const setRole = useCallback(
    async (userId: string, role: Role) => {
      await run(async () => {
        const supabase = getSupabase();
        if (!supabase) throw new Error('Backend not configured.');
        const { error: err } = await supabase.rpc('set_member_role', {
          target_user: userId,
          new_role: role,
        });
        if (err) throw new Error(err.message);
      });
    },
    [run],
  );

  const renameOrg = useCallback(
    async (name: string) => {
      await run(async () => {
        const supabase = getSupabase();
        if (!supabase) throw new Error('Backend not configured.');
        const { error: err } = await supabase
          .from('orgs')
          .update({ name: name.trim() })
          .eq('id', identity.org_id);
        if (err) throw new Error(err.message);
      });
    },
    [run, identity.org_id],
  );

  return { available, isAdmin, canInvite, orgName, members, invites, busy, error, reload, invite, revokeInvite, setRole, renameOrg };
}

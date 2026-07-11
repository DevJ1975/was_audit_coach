/**
 * AuthProvider — owns the Supabase session and derives the tenant identity
 * (org_id + role) from JWT app_metadata claims. Tenant isolation is enforced by
 * RLS on the server; this identity only drives local UX.
 *
 * FIELD MODE (Non-Negotiable #3 / Phase 4 task 2): you never need to sign in to
 * conduct an audit already on device. When the backend is unconfigured or no one
 * is signed in, we fall back to a local identity so every screen still works.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { getSupabase, isBackendConfigured } from '@/db/supabase';
import type { Role } from '@/db/types';

export interface Identity {
  org_id: string;
  user_id: string;
  role: Role;
}

export type AuthMode = 'authenticated' | 'field';

/** Local field identity — used offline / signed-out. org_id 'wls' = WLS pilot org. */
const FIELD_IDENTITY: Identity = { org_id: 'wls', user_id: 'field-auditor', role: 'lead_auditor' };

interface AuthContextValue {
  identity: Identity;
  mode: AuthMode;
  session: SupabaseSession | null;
  loading: boolean;
  backendConfigured: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function identityFromSession(session: SupabaseSession | null): Identity {
  if (!session) return FIELD_IDENTITY;
  const meta = (session.user.app_metadata ?? {}) as { org_id?: string; role?: Role };
  return {
    org_id: meta.org_id ?? FIELD_IDENTITY.org_id,
    user_id: session.user.id,
    role: meta.role ?? 'auditor',
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [session, setSession] = useState<SupabaseSession | null>(null);
  const [loading, setLoading] = useState(isBackendConfigured);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setLoading(false);
      return; // field mode — no backend configured
    }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (active) setSession(s);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      identity: identityFromSession(session),
      mode: session ? 'authenticated' : 'field',
      session,
      loading,
      backendConfigured: isBackendConfigured,
      async signIn(email, password) {
        const supabase = getSupabase();
        if (!supabase) return { error: 'Backend not configured on this build.' };
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error: error?.message ?? null };
      },
      async signOut() {
        await getSupabase()?.auth.signOut();
        setSession(null);
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

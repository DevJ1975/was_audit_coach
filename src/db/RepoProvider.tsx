/**
 * RepoProvider — opens SQLite, builds the repo, and hands screens a ready seam.
 * Screens call useRepo() / useSession(); they never import the driver.
 *
 * Session is local-only in Phase 1 (auth arrives in Phase 4; you never need to
 * sign in to conduct an audit already on device). The dev session stands in for
 * JWT org/role claims.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { getDatabase } from './database';
import { createSqliteRepo } from './sqliteRepo';
import type { Repo } from './repo';
import { useAuth, type Identity } from '@/auth/AuthProvider';
import { surfaces, text as textTokens } from '@/theme/tokens';

/** The tenant identity screens act as. Sourced from auth (JWT) or field mode. */
export type Session = Identity;

interface RepoContextValue {
  repo: Repo;
}

const RepoContext = createContext<RepoContextValue | null>(null);

export function RepoProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [value, setValue] = useState<RepoContextValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await getDatabase();
        if (cancelled) return;
        setValue({ repo: createSqliteRepo(db) });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Storage failed to open{'\n'}{error}</Text>
      </View>
    );
  }
  if (!value) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={textTokens.dim} />
      </View>
    );
  }
  return <RepoContext.Provider value={value}>{children}</RepoContext.Provider>;
}

export function useRepo(): Repo {
  const ctx = useContext(RepoContext);
  if (!ctx) throw new Error('useRepo must be used within RepoProvider');
  return ctx.repo;
}

/** The current tenant identity (org_id, user_id, role) — from auth or field mode. */
export function useSession(): Session {
  return useAuth().identity;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: surfaces.bg, padding: 24 },
  error: { color: '#D9483B', textAlign: 'center' },
});

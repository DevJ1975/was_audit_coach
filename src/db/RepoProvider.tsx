/**
 * RepoProvider — opens SQLite, builds the repo, and hands screens a ready seam.
 * Screens call useRepo() / useSession(); they never import the driver.
 *
 * Session is local-only in Phase 1 (auth arrives in Phase 4; you never need to
 * sign in to conduct an audit already on device). The dev session stands in for
 * JWT org/role claims.
 */
import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { getDatabase } from './database';
import { createSqliteRepo } from './sqliteRepo';
import type { Repo } from './repo';
import { useAuth, type Identity } from '@/auth/AuthProvider';
import { brand, layout, semantic, surfaces, text as textTokens } from '@/theme/tokens';

/** The tenant identity screens act as. Sourced from auth (JWT) or field mode. */
export type Session = Identity;

interface RepoContextValue {
  repo: Repo;
}

const RepoContext = createContext<RepoContextValue | null>(null);

export function RepoProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [value, setValue] = useState<RepoContextValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

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
  }, [attempt]);

  const retry = useCallback(() => {
    // On web the SQLite worker cannot recover in-process once an open has
    // failed (OPFS handles are exclusive and the worker wedges) — a page
    // reload is the only reliable path. Native can simply re-attempt.
    const loc = (globalThis as { location?: { reload(): void } }).location;
    if (Platform.OS === 'web' && loc) {
      loc.reload();
      return;
    }
    setError(null);
    setAttempt((a) => a + 1);
  }, []);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Storage failed to open{'\n'}{error}</Text>
        <Pressable accessibilityRole="button" onPress={retry} style={styles.retryButton}>
          <Text style={styles.retryLabel}>{Platform.OS === 'web' ? 'Reload' : 'Retry'}</Text>
        </Pressable>
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
  error: { color: semantic.danger, textAlign: 'center' },
  retryButton: {
    marginTop: layout.gap * 2,
    minHeight: layout.minTapTarget,
    minWidth: layout.minTapTarget * 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: layout.radius,
    backgroundColor: brand.default,
    paddingHorizontal: 24,
  },
  retryLabel: { color: surfaces.bg, fontSize: 16, fontWeight: '600' },
});

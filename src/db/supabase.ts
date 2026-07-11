/**
 * Supabase client (Phase 4). Behind the repo seam — screens never import this.
 * Session persists in AsyncStorage so a signed-in auditor stays signed in
 * offline. Tenant isolation is enforced by Postgres RLS (Non-Negotiable #5), so
 * the publishable key is safe on the client.
 */
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** True when backend env is configured. When false, the app runs local-only. */
export const isBackendConfigured = Boolean(url && key);

let client: SupabaseClient | null = null;
let sessionPresent = false;

/** The shared client, or null when the backend isn't configured (field mode). */
export function getSupabase(): SupabaseClient | null {
  if (!isBackendConfigured) return null;
  if (!client) {
    client = createClient(url!, key!, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
    // Track session presence synchronously readable by the sync adapters —
    // isAvailable() must mean "configured AND signed in", or a signed-out user
    // gets an enabled Sync button whose pushes all fail RLS (silently, before
    // this existed). onAuthStateChange fires INITIAL_SESSION on subscribe, so
    // a restored AsyncStorage session is picked up without an explicit get.
    client.auth.onAuthStateChange((_event, session) => {
      sessionPresent = session != null;
    });
  }
  return client;
}

/**
 * True when a user session exists (kept current via onAuthStateChange).
 * Synchronous by design: sync-availability checks run in render paths.
 */
export function hasSession(): boolean {
  return sessionPresent;
}

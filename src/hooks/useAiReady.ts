/**
 * useAiReady — reactive AI availability for screens. The AI surfaces need a
 * SESSION, not just a configured backend: every server function requires the
 * caller's JWT, so a signed-out user's request can only 401. Before this,
 * buttons were enabled signed-out and the hint said "connects when online" —
 * misleading when the user is online but logged out.
 */
import { useAuth } from '@/auth/AuthProvider';

export type AiGate =
  | { ready: true; reason: null }
  | { ready: false; reason: 'unconfigured' | 'signin' };

export function useAiReady(): AiGate {
  const { session, backendConfigured } = useAuth();
  if (!backendConfigured) return { ready: false, reason: 'unconfigured' };
  if (!session) return { ready: false, reason: 'signin' };
  return { ready: true, reason: null };
}

/** The hint to show beside disabled AI controls. */
export function aiHintText(gate: AiGate): string | null {
  if (gate.ready) return null;
  return gate.reason === 'signin'
    ? 'Sign in to use AI features'
    : 'AI connects when this build has a backend';
}

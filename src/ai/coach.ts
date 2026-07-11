/**
 * App-side Audit Coach client. Calls the server-side `audit-coach` Edge
 * Function, which proxies a pre-built Anthropic MANAGED AGENT — keys and agent
 * config live ONLY server-side. This is the audit-TECHNIQUE mentor embedded in
 * the audit execution flow; it is a separate surface from Soteria chat (the
 * compliance/regulation agent, src/ai/chat.ts) and from the per-item ARIA Q&A.
 *
 * Conversation memory lives in the Anthropic session: the app keeps only a
 * `sessionId` handle plus a local transcript for display. The contract returns
 * text only — no field here can set a rating (Non-Negotiable #2) — and when
 * the backend is unconfigured the surface is disabled so nothing ever blocks
 * offline (#3).
 */
import { getSupabase } from '@/db/supabase';
import { unwrapFunctionError } from './invokeError';

export { isAiConfigured } from './client';

export interface CoachTurn {
  role: 'user' | 'assistant';
  text: string;
}

export type CoachResult =
  | { ok: true; text: string; sessionId: string }
  | { ok: false; error: string; sessionId?: string };

export async function askAuditCoach(
  message: string,
  opts: { sessionId?: string | null; context?: string; auditId?: string } = {},
): Promise<CoachResult> {
  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: 'The coach connects when the app is online and signed in.' };
  }
  try {
    const { data, error } = await supabase.functions.invoke<{
      text?: string;
      session_id?: string;
      error?: string;
    }>('audit-coach', {
      body: {
        message,
        ...(opts.sessionId ? { session_id: opts.sessionId } : {}),
        ...(opts.context ? { context: opts.context } : {}),
        ...(opts.auditId ? { audit_id: opts.auditId } : {}),
      },
    });
    if (error) {
      // The function returns session_id even on errors (e.g. its 504) so the
      // thread can continue — recover it from the error body.
      const u = await unwrapFunctionError(error, 'The coach is unavailable right now.');
      const sid = u.body && typeof u.body.session_id === 'string' ? u.body.session_id : undefined;
      return { ok: false, error: u.message, ...(sid ? { sessionId: sid } : {}) };
    }
    if (!data?.text || !data.session_id) {
      return { ok: false, error: data?.error ?? 'No answer returned.' };
    }
    return { ok: true, text: data.text, sessionId: data.session_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * In-memory coach thread, one per audit, so the conversation survives hopping
 * between items/sections mid-audit. Deliberately NOT persisted to SQLite or
 * the server — chat retention is an open decision (chat plan §10.5); memory
 * only, gone on app restart.
 */
export interface CoachThread {
  sessionId: string | null;
  messages: CoachTurn[];
}

const threads = new Map<string, CoachThread>();

export function getCoachThread(auditId: string): CoachThread {
  let t = threads.get(auditId);
  if (!t) {
    t = { sessionId: null, messages: [] };
    threads.set(auditId, t);
  }
  return t;
}

export function resetCoachThread(auditId: string): void {
  threads.delete(auditId);
}

/**
 * App-side Soteria chat client (Phase C4). Calls the server-side `soteria-chat`
 * Edge Function — keys live ONLY in Supabase secrets. Same seam discipline as
 * requestDraft: the contract returns text + verified citations and nothing
 * else; no field here can set a rating (Non-Negotiable #2). When the backend
 * is unconfigured the surface is disabled so nothing ever blocks offline (#3).
 */
import { getSupabase } from '@/db/supabase';
import { unwrapFunctionError } from './invokeError';

export { isAiConfigured } from './client';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** A verified citation — guaranteed server-side to come from retrieved text. */
export interface SoteriaCitation {
  ref: number;
  citation: string;
  heading_path: string;
  jurisdiction: string;
  source_url: string;
  last_amended: string | null;
}

export type ChatResult =
  | { ok: true; text: string; citations: SoteriaCitation[] }
  | { ok: false; error: string };

export async function askSoteria(
  question: string,
  history: ChatTurn[],
  jurisdiction?: string,
): Promise<ChatResult> {
  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: 'Soteria connects when the app is online and signed in.' };
  }
  try {
    const { data, error } = await supabase.functions.invoke<{
      text?: string;
      citations?: SoteriaCitation[];
      error?: string;
    }>('soteria-chat', {
      body: { question, history, jurisdiction },
    });
    if (error) return { ok: false, error: (await unwrapFunctionError(error, 'Soteria is unavailable right now.')).message };
    if (!data?.text) return { ok: false, error: data?.error ?? 'No answer returned.' };
    return { ok: true, text: data.text, citations: data.citations ?? [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

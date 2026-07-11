/**
 * App-side AI client (Phase 3). Calls the server-side `ai-draft` Edge Function —
 * the Anthropic key lives ONLY in Supabase secrets, never in the app bundle.
 *
 * Returns draft TEXT only. There is deliberately no field, path, or return shape
 * here that could set a `rating` (Non-Negotiable #2). When the backend is
 * unconfigured the whole surface is disabled so the offline audit loop never
 * blocks (Non-Negotiable #3).
 */
import { getSupabase, isBackendConfigured } from '@/db/supabase';
import { unwrapFunctionError } from './invokeError';
import type { BuiltPrompt } from './prompts';

/** AI features are usable only when a backend is configured on this build. */
export function isAiConfigured(): boolean {
  return isBackendConfigured;
}

export type DraftResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/**
 * Request a grounded draft from the server. `prompt` is one of the pure builders
 * in prompts.ts. The caller renders the result as an editable draft — it is
 * NEVER auto-applied and NEVER interpreted as a rating.
 */
export async function requestDraft(prompt: BuiltPrompt): Promise<DraftResult> {
  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: 'AI connects when the app is online and signed in.' };
  }
  try {
    const { data, error } = await supabase.functions.invoke<{ text?: string; error?: string }>(
      'ai-draft',
      {
        body: {
          kind: prompt.kind,
          system: prompt.system,
          user: prompt.user,
          maxTokens: prompt.maxTokens,
        },
      },
    );
    if (error) return { ok: false, error: (await unwrapFunctionError(error, 'Draft request failed.')).message };
    if (!data?.text) return { ok: false, error: data?.error ?? 'No draft returned.' };
    return { ok: true, text: data.text.trim() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Supabase Edge Function: ai-draft (Phase 3)
// Server-side Claude call. The Anthropic API key lives ONLY in this function's
// secrets — never in the app bundle. Grounded prompts are built client-side
// (src/ai/prompts.ts) and forbid the model from setting a rating; this function
// returns TEXT only. Per-org usage is metered; a prompt-length guard caps cost.
//
// Deploy:  supabase functions deploy ai-draft
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (required)
//          supabase secrets set AI_DRAFT_MODEL=claude-opus-4-8 (optional; see note)
//
// Model note: defaults to claude-opus-4-8 (current best per Anthropic guidance).
// The build plan named claude-sonnet-4-6 for lower cost on this high-volume text
// task — set AI_DRAFT_MODEL to switch without a code change.
//
// deno-lint-ignore-file
// @ts-nocheck  (Deno runtime + npm: specifiers; not part of the app's tsconfig)
import Anthropic from 'npm:@anthropic-ai/sdk@0.68.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const KINDS = new Set(['observation_polish', 'recommendation_draft', 'aria_coach']);
const MAX_PROMPT_CHARS = 20_000; // length guard

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'AI not configured on the server.' }, 503);

  // Identify the caller (RLS-safe) — org_id/role come from the JWT.
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: 'Sign in to use AI drafting.' }, 401);
  const org_id = (user.app_metadata as { org_id?: string })?.org_id ?? null;

  let payload: { kind?: string; system?: string; user?: string; maxTokens?: number };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }
  const { kind, system, user: userText, maxTokens } = payload;

  if (!kind || !KINDS.has(kind)) return json({ error: 'Unknown draft kind.' }, 400);
  if (!system || !userText) return json({ error: 'Missing prompt.' }, 400);
  if (system.length + userText.length > MAX_PROMPT_CHARS) {
    return json({ error: 'Prompt too long.' }, 413);
  }

  const model = Deno.env.get('AI_DRAFT_MODEL') ?? 'claude-opus-4-8';
  const anthropic = new Anthropic({ apiKey });

  let text = '';
  let usage = { input_tokens: 0, output_tokens: 0 };
  try {
    const msg = await anthropic.messages.create({
      model,
      max_tokens: Math.min(Math.max(maxTokens ?? 400, 64), 1024),
      system, // system prompt carries the grounding + the never-rate guardrail
      messages: [{ role: 'user', content: userText }],
    });
    text = (msg.content ?? [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('')
      .trim();
    usage = { input_tokens: msg.usage?.input_tokens ?? 0, output_tokens: msg.usage?.output_tokens ?? 0 };
  } catch (e) {
    return json({ error: `AI request failed: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }

  // Per-org usage metering (best-effort; never blocks the response).
  if (org_id) {
    await supabase.from('ai_usage').insert({
      org_id,
      user_id: user.id,
      kind,
      model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
    });
  }

  return json({ text });
});

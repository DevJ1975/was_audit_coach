// Supabase Edge Function: report-brief (Phase 5 — legal-grade findings report)
// Server-side Claude call for the two-agent (CSP + attorney) narrative that wraps
// the deterministic findings report. The Anthropic key lives ONLY in this
// function's secrets — never in the app bundle. Prompts are built client-side
// (src/ai/prompts.ts) and forbid the model from setting a rating, minting legal
// authority, or giving legal advice; this function returns TEXT only.
//
// The two agents are orchestrated CLIENT-side (src/ai/reportBrief.ts): the client
// sequences the CSP finding pass → attorney refine pass → executive-summary pass,
// one grounded call per unit, so each request stays small and resumable (no long
// request that could hit the function wall-clock on a large audit). This function
// is deliberately a single-unit call, mirroring ai-draft.
//
// AI DRAFTS; HUMANS RATE (NN #2): nothing here can set a rating or score — the
// final report recomputes those deterministically on-device, and every section
// is a draft until a human accepts it.
//
// Deploy:  supabase functions deploy report-brief
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...        (required)
//          supabase secrets set REPORT_BRIEF_MODEL=claude-opus-4-8  (optional)
//
// Model note: defaults to claude-opus-4-8 — this is a legal deliverable, so the
// strongest model is the right default. Set REPORT_BRIEF_MODEL to tune cost.
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

// The three brief passes. Naming mirrors src/ai/prompts.ts PromptKind so metering
// rows read cleanly per pass.
const KINDS = new Set(['csp_finding_narrative', 'attorney_review', 'exec_summary']);
const MAX_PROMPT_CHARS = 24_000; // length guard (a finding's grounding + observation)

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
  if (!user) return json({ error: 'Sign in to generate a report brief.' }, 401);
  const org_id = (user.app_metadata as { org_id?: string })?.org_id ?? null;
  const role = (user.app_metadata as { role?: string })?.role ?? null;

  // Authoring the legal brief is a lead/admin action — the same authors who own
  // ratings. counsel_viewer/auditor/site_manager view or draft items, not briefs.
  if (role && !['admin', 'lead_auditor'].includes(role)) {
    return json({ error: 'Only a lead auditor or admin can generate a report brief.' }, 403);
  }

  let payload: { kind?: string; system?: string; user?: string; maxTokens?: number };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }
  const { kind, system, user: userText, maxTokens } = payload;

  if (!kind || !KINDS.has(kind)) return json({ error: 'Unknown brief kind.' }, 400);
  if (!system || !userText) return json({ error: 'Missing prompt.' }, 400);
  if (system.length + userText.length > MAX_PROMPT_CHARS) {
    return json({ error: 'Prompt too long.' }, 413);
  }

  const model = Deno.env.get('REPORT_BRIEF_MODEL') ?? 'claude-opus-4-8';
  const anthropic = new Anthropic({ apiKey });

  let text = '';
  let usage = { input_tokens: 0, output_tokens: 0 };
  try {
    const msg = await anthropic.messages.create({
      model,
      // The exec-summary pass emits four sections, so it needs more headroom than
      // the per-finding passes; clamp keeps any single call bounded.
      max_tokens: Math.min(Math.max(maxTokens ?? 700, 64), 1600),
      system, // carries grounding + never-rate + not-legal-advice + no-invented-law
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

  // Per-org usage metering (best-effort; never blocks the response). Kind is the
  // pass name so cost is attributable across the two agents.
  if (org_id) {
    await supabase.from('ai_usage').insert({
      org_id,
      user_id: user.id,
      kind: `report_brief:${kind}`,
      model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
    });
  }

  return json({ text, model });
});

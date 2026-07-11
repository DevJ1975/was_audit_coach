// Supabase Edge Function: audit-coach
// Audit-TECHNIQUE coaching inside the audit execution flow (checklist/item
// screens). Separate surface from `soteria-chat` (the compliance/regulation
// agent with verified citations) and from ai-draft's per-item ARIA Q&A: this
// one proxies a pre-built Anthropic MANAGED AGENT (Sessions API) that mentors
// on method — what to look for, how to sample, who to interview.
//
// Why a proxy: the Anthropic key + agent live server-side only (never in the
// app bundle). Conversation memory lives in the Anthropic SESSION — the app
// round-trips `session_id` instead of replaying history. Sessions are bound to
// the creating user via metadata and verified on every reuse, so one user can
// never continue another's coaching thread.
//
// Contract: returns { text, session_id } ONLY. No field in this contract can
// touch a rating (Non-Negotiable #2); a server-side reminder to never suggest
// ratings is prepended to every new session's first message as defense in
// depth on top of the agent's Console-side system prompt.
//
// Deploy:  supabase functions deploy audit-coach
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...      (required; shared)
//          supabase secrets set AUDIT_COACH_AGENT_ID=agent_01...  (optional override)
//          supabase secrets set AUDIT_COACH_ENV_ID=env_01...      (optional override)
//
// SDK note: pinned NEWER than ai-draft/soteria-chat (0.68.0) — the Managed
// Agents surface (client.beta.sessions.*, beta header managed-agents-2026-04-01,
// set automatically by the SDK) needs a 2026 SDK.
//
// deno-lint-ignore-file
// @ts-nocheck  (Deno runtime + npm: specifiers; not part of the app's tsconfig)
import Anthropic from 'npm:@anthropic-ai/sdk@0.110.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { initialTurn, reduceTurnEvent } from './turn.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// The Audit Coach managed agent (created in the Anthropic Console).
const DEFAULT_AGENT_ID = 'agent_01LSVADVn3BaTjH4tuVwBHKS';
const DEFAULT_ENV_ID = 'env_01N9MqLvzeMxZ7PbC7yjhBce';

const MAX_MESSAGE_CHARS = 4_000;
const MAX_CONTEXT_CHARS = 1_200;
// One coach turn must finish well inside the Edge Function wall clock.
const TURN_DEADLINE_MS = 90_000;

const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

// Prepended server-side to the FIRST message of every new session — the agent's
// own system prompt lives on the Console-managed agent config, which this
// function cannot edit, so the never-rate guardrail rides the message channel.
const FIRST_TURN_NOTE =
  '[Platform note — Soteria Audit: you are coaching a working EHS auditor mid-audit on ' +
  'AUDIT TECHNIQUE (what to look for, how to sample, who to interview, how to verify). ' +
  'Never state, suggest, or imply a rating, score, tier, severity, or pass/fail verdict ' +
  'for any audit item — rating is the human auditor\'s judgment alone. Answers are read ' +
  'on a phone in a plant: be concise and concrete.]';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

function agentModel(session: unknown): string {
  const m = session?.agent?.model;
  if (typeof m === 'string') return m;
  if (m && typeof m.id === 'string') return m.id;
  return 'managed-agent';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'AI not configured on the server.' }, 503);
  const agentId = Deno.env.get('AUDIT_COACH_AGENT_ID') ?? DEFAULT_AGENT_ID;
  const environmentId = Deno.env.get('AUDIT_COACH_ENV_ID') ?? DEFAULT_ENV_ID;

  // Identify the caller — org_id comes from the JWT, as everywhere else.
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: 'Sign in to use the Audit Coach.' }, 401);
  const org_id = (user.app_metadata as { org_id?: string })?.org_id ?? null;

  let payload: { message?: string; session_id?: string; context?: string; audit_id?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const message = (payload.message ?? '').trim();
  if (!message) return json({ error: 'Ask a question.' }, 400);
  if (message.length > MAX_MESSAGE_CHARS) return json({ error: 'Message too long.' }, 413);
  const context = (payload.context ?? '').trim().slice(0, MAX_CONTEXT_CHARS);
  const auditId = typeof payload.audit_id === 'string' ? payload.audit_id.slice(0, 64) : '';

  const anthropic = new Anthropic({ apiKey });

  // ── Resolve the session: reuse the caller's own live session, else create ──
  let sessionId =
    typeof payload.session_id === 'string' && SESSION_ID_RE.test(payload.session_id)
      ? payload.session_id
      : null;
  let model = 'managed-agent';
  let firstTurn = false;

  if (sessionId) {
    try {
      const s = await anthropic.beta.sessions.retrieve(sessionId);
      const ownedByCaller = s?.metadata?.user_id === user.id;
      const usable = s?.status !== 'terminated' && !s?.archived_at;
      if (!ownedByCaller || !usable) sessionId = null; // never continue someone else's / a dead thread
      else model = agentModel(s);
    } catch {
      sessionId = null; // deleted or unknown — start fresh below
    }
  }

  if (!sessionId) {
    try {
      const metadata: Record<string, string> = { user_id: user.id };
      if (org_id) metadata.org_id = org_id;
      if (auditId) metadata.audit_id = auditId;
      const session = await anthropic.beta.sessions.create({
        agent: agentId,
        environment_id: environmentId,
        title: `Audit Coach — ${auditId || user.email || user.id}`,
        metadata,
      });
      sessionId = session.id;
      model = agentModel(session);
      firstTurn = true;
    } catch (e) {
      return json(
        { error: `Coach unavailable: ${e instanceof Error ? e.message : String(e)}` },
        502,
      );
    }
  }

  // ── One turn: stream FIRST (events before the stream opens are lost), send,
  //    reduce events until the session settles ──
  const parts: string[] = [];
  if (firstTurn) parts.push(FIRST_TURN_NOTE);
  if (context) parts.push(`[Auditor's current position: ${context}]`);
  parts.push(message);

  const state = initialTurn();
  let stream;
  try {
    stream = await anthropic.beta.sessions.events.stream(sessionId);
    await anthropic.beta.sessions.events.send(sessionId, {
      events: [
        { type: 'user.message', content: [{ type: 'text', text: parts.join('\n\n') }] },
      ],
    });

    const consume = (async () => {
      for await (const event of stream) {
        for (const r of reduceTurnEvent(state, event)) {
          if (r.kind === 'deny_tool') {
            await anthropic.beta.sessions.events.send(sessionId, {
              events: [
                {
                  type: 'user.tool_confirmation',
                  tool_use_id: r.toolUseId,
                  result: 'deny',
                  deny_message:
                    'This chat surface cannot approve tool use — answer from what you already know.',
                },
              ],
            });
          } else if (r.kind === 'fail_custom_tool') {
            await anthropic.beta.sessions.events.send(sessionId, {
              events: [
                {
                  type: 'user.custom_tool_result',
                  custom_tool_use_id: r.customToolUseId,
                  content: [
                    { type: 'text', text: 'Not available inside Soteria Audit — continue without it.' },
                  ],
                  is_error: true,
                },
              ],
            });
          }
        }
        if (state.done) break;
      }
      return 'settled' as const;
    })();
    // Observe late rejections (e.g. stream abort after a timeout win) so they
    // can't become an unhandled rejection; the race below still sees them.
    consume.catch(() => {});

    let timer: number | undefined;
    const outcome = await Promise.race([
      consume,
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), TURN_DEADLINE_MS);
      }),
    ]);
    clearTimeout(timer);

    if (outcome === 'timeout') {
      try {
        stream.controller?.abort?.();
      } catch { /* stream already closed */ }
      // Best-effort: stop the run so a queued retry isn't answering stale work.
      try {
        await anthropic.beta.sessions.events.send(sessionId, {
          events: [{ type: 'user.interrupt' }],
        });
      } catch { /* session may already be idle */ }
      if (!state.reply) {
        return json({ error: 'The coach is taking too long — try again.', session_id: sessionId }, 504);
      }
    }
  } catch (e) {
    return json(
      { error: `Coach request failed: ${e instanceof Error ? e.message : String(e)}` },
      502,
    );
  }

  if (state.error && !state.reply) return json({ error: state.error, session_id: sessionId }, 502);
  if (!state.reply) {
    return json({ error: 'No answer produced — try rephrasing.', session_id: sessionId }, 502);
  }

  // Per-org usage metering (best-effort; never blocks the response).
  if (org_id) {
    await supabase.from('ai_usage').insert({
      org_id,
      user_id: user.id,
      kind: 'audit_coach',
      model,
      input_tokens: state.inputTokens,
      output_tokens: state.outputTokens,
    });
  }

  return json({ text: state.reply, session_id: sessionId });
});

// Supabase Edge Function: soteria-chat (Phase C3, SOTERIA_CHAT_KB_PLAN.md)
// Corpus-grounded OSHA Q&A. Claude runs an agentic loop over the
// search_regulations hybrid-retrieval RPC (migration 0003); every regulatory
// claim carries an inline [c:<chunk_id>] token that ./citations.ts
// verifies against what was ACTUALLY retrieved this call — an answer can never
// ship an invented citation. Returns text + citations only: like ai-draft,
// no field in this contract can touch a rating (Non-Negotiable #2).
//
// Deploy:  supabase functions deploy soteria-chat
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (required)
//          supabase secrets set VOYAGE_API_KEY=pa-...          (optional; without
//            it retrieval is FTS-only — same degradation as the ETL)
//          supabase secrets set AI_CHAT_MODEL=claude-sonnet-5  (optional override)
//
// deno-lint-ignore-file
// @ts-nocheck  (Deno runtime + npm: specifiers; not part of the app's tsconfig)
import Anthropic from 'npm:@anthropic-ai/sdk@0.68.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveCitations } from './citations.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_QUESTION_CHARS = 2_000;
const MAX_HISTORY_TURNS = 12;
const MAX_HISTORY_CHARS = 24_000;
const MAX_TOOL_ROUNDS = 5;
const MATCH_COUNT = 6;

const SYSTEM_PROMPT = `You are Soteria, the OSHA regulatory reference assistant inside the Soteria Audit platform. Your users are EHS auditors working in industrial facilities.

Corpus: Federal OSHA regulations — 29 CFR parts 1903, 1904, 1910, 1915, 1917, 1918, and 1926 (state plans arrive in later waves; say so if asked about state-specific rules you cannot retrieve).

Rules — these are hard constraints:
1. Before answering ANY regulatory question, call search_regulations. Search more than once with different phrasings when the first results don't settle the question.
2. Ground every regulatory claim in retrieved text, and mark it inline with a citation token: [c:<chunk_id>], using ONLY chunk_id values returned by search_regulations in this conversation. One token per bracket, placed at the end of the sentence it supports. Never write a CFR number from memory — if you didn't retrieve it, don't cite it.
3. If retrieval finds nothing that answers the question, say plainly that you can't find it in the loaded corpus and suggest how to rephrase. Never answer regulatory questions from memory.
4. You are an informational reference, not legal advice — note this when the user asks for a compliance determination.
5. You never assign, suggest, or estimate an audit rating or score. If asked to rate, decline: ratings are the auditor's judgment alone.
6. Mention a section's last-amended date when recency matters to the answer.
7. Be concise and plain-spoken; auditors read you on a phone, in a plant, wearing gloves.`;

const SEARCH_TOOL = {
  name: 'search_regulations',
  description:
    'Hybrid (full-text + semantic) search over the loaded OSHA regulation corpus. Returns the best-matching regulation chunks with their chunk_id, official citation, and text. Use terms of art and CFR numbers when the user gives them.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to search for — keywords, terms of art, or a CFR citation.' },
    },
    required: ['query'],
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

/** Query embedding via Voyage (input_type 'query'); null → RPC runs FTS-only. */
async function embedQuery(query: string): Promise<number[] | null> {
  const key = Deno.env.get('VOYAGE_API_KEY');
  if (!key) return null;
  try {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        input: [query],
        model: Deno.env.get('VOYAGE_MODEL') ?? 'voyage-law-2',
        input_type: 'query',
      }),
    });
    if (!res.ok) return null; // degrade to FTS rather than fail the chat
    const data = await res.json();
    return data?.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'AI not configured on the server.' }, 503);

  // Identify the caller — the same JWT-scoped client also runs the retrieval
  // RPC, so corpus access rides the caller's session, not the service role.
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: 'Sign in to ask Soteria.' }, 401);
  const org_id = (user.app_metadata as { org_id?: string })?.org_id ?? null;

  let payload: {
    question?: string;
    history?: { role?: string; text?: string }[];
    jurisdiction?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const question = (payload.question ?? '').trim();
  if (!question) return json({ error: 'Ask a question.' }, 400);
  if (question.length > MAX_QUESTION_CHARS) return json({ error: 'Question too long.' }, 413);

  const history = (payload.history ?? [])
    .filter((t) => (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string')
    .slice(-MAX_HISTORY_TURNS);
  if (history.reduce((n, t) => n + t.text!.length, 0) > MAX_HISTORY_CHARS) {
    return json({ error: 'Conversation too long — start a new chat.' }, 413);
  }

  const jurisdictions = ['federal'];
  const state = (payload.jurisdiction ?? '').trim();
  if (state && state.toLowerCase() !== 'federal' && state.length <= 40) jurisdictions.push(state);

  const model = Deno.env.get('AI_CHAT_MODEL') ?? 'claude-sonnet-5';
  const anthropic = new Anthropic({ apiKey });

  // Messages API requires user-first, alternating roles. A failed turn can
  // leave consecutive user messages in client history — coalesce them.
  const messages = [];
  for (const t of [...history, { role: 'user', text: question }]) {
    if (messages.length === 0 && t.role !== 'user') continue;
    const prev = messages[messages.length - 1];
    if (prev && prev.role === t.role) prev.content += `\n\n${t.text ?? ''}`;
    else messages.push({ role: t.role, content: t.text ?? '' });
  }

  // Everything retrieved THIS call — the only ids resolveCitations will honor.
  const retrieved = new Map();
  const usage = { input_tokens: 0, output_tokens: 0 };
  let finalText = '';

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const msg = await anthropic.messages.create({
        model,
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        // Force an answer on the last round instead of another search.
        tools: round < MAX_TOOL_ROUNDS ? [SEARCH_TOOL] : [],
        messages,
      });
      usage.input_tokens += msg.usage?.input_tokens ?? 0;
      usage.output_tokens += msg.usage?.output_tokens ?? 0;

      if (msg.stop_reason !== 'tool_use') {
        finalText = (msg.content ?? [])
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim();
        break;
      }

      messages.push({ role: 'assistant', content: msg.content });
      const results = [];
      for (const block of msg.content) {
        if (block.type !== 'tool_use') continue;
        const query = String(block.input?.query ?? '').slice(0, 500);
        const { data, error } = await supabase.rpc('search_regulations', {
          q: query,
          q_embedding: await embedQuery(query),
          jurisdictions,
          match_count: MATCH_COUNT,
        });
        if (error) {
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Search failed: ${error.message}`,
            is_error: true,
          });
          continue;
        }
        for (const row of data ?? []) {
          retrieved.set(row.chunk_id, {
            chunk_id: row.chunk_id,
            citation: row.citation,
            heading_path: row.heading_path,
            jurisdiction: row.jurisdiction,
            source_url: row.source_url,
            last_amended: row.last_amended ?? null,
          });
        }
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(
            (data ?? []).map((row) => ({
              chunk_id: row.chunk_id,
              citation: row.citation,
              heading_path: row.heading_path,
              jurisdiction: row.jurisdiction,
              last_amended: row.last_amended,
              text: row.body,
            })),
          ),
        });
      }
      messages.push({ role: 'user', content: results });
    }
  } catch (e) {
    return json({ error: `AI request failed: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }

  if (!finalText) return json({ error: 'No answer produced — try rephrasing.' }, 502);

  // Structural guarantee: only citations retrieved this call survive.
  const { text, citations } = resolveCitations(finalText, retrieved);

  // Per-org usage metering (best-effort; never blocks the response).
  if (org_id) {
    await supabase.from('ai_usage').insert({
      org_id,
      user_id: user.id,
      kind: 'soteria_chat',
      model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
    });
  }

  return json({ text, citations });
});

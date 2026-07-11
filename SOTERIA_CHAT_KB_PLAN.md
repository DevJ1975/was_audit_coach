# Soteria Chat — OSHA Knowledge Base Plan

Goal: a chat assistant ("Soteria") inside the app that answers questions about **Federal
OSHA and all 29 OSHA-approved State Plans**, with verifiable citations, and stays current
as regulations change.

Owner: Jamil Jones. Companion to the main phase plan; follows every CLAUDE.md
non-negotiable.

---

## 1. Architecture decision: RAG, not model training

The request was to "train (unsupervised)" an agent on the OSHA corpus. For a compliance
product, **do not train or fine-tune a model to memorize regulations**. Reasons:

- **Staleness.** Regulations change (eCFR updates daily; Cal/OSHA amends Title 8 several
  times a year). A trained model is frozen at training time; a retrieval corpus is
  re-ingested on a schedule.
- **No citations.** A model answering from weights can't prove where an answer came
  from. Retrieval lets every answer carry `29 CFR 1910.147(c)(4)` with a link and an
  effective date — the same evidence-first posture as the audit protocols.
- **Hallucination risk.** Fine-tuning teaches style, not reliable facts. A wrong
  confident answer about lockout/tagout is a liability, not a feature.
- **Cost.** Continued pretraining on a corpus this size buys nothing RAG doesn't do
  better for ~1000× less.

What "unsupervised" becomes here: **the ingestion pipeline is fully automated — no
hand-labeling.** Regulations are pulled, normalized, chunked, and embedded by script.
The only human-authored artifact is the eval golden set (§8), which is quality control,
not training data.

So: **RAG** — Claude (tool-use) + hybrid retrieval over a versioned regulation corpus in
Supabase Postgres/pgvector, served by a `soteria-chat` Edge Function, consumed through
the existing `src/ai/` seam.

---

## 2. Corpus scope

### Tier 1 — the regulations (launch scope)
- **Federal (via the eCFR API, ecfr.gov/developers — structured, versioned JSON/XML):**
  - 29 CFR 1910 (General Industry), 1926 (Construction)
  - 29 CFR 1904 (Recordkeeping), 1903 (Inspections/Citations)
  - 29 CFR 1915 / 1917 / 1918 (Maritime) — cheap to include, same pipeline
- **State Plans — all 29 OSHA-approved plans:**
  - 22 covering private + state/local government (AK, AZ, CA, HI, IN, IA, KY, MD, MI,
    MN, NV, NM, NC, OR, PR, SC, TN, UT, VT, VA, WA, WY)
  - 7 covering state/local government only (CT, IL, ME, MA, NJ, NY, USVI)

### Tier 2 — interpretive material (fast follow, big answer-quality win)
- OSHA Letters of Interpretation, Directives (CPL/STD), Field Operations Manual —
  scraped from osha.gov. These answer the "does X count as Y" questions the bare
  standard text can't.

### The state-plan reality (drives the data model)
Most state plans **adopt federal standards by reference** and amend selectively; a few
(California above all) have large bodies of unique standards (e.g., Cal/OSHA §3395 Heat
Illness Prevention has no federal twin). Model this explicitly:

- `reg_adoptions(state, federal_citation, status: identical | amended | state_unique, state_citation)`
- Identical-adoption states need **no duplicated text** — retrieval returns the federal
  chunk tagged "adopted verbatim by {state}".
- Only divergent/unique standards get state-specific documents. This collapses the
  "29 corpora" problem to roughly: federal + CA + WA + OR + MI + a long tail of deltas.

Each state publishes differently (CA: dir.ca.gov Title 8; WA: WAC 296; OR: OAR 437;
MI: MIOSHA admin rules; …), so states ship as **per-state adapters** in waves (§7),
not one big scrape. All of it is public-domain government text — no licensing issues.

---

## 3. Data model (Supabase Postgres)

```
reg_sources    (id, jurisdiction, name, base_url, adapter, refresh_cadence)
reg_documents  (id, jurisdiction, citation, title, heading_path, effective_date,
                source_url, version, content_hash, fetched_at)
reg_chunks     (id, document_id, ordinal, heading_path, text, token_count,
                embedding vector, fts tsvector)
reg_adoptions  (state, federal_citation, status, state_citation, note)
chat_sessions  (id, org_id, user_id, jurisdiction, created_at)         -- RLS by org_id
chat_messages  (id, session_id, role, text, citations jsonb, created_at)
```

- Regulation tables are **global public reference data** — no `org_id`, read-only RLS
  for authenticated users. Chat logs are tenant data — `org_id` + RLS, same as
  everything else (Non-negotiable #5).
- `content_hash` per document, same pattern as the item library — it's the diff key for
  the freshness pipeline (§9).
- Chunking is **structure-aware**: split on the regulation's own hierarchy
  (part → subpart → section → paragraph), keep `heading_path` (e.g.
  `1910 › Subpart J › 1910.147 › (c)(4)`) on every chunk so citations reconstruct
  exactly. Target ~500–900 tokens/chunk with paragraph-boundary overlap.

---

## 4. Indexing & retrieval

- **Embeddings:** Voyage `voyage-law-2` (legal/regulatory-tuned) or `voyage-3.5`;
  key lives in Supabase secrets only, like the Anthropic key. One-time embedding cost
  for the full corpus is trivial (tens of dollars).
- **Hybrid search:** pgvector cosine + Postgres full-text (`websearch_to_tsquery`),
  fused with reciprocal-rank fusion in a single SQL RPC. Regulation Q&A is exactly the
  domain where lexical matters — users type citation numbers ("1910.147") and terms of
  art ("competent person") that pure vectors fumble.
- **Jurisdiction routing:** every query filters `jurisdiction IN ('federal', $state)`,
  with `$state` defaulting from the org/site profile and overridable in-chat
  ("what does Oregon require…"). Adoption records let federal chunks answer for
  adopt-verbatim states, correctly labeled.

---

## 5. The agent: `soteria-chat` Edge Function

Same shape as `ai-draft` — key server-side, app talks through the seam:

- Claude with a `search_regulations` tool (the hybrid RPC); the model runs an agentic
  retrieve → read → answer loop (multi-hop for compare-jurisdiction questions).
- **Model:** default `claude-sonnet-5`, env-configurable (`AI_CHAT_MODEL`) — same
  pattern as ai-draft's `claude-opus-4-8` default. Sonnet is the right cost/latency
  tier for grounded Q&A; escalate per-org later if evals demand it.
- **Citations are mandatory and verified:** the function only emits citations whose IDs
  match chunks actually retrieved in this turn; answers with no supporting retrieval
  return "I can't find that in the corpus" rather than a guess.
- **Guardrails in the system prompt:** informational reference, not legal advice; state
  effective dates; never invent citation numbers; decline out-of-domain (medical,
  legal-strategy) questions.
- Streaming responses; per-org rate limits; every call metered into `ai_usage`
  (migration 0002) with a `feature = 'chat'` discriminator.
- **Non-negotiable #2 holds structurally:** like `requestDraft`, the chat surface
  returns text + citations only — no field in the contract can touch a `rating`.

---

## 6. App surface

- New screen `src/app/chat.tsx` (+ optional per-item entry point "Ask Soteria about
  this standard" pre-seeded with the item's citation).
- Paper UI, dark-first, 48pt targets, **voice-first input** — same field conditions as
  the audit loop.
- Citation cards under each answer: citation, heading path, effective date, source
  link, jurisdiction badge.
- **Offline posture (Non-negotiable #3):** chat is inherently online. It degrades
  gracefully — the screen renders, shows the same "connects when online" state as
  ai-draft, and never blocks anything. Offline mitigation that *is* shippable: at ETL
  time, map each of the 374 library items to its citation(s) and bundle those excerpt
  texts into the seed, so the item card can show the underlying reg text with zero
  connectivity. The chatbot is the online superset of that.

---

## 7. Phases

| Phase | Deliverable | Acceptance | Status |
|---|---|---|---|
| **C0 — Decisions** | Jamil signs off on §10 open decisions | — | ⏳ open |
| **C1 — Federal ETL** | `scripts/reg-etl/` pulls all 7 CFR parts from the eCFR API into `reg_documents`; idempotent re-runs via `content_hash` | Deterministic counts; re-run produces zero spurious diffs | ✅ built — 853 docs / 3,608 chunks parsed from the live eCFR (2026-07-09); hash-diff loader unit-tested |
| **C2 — Index + retrieval** | Chunking, embeddings, hybrid-search RPC | Recall@10 ≥ 0.9 on a retrieval smoke set | ✅ built — structure-aware chunker (≤1000 tok, citation-header prefix), voyage-law-2 indexer, RRF hybrid RPC in `0003_reg_corpus.sql`; 20-question smoke set in `packages/ai-evals` (live gate env-gated) |
| **C3 — Chat Edge Function** | `soteria-chat` with tool-use loop, citation verification, jurisdiction filter, `ai_usage` metering | Golden-set eval passes (§8); no answer ships an unretrieved citation | ✅ built — non-streaming v1 (matches ai-draft); `_shared/citations.ts` strips unretrieved citation tokens structurally (unit-tested) |
| **C4 — App chat screen** | Chat UI + per-item entry point + offline degradation | Works on iOS/Android/Web; audit loop untouched offline | ✅ built — `src/app/chat.tsx` (Paper, dark-first, 48pt, citation cards → ecfr.gov), home-screen row, item-card "Ask Soteria" seeded with the item's citation + audit's state plan |
| **C5 — State wave 1** | Adoption model + adapters for priority states (pick in C0; CA/WA/OR/MI are the big divergent four) | State-specific golden questions pass; adopt-verbatim states answer via federal chunks with correct labeling | ⏳ (`reg_adoptions` schema ready) |
| **C6 — State long tail + Tier 2** | Remaining adapters; interpretation letters/directives corpus | Full 29-plan jurisdiction routing | ⏳ |
| **C7 — Freshness** | Scheduled re-ingest + diff + monitoring (§9) | A simulated eCFR change lands in the corpus within one cycle, with changelog | ⏳ (`npm run reg-etl` is already the idempotent re-ingest; needs the cron wrapper) |

### Cloud bring-up (the only steps left to a live chatbot)
```bash
# 1. Apply supabase/migrations/0003_reg_corpus.sql (SQL editor or supabase db push)
# 2. Secrets for the Edge Function:
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   # required
supabase secrets set VOYAGE_API_KEY=pa-...          # optional; omit = FTS-only retrieval
# 3. Deploy:
supabase functions deploy soteria-chat
# 4. Load the corpus (service role; re-runs are no-ops until the eCFR changes):
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npm run reg-etl
# 5. Acceptance: retrieval smoke set against the live corpus
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npm test
```

---

## 8. Evals — the supervision that actually matters (`packages/ai-evals`)

The golden set is where SME effort goes (Jamil/Jay), ~150–200 questions across
jurisdictions and difficulty tiers, run in CI like the §1.2 scoring validation:

- **Retrieval:** recall@k against known-correct citations.
- **Citation validity:** every cited chunk was retrieved this turn *and* contains text
  supporting the claim (string + LLM-judge check).
- **Jurisdiction correctness:** CA question → Title 8 answer, not the federal-only one.
- **Faithfulness:** LLM-judge scores answer-vs-chunks; regression-gated.
- **Refusals:** out-of-scope and no-evidence questions must decline, not improvise.

---

## 9. Freshness pipeline

- Weekly cron (Supabase scheduled function): hit the eCFR versions endpoint, diff by
  `content_hash`, re-chunk/re-embed only changed documents, write a changelog row.
- State adapters on per-state cadence (monthly default); adapter failures alert rather
  than silently serving stale text.
- Answers can surface recency: "this section was last amended {date}".

## 10. Open decisions (do not guess — same rule as CLAUDE.md Part 5)

1. **State priority order for wave 1** — which states do WLS / first tenants operate
   in? (Determines C5 scope; CA alone is ~40% of the state-plan work.)
2. **Tier 2 corpus timing** — interpretation letters materially improve answers but add
   a scraping surface; C6 or earlier?
3. **Chat model tier** — Sonnet default proposed; confirm, and whether per-org override
   is worth exposing.
4. **Entry points** — standalone chat screen only, or also embedded on the item card at
   launch?
5. **Retention** — how long do chat logs live, and are they visible to org admins?
   (Privacy posture worth deciding before pilot.)

## 11. Cost ballpark

- Corpus: tens of MB of text → low hundreds of thousands of chunks; one-time embedding
  < $50; pgvector storage negligible on the existing Supabase project.
- Per question: retrieval ~free; one Sonnet call with retrieved context ≈ $0.01–0.05.
- Weekly freshness re-embeds: pennies (hash-diff means only changed docs).

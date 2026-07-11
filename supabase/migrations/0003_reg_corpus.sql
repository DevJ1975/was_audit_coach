-- Soteria Chat (Phases C1–C3, SOTERIA_CHAT_KB_PLAN.md) — regulation corpus,
-- hybrid retrieval, and chat metering.
--
-- The corpus is GLOBAL public reference data (like the item library): no org_id,
-- read-only to authenticated users, written only by the reg-etl pipeline under
-- the service role. Tenant data stays under RLS as ever (Non-Negotiable #5).
-- Chat transcripts are deliberately NOT persisted server-side yet — retention &
-- admin visibility is an open decision (§10.5 of the chat plan); do not guess.

create extension if not exists vector;

-- ─────────────────────────────────────────────────────────────────────────────
-- Documents: one row per regulation section / appendix. `id` is deterministic
-- (e.g. 'ecfr:1910.147') so ETL re-runs upsert instead of duplicating;
-- `content_hash` is the idempotency/diff key (same pattern as the item library).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists reg_documents (
  id            text primary key,              -- 'ecfr:1910.147', 'ecfr:1904/appendix-…'
  jurisdiction  text not null default 'federal',
  citation      text not null,                 -- '29 CFR 1910.147'
  title         text not null,                 -- 'The control of hazardous energy (lockout/tagout).'
  heading_path  text not null,                 -- 'Part 1910 › Subpart J › § 1910.147 …'
  part          text not null,                 -- '1910'
  body          text not null,                 -- full normalized text (chunks derive from this)
  source_url    text not null,
  last_amended  date,                          -- from the section's source credit, when parseable
  version       text not null,                 -- eCFR issue date the text was pulled at
  content_hash  text not null,
  fetched_at    timestamptz not null default now()
);
create index if not exists idx_reg_documents_jur  on reg_documents(jurisdiction, part);
create index if not exists idx_reg_documents_cite on reg_documents(citation);

-- ─────────────────────────────────────────────────────────────────────────────
-- Chunks: structure-aware slices of a document (~500–900 tokens). Denormalized
-- citation/jurisdiction so retrieval never needs a join. Embeddings are
-- voyage-law-2 / voyage-3.5 (1024-dim); NULL embedding = FTS-only until indexed.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists reg_chunks (
  id            text primary key,              -- '<document_id>#<ordinal>'
  document_id   text not null references reg_documents(id) on delete cascade,
  ordinal       int  not null,
  jurisdiction  text not null,
  citation      text not null,
  heading_path  text not null,
  text          text not null,
  token_count   int  not null,
  embedding     vector(1024),
  fts           tsvector generated always as (to_tsvector('english', text)) stored,
  unique (document_id, ordinal)
);
create index if not exists idx_reg_chunks_fts on reg_chunks using gin(fts);
create index if not exists idx_reg_chunks_vec on reg_chunks
  using hnsw (embedding vector_cosine_ops);
create index if not exists idx_reg_chunks_doc on reg_chunks(document_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- State-plan adoption map (populated in Phase C5). Lets federal chunks answer
-- for adopt-verbatim states, correctly labeled.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists reg_adoptions (
  state            text not null,              -- 'CA', 'WA', …
  federal_citation text not null,              -- '29 CFR 1910.147'
  status           text not null check (status in ('identical','amended','state_unique')),
  state_citation   text,                       -- '8 CCR §3314' where it diverges
  note             text,
  primary key (state, federal_citation)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: corpus is readable by any authenticated user; API writes are denied
-- (no insert/update policies — the ETL uses the service role, which bypasses RLS).
-- ─────────────────────────────────────────────────────────────────────────────
alter table reg_documents enable row level security;
alter table reg_chunks    enable row level security;
alter table reg_adoptions enable row level security;

do $$
declare t text;
begin
  foreach t in array array['reg_documents','reg_chunks','reg_adoptions']
  loop
    execute format('drop policy if exists reg_read on %I', t);
    execute format($f$create policy reg_read on %I for select to authenticated using (true)$f$, t);
  end loop;
end $$;

grant select on reg_documents, reg_chunks, reg_adoptions to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Hybrid retrieval RPC (Phase C2): reciprocal-rank fusion of vector similarity
-- and full-text rank. Regulation Q&A needs BOTH — users type citation numbers
-- ("1910.147") and terms of art that pure vectors fumble. `q_embedding` may be
-- NULL (Voyage key not configured) → degrades to FTS-only, never errors.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.search_regulations(
  q             text,
  q_embedding   vector(1024) default null,
  jurisdictions text[] default array['federal'],
  match_count   int default 8
) returns table (
  chunk_id     text,
  citation     text,
  heading_path text,
  jurisdiction text,
  source_url   text,
  last_amended date,
  body         text,
  score        float
)
language sql stable
as $$
  with fts_hits as (
    select c.id, row_number() over (
      order by ts_rank_cd(c.fts, websearch_to_tsquery('english', q)) desc
    ) as rank
    from reg_chunks c
    where c.jurisdiction = any(jurisdictions)
      and c.fts @@ websearch_to_tsquery('english', q)
    limit 40
  ),
  vec_hits as (
    select c.id, row_number() over (
      order by c.embedding <=> q_embedding
    ) as rank
    from reg_chunks c
    where q_embedding is not null
      and c.embedding is not null
      and c.jurisdiction = any(jurisdictions)
    order by c.embedding <=> q_embedding
    limit 40
  ),
  fused as (
    select coalesce(f.id, v.id) as id,
           coalesce(1.0 / (60 + f.rank), 0) + coalesce(1.0 / (60 + v.rank), 0) as score
    from fts_hits f
    full outer join vec_hits v on v.id = f.id
  )
  select c.id, c.citation, c.heading_path, c.jurisdiction,
         d.source_url, d.last_amended, c.text, fused.score
  from fused
  join reg_chunks c on c.id = fused.id
  join reg_documents d on d.id = c.document_id
  order by fused.score desc
  limit greatest(1, least(match_count, 20));
$$;

grant execute on function public.search_regulations to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Metering: soteria_chat joins the allowed ai_usage kinds (same table, same RLS).
-- ─────────────────────────────────────────────────────────────────────────────
alter table ai_usage drop constraint if exists ai_usage_kind_check;
alter table ai_usage add constraint ai_usage_kind_check
  check (kind in ('observation_polish','recommendation_draft','aria_coach','soteria_chat'));

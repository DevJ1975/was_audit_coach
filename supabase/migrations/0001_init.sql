-- Soteria Audit — initial schema, RLS, and JWT helpers (Phase 4).
-- Tenant isolation lives HERE (Postgres RLS keyed on org_id from JWT claims),
-- never in the app layer (Non-Negotiable #5). Every tenant table carries org_id.
-- The local SQLite schema (src/db/database.ts) mirrors these tables so sync is a
-- transport concern, not a remodel.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- JWT claim helpers. org_id and role are set in the user's app_metadata at
-- sign-up / via an admin, and land in the JWT. RLS reads them through these.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.auth_org_id() returns text
  language sql stable
  as $$
    select nullif(
      coalesce(
        current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'org_id',
        current_setting('request.jwt.claims', true)::jsonb ->> 'org_id'
      ), '')
  $$;

create or replace function public.auth_role() returns text
  language sql stable
  as $$
    select nullif(
      coalesce(
        current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role',
        current_setting('request.jwt.claims', true)::jsonb ->> 'role'
      ), '')
  $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums (rating enum MUST match packages/scoring-engine exactly).
-- ─────────────────────────────────────────────────────────────────────────────
do $$ begin
  create type role_t as enum ('admin','lead_auditor','auditor','site_manager','counsel_viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type audit_status_t as enum ('draft','in_progress','complete','archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type rating_t as enum
    ('Best Practice','Verified','Low','Moderate','High','Very High','Not Applicable');
exception when duplicate_object then null; end $$;

do $$ begin
  create type attachment_kind_t as enum ('photo','document','voice');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ca_status_t as enum ('open','in_progress','verified','closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sync_state_t as enum ('local','synced','needs_resolution');
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at trigger
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at() returns trigger
  language plpgsql as $$
  begin new.updated_at = now(); return new; end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tenancy roots
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists orgs (
  id                text primary key,             -- matches JWT app_metadata.org_id (e.g. 'wls')
  slug              text unique not null,
  name              text not null,
  plan              text not null default 'pilot',
  theme             jsonb not null default '{}'::jsonb,  -- white-label brand tokens + logo url
  privilege_default boolean not null default true,
  analytics_opt_in  boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  org_id     text not null references orgs(id),
  role       role_t not null default 'auditor',
  full_name  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists facilities (
  id         uuid primary key default gen_random_uuid(),
  org_id     text not null references orgs(id),
  name       text not null,
  address    text,
  naics_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Item library — GLOBAL, read-only, versioned (content_hash for diffs).
-- Not tenant-scoped: every org audits against the same federal/state corpus.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists item_library_versions (
  id         text primary key,             -- e.g. 'library-v1'
  notes      text,
  created_at timestamptz not null default now()
);

create table if not exists items (
  library_version_id text not null references item_library_versions(id),
  item_code          text not null,
  section_code       text not null,
  subsection         text,
  requirement        text not null,
  evidence_protocol  text not null,
  max_points         int  not null check (max_points between 1 and 10),
  citation           text not null,
  sif_potential      boolean not null default false,
  content_hash       text not null,
  state              text,                  -- null = federal; else state-plan name
  primary key (library_version_id, item_code)
);

create table if not exists scoping_questions (
  library_version_id text not null references item_library_versions(id),
  key                text not null,
  question           text not null,
  activates          text[] not null default '{}',
  applies_on         text not null default 'Yes',   -- 'Yes' | 'No' (inverted rows)
  primary key (library_version_id, key)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Audits & audit state (all tenant-scoped)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists audits (
  id                  uuid primary key default gen_random_uuid(),
  org_id              text not null references orgs(id),
  facility_id         uuid references facilities(id),
  title               text not null,
  status              audit_status_t not null default 'in_progress',
  privileged          boolean not null default false,
  attorney_of_record  text,
  state_plan          text,
  library_version_id  text not null references item_library_versions(id),  -- FROZEN at creation
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists audit_scoping_answers (
  audit_id     uuid not null references audits(id) on delete cascade,
  org_id       text not null references orgs(id),
  question_key text not null,
  answer       boolean not null,
  primary key (audit_id, question_key)
);

create table if not exists audit_items (
  id              uuid primary key default gen_random_uuid(),
  org_id          text not null references orgs(id),
  audit_id        uuid not null references audits(id) on delete cascade,
  item_code       text not null,
  section_code    text not null,
  applicable      boolean not null default true,
  rating          rating_t,
  observations    text not null default '',
  recommendations text not null default '',
  auditor_notes   text not null default '',
  ai_generated    boolean not null default false,
  sync_state      sync_state_t not null default 'synced',
  updated_at      timestamptz not null default now(),
  unique (audit_id, item_code)
);

-- Immutable event log — analytics substrate AND privilege trail (Non-Negotiable #6).
create table if not exists audit_item_events (
  id            uuid primary key default gen_random_uuid(),
  org_id        text not null references orgs(id),
  audit_id      uuid not null references audits(id) on delete cascade,
  audit_item_id uuid not null references audit_items(id) on delete cascade,
  type          text not null,
  payload       jsonb not null default '{}'::jsonb,
  actor_id      uuid references auth.users(id),
  created_at    timestamptz not null default now()
);

create table if not exists attachments (
  id            uuid primary key default gen_random_uuid(),
  org_id        text not null references orgs(id),
  audit_item_id uuid not null references audit_items(id) on delete cascade,
  kind          attachment_kind_t not null,
  storage_path  text not null,                 -- tenant bucket object path
  transcription text,
  created_at    timestamptz not null default now()
);

create table if not exists corrective_actions (
  id                             uuid primary key default gen_random_uuid(),
  org_id                         text not null references orgs(id),
  audit_id                       uuid not null references audits(id) on delete cascade,
  audit_item_id                  uuid not null references audit_items(id) on delete cascade,
  rating                         rating_t not null,
  assigned_to                    text,
  due_date                       date,
  status                         ca_status_t not null default 'open',
  verified_by                    text,
  close_date                     date,
  closure_evidence_attachment_id uuid references attachments(id),
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now()
);

-- Every view/export of a privileged audit (attorney-client trail, Part 1.5).
create table if not exists disclosure_log (
  id         uuid primary key default gen_random_uuid(),
  org_id     text not null references orgs(id),
  audit_id   uuid not null references audits(id) on delete cascade,
  actor_id   uuid references auth.users(id),
  action     text not null check (action in ('view','export')),
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_audit_items_audit  on audit_items(audit_id);
create index if not exists idx_events_item        on audit_item_events(audit_item_id);
create index if not exists idx_events_audit        on audit_item_events(audit_id);
create index if not exists idx_attachments_item    on attachments(audit_item_id);
create index if not exists idx_ca_audit            on corrective_actions(audit_id);
create index if not exists idx_disclosure_audit    on disclosure_log(audit_id);
create index if not exists idx_audits_org          on audits(org_id);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['orgs','profiles','facilities','audits','audit_items','corrective_actions']
  loop
    execute format('drop trigger if exists set_updated_at on %I', t);
    execute format('create trigger set_updated_at before update on %I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS. Tenant tables: org_id = auth_org_id(). Privileged audits are readable
-- only by admin / lead_auditor / counsel_viewer. Library tables: global read.
-- ─────────────────────────────────────────────────────────────────────────────
alter table orgs                  enable row level security;
alter table profiles              enable row level security;
alter table facilities            enable row level security;
alter table audits                enable row level security;
alter table audit_scoping_answers enable row level security;
alter table audit_items           enable row level security;
alter table audit_item_events     enable row level security;
alter table attachments           enable row level security;
alter table corrective_actions    enable row level security;
alter table disclosure_log        enable row level security;
alter table item_library_versions enable row level security;
alter table items                 enable row level security;
alter table scoping_questions     enable row level security;

-- Library: any authenticated user may read; nobody writes via the API.
do $$
declare t text;
begin
  foreach t in array array['item_library_versions','items','scoping_questions']
  loop
    execute format('drop policy if exists lib_read on %I', t);
    execute format($f$create policy lib_read on %I for select to authenticated using (true)$f$, t);
  end loop;
end $$;

-- orgs: a user sees only their own org row.
drop policy if exists org_self on orgs;
create policy org_self on orgs for select to authenticated using (id = auth_org_id());

-- profiles: same-org visibility.
drop policy if exists profiles_same_org on profiles;
create policy profiles_same_org on profiles for select to authenticated using (org_id = auth_org_id());

-- Generic tenant tables: full CRUD within your own org.
do $$
declare t text;
begin
  foreach t in array array[
    'facilities','audit_scoping_answers','audit_items','audit_item_events',
    'attachments','corrective_actions','disclosure_log'
  ]
  loop
    execute format('drop policy if exists tenant_all on %I', t);
    execute format($f$create policy tenant_all on %I for all to authenticated
      using (org_id = auth_org_id()) with check (org_id = auth_org_id())$f$, t);
  end loop;
end $$;

-- audits: same-org AND (not privileged OR privileged-cleared role).
drop policy if exists audits_select on audits;
create policy audits_select on audits for select to authenticated
  using (
    org_id = auth_org_id()
    and (privileged = false or auth_role() in ('admin','lead_auditor','counsel_viewer'))
  );

drop policy if exists audits_write on audits;
create policy audits_write on audits for all to authenticated
  using (org_id = auth_org_id())
  with check (org_id = auth_org_id());

-- Storage bucket for evidence (tenant-scoped path prefix org_id/...).
insert into storage.buckets (id, name, public)
  values ('evidence','evidence', false)
  on conflict (id) do nothing;

drop policy if exists evidence_tenant on storage.objects;
create policy evidence_tenant on storage.objects for all to authenticated
  using (bucket_id = 'evidence' and (storage.foldername(name))[1] = auth_org_id())
  with check (bucket_id = 'evidence' and (storage.foldername(name))[1] = auth_org_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants. RLS restricts ROWS; the authenticated role still needs table
-- privileges. (Supabase default privileges usually cover this, but we make it
-- explicit so applying via the SQL editor is self-sufficient.)
-- ─────────────────────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on item_library_versions, items, scoping_questions to anon;

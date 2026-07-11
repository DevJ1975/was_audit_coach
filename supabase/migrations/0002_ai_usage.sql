-- AI usage metering (Phase 3). One row per ai-draft call, tenant-scoped.
create table if not exists ai_usage (
  id            uuid primary key default gen_random_uuid(),
  org_id        text not null references orgs(id),
  user_id       uuid references auth.users(id),
  kind          text not null check (kind in ('observation_polish','recommendation_draft','aria_coach')),
  model         text not null,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_ai_usage_org on ai_usage(org_id, created_at);

alter table ai_usage enable row level security;

-- Insert/read confined to your own org (server inserts under the caller's JWT).
drop policy if exists ai_usage_tenant on ai_usage;
create policy ai_usage_tenant on ai_usage for all to authenticated
  using (org_id = auth_org_id()) with check (org_id = auth_org_id());

grant select, insert on ai_usage to authenticated;

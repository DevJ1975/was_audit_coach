-- RLS isolation test — proves Phase 4 exit criterion "two orgs, zero cross-tenant
-- reads". Run AFTER applying 0001_init.sql. Paste into the Supabase SQL editor (or
-- `supabase db execute --file supabase/tests/rls_isolation_test.sql`). It runs in a
-- transaction and ROLLS BACK, leaving no data behind. It RAISES an exception on any
-- leak, or prints "✓ RLS isolation verified" on success.

begin;

-- ── Setup as the table owner (bypasses RLS) ─────────────────────────────────
insert into orgs (id, slug, name) values
  ('org_a','org_a','Org A'), ('org_b','org_b','Org B')
  on conflict (id) do nothing;

insert into item_library_versions (id) values ('rls-test-v') on conflict (id) do nothing;

insert into audits (id, org_id, title, privileged, library_version_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','org_a','A — normal',   false,'rls-test-v'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','org_a','A — privileged',true, 'rls-test-v'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','org_b','B — normal',   false,'rls-test-v');

-- ── Act as an authenticated AUDITOR in org_a ────────────────────────────────
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","app_metadata":{"org_id":"org_a","role":"auditor"}}',
  true
);

do $$
declare own int; other int; priv int;
begin
  select count(*) into own   from audits where org_id = 'org_a' and privileged = false;
  select count(*) into other from audits where org_id = 'org_b';
  select count(*) into priv  from audits where privileged = true;

  if own < 1 then
    raise exception 'RLS FAIL: org_a auditor cannot see its own non-privileged audit';
  end if;
  if other <> 0 then
    raise exception 'RLS FAIL: org_a sees % org_b audit(s) — CROSS-TENANT LEAK', other;
  end if;
  -- An 'auditor' is NOT privilege-cleared, so the privileged audit must be hidden.
  if priv <> 0 then
    raise exception 'RLS FAIL: auditor role sees % privileged audit(s) — privilege leak', priv;
  end if;
  raise notice 'org_a auditor: sees own non-privileged, 0 cross-tenant, 0 privileged — OK';
end $$;

-- ── Act as a LEAD AUDITOR in org_a (privilege-cleared) ──────────────────────
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","app_metadata":{"org_id":"org_a","role":"lead_auditor"}}',
  true
);

do $$
declare priv int; other int;
begin
  select count(*) into priv  from audits where org_id = 'org_a' and privileged = true;
  select count(*) into other from audits where org_id = 'org_b';
  if priv < 1 then
    raise exception 'RLS FAIL: lead_auditor cannot see its org privileged audit';
  end if;
  if other <> 0 then
    raise exception 'RLS FAIL: lead_auditor sees % org_b audit(s) — CROSS-TENANT LEAK', other;
  end if;
  raise notice 'org_a lead_auditor: sees privileged own audit, 0 cross-tenant — OK';
end $$;

do $$ begin raise notice '✓ RLS isolation verified (zero cross-tenant reads; privilege gating enforced)'; end $$;

rollback;

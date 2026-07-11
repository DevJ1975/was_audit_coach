-- 0006_multi_tenant_onboarding.sql
-- Tenants per login (owner decision, 2026-07-11): a new signup either JOINS
-- the org that invited their email, or CREATES a fresh tenant and becomes its
-- admin. Provisioning writes org_id/role into raw_app_meta_data — the same
-- claims RLS already keys on (NN #5) and the client already reads — so no
-- policy or client-claims change is needed. Replaces hand-run SQL provisioning.

-- ─── Invites ─────────────────────────────────────────────────────────────────
-- Plain tenant table: org admins manage their own org's invites through RLS;
-- the signup trigger consumes rows with definer rights.
create table if not exists org_invites (
  id         uuid primary key default gen_random_uuid(),
  org_id     text not null references orgs(id) on delete cascade,
  email      text not null,
  role       role_t not null default 'auditor',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index if not exists uq_org_invites_email on org_invites (lower(email));
create index if not exists idx_org_invites_org on org_invites (org_id);

alter table org_invites enable row level security;

-- Only org admins / lead auditors see and manage their own org's invites.
drop policy if exists org_invites_admin on org_invites;
create policy org_invites_admin on org_invites for all to authenticated
  using (org_id = auth_org_id() and auth_role() in ('admin','lead_auditor'))
  with check (org_id = auth_org_id() and auth_role() in ('admin','lead_auditor'));

grant select, insert, delete on org_invites to authenticated;

-- ─── Signup provisioning ─────────────────────────────────────────────────────
-- Members list needs a human-readable identity: carry email on profiles
-- (populated by the trigger; backfilled below for pre-trigger users).
alter table profiles add column if not exists email text;

-- BEFORE INSERT on auth.users: mutate NEW (no recursive update) so the very
-- first JWT already carries org_id/role. Invited email → that org/role;
-- otherwise a fresh tenant named from signup metadata (org_name) or the email.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite   org_invites%rowtype;
  v_org_id   text;
  v_role     role_t;
  v_org_name text;
begin
  select * into v_invite from org_invites where lower(email) = lower(new.email) limit 1;

  if found then
    v_org_id := v_invite.org_id;
    v_role   := v_invite.role;
    delete from org_invites where id = v_invite.id;
  else
    -- Fresh tenant: server-minted id (never client-chosen), creator is admin.
    v_org_id   := 'org-' || replace(substr(new.id::text, 1, 13), '-', '');
    v_role     := 'admin';
    v_org_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'org_name', '')), '');
    if v_org_name is null then
      v_org_name := split_part(coalesce(new.email, 'New Organization'), '@', 1) || ' organization';
    end if;
    insert into orgs (id, slug, name) values (v_org_id, v_org_id, v_org_name)
      on conflict (id) do nothing;
  end if;

  new.raw_app_meta_data :=
    coalesce(new.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('org_id', v_org_id, 'role', v_role::text);

  insert into profiles (id, org_id, role, email) values (new.id, v_org_id, v_role, new.email)
    on conflict (id) do update set email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  before insert on auth.users
  for each row execute function public.handle_new_user();

-- Lock the definer function down: only the auth pipeline calls it.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Backfill: users provisioned before this trigger (the pilot admin) get a
-- profile row from their existing claims.
insert into profiles (id, org_id, role, email)
select u.id,
       u.raw_app_meta_data ->> 'org_id',
       coalesce((u.raw_app_meta_data ->> 'role')::role_t, 'auditor'),
       u.email
from auth.users u
where u.raw_app_meta_data ->> 'org_id' is not null
  and exists (select 1 from orgs o where o.id = u.raw_app_meta_data ->> 'org_id')
on conflict (id) do update set email = excluded.email;

-- Role management: admins change teammates' roles. SECURITY DEFINER because
-- the JWT claim lives in auth.users; the profile row is updated in lockstep.
-- Claims take effect at the target's next token refresh.
create or replace function public.set_member_role(target_user uuid, new_role role_t)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth_role() <> 'admin' then
    raise exception 'Only org admins can change roles.';
  end if;
  if target_user = auth.uid() then
    raise exception 'You cannot change your own role.';
  end if;
  if not exists (select 1 from profiles p where p.id = target_user and p.org_id = auth_org_id()) then
    raise exception 'No such member in your organization.';
  end if;

  update profiles set role = new_role, updated_at = now() where id = target_user;
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
         || jsonb_build_object('role', new_role::text)
   where id = target_user;
end;
$$;

revoke execute on function public.set_member_role(uuid, role_t) from public, anon;
grant execute on function public.set_member_role(uuid, role_t) to authenticated;

-- Org rename: admins only, name column only (column-level grant + policy).
drop policy if exists orgs_admin_update on orgs;
create policy orgs_admin_update on orgs for update to authenticated
  using (id = auth_org_id() and auth_role() = 'admin')
  with check (id = auth_org_id() and auth_role() = 'admin');
revoke update on orgs from authenticated;
grant update (name) on orgs to authenticated;

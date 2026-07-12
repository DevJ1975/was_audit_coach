-- 0007_fix_signup_profile_fk.sql
-- Signup was failing for every new user with a 500 "Database error saving new
-- user". Root cause: handle_new_user() ran BEFORE INSERT on auth.users and
-- inserted the profiles row in the same statement — but profiles.id has a FK to
-- auth.users(id), and on a BEFORE INSERT the auth.users row does not exist yet,
-- so profiles_id_fkey (23503) failed and the whole signup transaction rolled
-- back. (This is why the app showed an unhelpful "{}" and no users could be
-- created.)
--
-- Fix: keep claim-stamping in the BEFORE trigger (it must mutate NEW so the very
-- first JWT already carries org_id/role — NN #5), and move the profile insert to
-- an AFTER INSERT trigger, by which point the auth.users row exists and the FK
-- is satisfiable. The AFTER trigger reads org_id/role back out of the claims the
-- BEFORE trigger just stamped.

-- BEFORE INSERT: invite consumption + fresh-tenant creation + claim stamping.
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

  return new;
end;
$$;

-- AFTER INSERT: auth.users row now exists, so the profiles FK is satisfiable.
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, org_id, role, email)
  values (
    new.id,
    new.raw_app_meta_data ->> 'org_id',
    coalesce((new.raw_app_meta_data ->> 'role')::role_t, 'auditor'),
    new.email
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  before insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

-- Definer functions: only the auth pipeline should call them.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_new_user_profile() from public, anon, authenticated;

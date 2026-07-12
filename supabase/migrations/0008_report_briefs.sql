-- 0008 — Legal-grade report briefs (two-agent CSP + attorney AI narrative).
--
-- Mirrors the local report_briefs table (src/db/database.ts v4). The AI drafts
-- narrative TEXT only; this table stores NO ratings or scores (those recompute
-- deterministically at render — NN #2). Only an ACCEPTED brief is ever synced
-- here, so unreviewed AI text never becomes an org record. Acceptance is also
-- recorded in disclosure_log, whose action CHECK is widened below.
--
-- generated_by / accepted_by are text (not auth.users FKs) so field-mode actor
-- ids survive as provenance, matching how the event trail keeps actor locally.

create table if not exists report_briefs (
  id                 uuid primary key default gen_random_uuid(),
  org_id             text not null references orgs(id),
  audit_id           uuid not null references audits(id) on delete cascade,
  content            jsonb not null,           -- the accepted LegalBriefDraft
  model              text not null,            -- which Claude model drafted it
  library_version_id text not null,
  generated_at       timestamptz not null default now(),
  generated_by       text,
  accepted_by        text,
  accepted_at        timestamptz,
  ai_generated       boolean not null default true,
  updated_at         timestamptz not null default now()
);

create index if not exists idx_briefs_audit on report_briefs(audit_id);

drop trigger if exists set_updated_at on report_briefs;
create trigger set_updated_at before update on report_briefs
  for each row execute function public.set_updated_at();

alter table report_briefs enable row level security;

-- SELECT: same org, and privileged audits only to cleared roles — the brief is
-- the sensitive legal deliverable, so it follows the audits-header clearance.
drop policy if exists report_briefs_select on report_briefs;
create policy report_briefs_select on report_briefs for select to authenticated
  using (
    org_id = auth_org_id()
    and exists (
      select 1 from audits a
      where a.id = report_briefs.audit_id
        and (a.privileged = false or auth_role() in ('admin','lead_auditor','counsel_viewer'))
    )
  );

-- WRITE: only lead auditors / admins author briefs (the roles that own ratings).
drop policy if exists report_briefs_write on report_briefs;
create policy report_briefs_write on report_briefs for all to authenticated
  using (org_id = auth_org_id() and auth_role() in ('admin','lead_auditor'))
  with check (org_id = auth_org_id() and auth_role() in ('admin','lead_auditor'));

grant select, insert, update, delete on report_briefs to authenticated;

-- Widen the disclosure_log action enum for the brief lifecycle (brief_generated
-- when the AI draft is produced, brief_accepted when a human accepts it).
alter table disclosure_log drop constraint if exists disclosure_log_action_check;
alter table disclosure_log add constraint disclosure_log_action_check
  check (action in ('view','export','brief_generated','brief_accepted'));

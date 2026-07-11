-- Audit Coach (managed-agent techniques mentor, audit-coach Edge Function)
-- joins the allowed ai_usage kinds. Same table, same tenant RLS as ever.
alter table ai_usage drop constraint if exists ai_usage_kind_check;
alter table ai_usage add constraint ai_usage_kind_check
  check (kind in (
    'observation_polish',
    'recommendation_draft',
    'aria_coach',
    'soteria_chat',
    'audit_coach'
  ));

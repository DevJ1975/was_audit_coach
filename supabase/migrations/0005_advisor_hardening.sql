-- Security-advisor hardening (Supabase linter 0011): pin search_path on all
-- SQL functions so a caller-controlled search_path can never redirect table or
-- function resolution inside them. (The remaining advisor note — pgvector
-- installed in `public` — is a placement convention; moving an extension with
-- live column types is not worth the churn.)
alter function public.auth_org_id() set search_path = public;
alter function public.auth_role() set search_path = public;
alter function public.set_updated_at() set search_path = public;
alter function public.search_regulations(text, vector, text[], int) set search_path = public;

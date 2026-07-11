# Supabase (Phase 4)

## Apply the schema

The migration creates the full Part 3 schema + RLS + JWT helpers. Apply it to your
project (`dklwdrtvvjoivmxljcof`) either way:

**Dashboard:** SQL Editor → paste `migrations/0001_init.sql` → Run.

**CLI:**
```bash
supabase link --project-ref dklwdrtvvjoivmxljcof
supabase db push          # applies migrations/0001_init.sql
```

## Verify RLS isolation (Phase 4 exit criterion)

After applying, run `tests/rls_isolation_test.sql` (SQL Editor, or
`supabase db execute --file supabase/tests/rls_isolation_test.sql`). It runs in a
transaction and rolls back — it raises an exception on any cross-tenant leak, or
prints `✓ RLS isolation verified`. It checks:
- org_a auditor sees its own non-privileged audit, **zero** org_b rows;
- an `auditor` role cannot see a **privileged** audit;
- a `lead_auditor` (privilege-cleared) can.

## App wiring

- Client: `src/db/supabase.ts` (reads `EXPO_PUBLIC_SUPABASE_URL` / `_PUBLISHABLE_KEY`).
- Auth + field mode: `src/auth/AuthProvider.tsx` — org_id/role come from JWT
  `app_metadata`. **Set these when creating users** (admin API / trigger), e.g.
  `app_metadata: { org_id: 'wls', role: 'lead_auditor' }`.
- Seed the WLS org: `insert into orgs (id, slug, name) values ('wls','wls','Workplace Learning System');`
- Conflict policy: `src/domain/conflict.ts` (LWW per field, rating → needs_resolution).

## AI Edge Functions

Three server-side AI surfaces; the Anthropic key lives only in function secrets.

| Function | Surface | Notes |
| --- | --- | --- |
| `ai-draft` | Observation polish · recommendation draft · per-item ARIA Q&A | Single-shot Messages API |
| `soteria-chat` | Compliance agent — corpus-grounded OSHA Q&A with verified citations | Tool-use loop over `search_regulations` |
| `audit-coach` | Audit Coach — technique mentor inside the audit execution screens | Proxies a pre-built Anthropic **managed agent** (Sessions API); conversation memory lives in the Anthropic session, bound to the creating user |

```bash
supabase functions deploy ai-draft soteria-chat audit-coach
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...        # required by all three
supabase secrets set VOYAGE_API_KEY=pa-...               # optional (soteria-chat hybrid retrieval)
# audit-coach defaults to the Console-built coach agent; override if it changes:
supabase secrets set AUDIT_COACH_AGENT_ID=agent_01LSVADVn3BaTjH4tuVwBHKS
supabase secrets set AUDIT_COACH_ENV_ID=env_01N9MqLvzeMxZ7PbC7yjhBce
```

Metering: every call inserts an `ai_usage` row (`kind` ∈ observation_polish ·
recommendation_draft · aria_coach · soteria_chat · audit_coach — migration 0004).

## Still to build (sync engine)

The push/pull sync (outbox, `updated_at` cursors, attachment upload to the
`evidence` bucket) plugs in behind `src/db/repo.ts`. The conflict-resolution core
it depends on is done and tested (`src/domain/conflict.test.ts`).

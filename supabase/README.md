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

## Still to build (sync engine)

The push/pull sync (outbox, `updated_at` cursors, attachment upload to the
`evidence` bucket) plugs in behind `src/db/repo.ts`. The conflict-resolution core
it depends on is done and tested (`src/domain/conflict.test.ts`).

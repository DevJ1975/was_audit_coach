# Soteria Audit (WLS Audit Coach)

Offline-first EHS audit platform. React Native + Expo (iOS · Android · Web/PWA) ·
Supabase (Phase 4+) · SQLite on-device. Plan of record: `SOTERIA_AUDIT_PHASE_PLAN.md`.
Build contract & non-negotiables: `CLAUDE.md`.

## Status — Phase 0 + Phase 1 (offline core, verified)

| Deliverable | State |
|---|---|
| `packages/scoring-engine` — 1:1 port of the workbook math | ✅ done |
| **§1.2 validation case** — 98.6 / 160 / 61.625% / Bronze in CI | ✅ green |
| `src/theme/tokens.ts` — dark-first, OSHA rating palette | ✅ done |
| `scoring_constants_v1.json`, `pilot_validation_fixture.json` | ✅ done |
| Storage **seam** `src/db/repo.ts` + in-memory reference + **expo-sqlite** impl | ✅ done |
| Audit domain logic — applicability, events, findings, CA queue | ✅ done |
| **Expo app** (expo-router) — 6 Phase-1 screens, dark-first | ✅ done |
| Scoping wizard · section list · item list · **THE ITEM CARD** · findings | ✅ done |
| Debounced autosave with flush-on-leave + save-failure surfacing | ✅ done |
| `npm test` — 26 tests | ✅ green |
| `npm run typecheck` (strict) · `expo export --platform web` | ✅ green |
| Multi-agent adversarial review — 6 findings fixed, 1 refuted | ✅ done |
| ETL `scripts/etl.ts` (xlsx → seed JSON) — layout verified vs. real workbook | ✅ done |
| **Real seed** — 286 federal + 88 state = 374 items · 15 questions · 22 state plans | ✅ loaded |
| `npm test` — 31 tests (incl. seed-count + §1.2 weight cross-check) | ✅ green |
| **Phase 4 backend** — `supabase/migrations/0001_init.sql` (schema + RLS + JWT helpers) | ✅ authored, SQL-parser-validated |
| RLS isolation test (two-org, zero cross-tenant) — `supabase/tests/` | ✅ ready to run |
| Supabase client + Auth (JWT org/role) + **field mode** preserved | ✅ done |
| Conflict policy — LWW per field, rating → `needs_resolution` | ✅ done (9 tests) |
| **React Native Paper** (Material 3) restyle, themed to OSHA tokens | ✅ done |
| WLS logo header (wordmark until PNG) + "Powered by Trainovate" footer | ✅ done |
| Full sync engine (push/pull outbox, attachment upload) | ⏳ next — conflict core done |
| Native runtime (iOS/Android device) verification | ⏳ needs device/simulator |
| SIF curation · confirm FP-16/OH-1/OH-3 polarity · app-store name | ⏳ Part 5 — awaits Jay |

## Commands

```bash
npm install
npm start          # Expo dev server (press w for web, i/a for simulators)
npm run web        # web/PWA
npm test           # scoring + domain suites (CI gate; §1.2 must stay green)
npm run typecheck  # strict tsc
npx expo export --platform web   # verify the app bundles
npm run etl -- WLS_Audit_Coach_OSHA.xlsx   # generate real seed (needs the workbook)
```

## Blockers to advance

1. **The source workbook** `WLS_Audit_Coach_OSHA.xlsx` is not in the repo. It holds
   the 286 federal + 88 state requirement texts and evidence protocols — the product's
   moat. These cannot be fabricated. Drop the file at the repo root and run `npm run etl`.
2. **Device/simulator** for the "boots on iOS/Android" exit criterion. Web/PWA can be
   verified in this environment; native builds need EAS + a device.

## Architecture invariants

- Scoring math is **frozen** — see `packages/scoring-engine`. Never "improve" it.
- Screens touch **`src/db/repo.ts` only** — never the SQLite driver or sync plumbing.
- Every rating/edit appends an immutable `audit_item_events` row.
- AI drafts; humans rate. No code path sets `rating` from a model.

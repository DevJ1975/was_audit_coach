# Soteria Audit (WLS Audit Coach) — Build Contract

Offline-first EHS audit platform. **React Native + Expo** (iOS · Android · Web/PWA) ·
Supabase (Postgres/Auth/Storage/Edge Functions) · SQLite on-device for offline.

Full plan of record: `SOTERIA_AUDIT_PHASE_PLAN.md`. Owner: Jamil Jones, Trainovate Technologies.

## NON-NEGOTIABLES (enforce in every phase)

1. **Never change the scoring math.** `packages/scoring-engine` is a 1:1 port of the
   workbook. The §1.2 validation case (98.6 / 160 / 61.625% / Bronze) runs in CI via
   `npm test`. Any change that breaks it is wrong by definition.
2. **AI drafts; humans rate.** No code path may let a model set `rating`. AI text is a
   draft until an auditor accepts it; acceptance is logged (`ai_draft_accepted`).
3. **Offline-first is the architecture.** Every screen works with zero connectivity;
   all writes hit local SQLite instantly; the UI never blocks on the network.
4. **One stable storage seam.** Screens depend on `src/db/repo.ts` only. Never import
   the SQLite driver (or sync plumbing) in a screen.
5. **Tenant isolation lives in Postgres RLS**, keyed on `org_id` from JWT claims — not
   app-layer filters. Every tenant table carries `org_id`.
6. **Every rating/edit is an immutable event** (`audit_item_events`) as well as current
   state — the analytics substrate and the privilege trail.
7. **Rating & tier colors are semantic and constant** across tenants (OSHA signal
   palette in `src/theme/tokens.ts`). White-labeling overrides `brand` tokens only.
8. **Evidence protocols render prominently** (open by default on the item card) — they
   are the coaching, and the AI grounding corpus.
9. **Show score AND effective max together** everywhere a percentage appears. Small
   sections (MED has 8 items) are only interpretable with the denominator visible.
10. **48pt tap targets, dark-first theme, voice-first text entry** — the user wears
    gloves in a poorly lit plant.

## Conflict policy (sync, Phase 4)
Last-write-wins per field, **EXCEPT `rating`** — divergent offline ratings on the same
item flag `needs_resolution` for the lead auditor. Never silently overwrite a rating.

## Seed / ETL invariants
- Item library: **286 federal + 88 state = 374 items**, plus 15 scoping questions.
- Extract the CLEAN library only. Pilot ratings/observations go into
  `src/seed/pilot_validation_fixture.json`, never into the library.
- `content_hash` per item for future library diffs.

## Open items (do NOT guess — see Part 5 of the plan)
1. **SIF curation** — `sif_potential` defaults `false` on all 374 items; build the field
   + badge, await Jay's SME list.
2. **Three inverted scoping rows — RESOLVED (Jamil, 2026-07-11)**: FP-16
   (standpipe), OH-1 (abrasive blasting), OH-3 (spray finishing) are confirmed
   "No → applies", exactly as the workbook reads and as wired in the seed
   (`applies_on: 'No'` on SCOPE-07/09/10). The other 12 are "Yes → applies".
3. **Naming — RESOLVED (Jamil, 2026-07-11)**: the app ships as **WLS Audit Coach**;
   bundle IDs are `com.trainovate.wlsauditcoach` (`expo.name`, PWA manifest, iOS
   `bundleIdentifier`, Android `package` in `app.json`, Maestro `appId`). "Soteria
   Audit" stays the internal platform name; slug `soteria-audit` and scheme
   `soteria` unchanged. Bundle IDs lock permanently at first store submit.

## Layout
```
packages/scoring-engine/   pure TS scoring + §1.2 validation test (npm test)
src/app/                   expo-router screens
src/db/{database,repo}.ts  SQLite + THE SEAM
src/components/            RatingSelector, TierBadge, ScoreReadout…
src/ai/{prompts,client}.ts
src/theme/tokens.ts        dark-first; OSHA rating palette
src/seed/                  library/state/scoping/constants/fixture JSON
scripts/etl.ts             xlsx → seed JSON (run: npm run etl)
supabase/                  migrations + Edge Functions (Phase 4+)
```

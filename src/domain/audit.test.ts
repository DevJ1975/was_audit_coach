import { describe, it, expect } from 'vitest';
import { createMemoryRepo } from '@/db/memoryRepo.js';
import type { RepoDeps } from '@/db/repo.js';
import type { LibraryItem, CorrectiveAction } from '@/db/types.js';
import type { ScopingQuestion } from '@/domain/applicability.js';
import {
  scoreForAudit,
  deriveFindings,
  reconcileCorrectiveActions,
} from './audit.js';

// Deterministic deps — no Date.now()/randomUUID so tests are reproducible.
function deterministicDeps(): RepoDeps {
  let n = 0;
  return { newId: () => `id-${++n}`, now: () => '2026-07-10T00:00:00.000Z' };
}

// Synthetic library — TEST-ONLY, not real OSHA content.
function lib(item_code: string, section_code: string, max_points: number): LibraryItem {
  return {
    item_code,
    section_code,
    subsection: null,
    requirement: `requirement for ${item_code}`,
    evidence_protocol: `evidence protocol for ${item_code}`,
    max_points,
    citation: '29 CFR 1910.test',
    sif_potential: item_code === 'CS-1',
    content_hash: item_code,
  };
}

const LIBRARY: LibraryItem[] = [
  lib('CS-1', 'CS', 10),
  lib('CS-2', 'CS', 8),
  lib('CS-3', 'CS', 6),
  lib('WW-1', 'WW', 8), // baseline, always applicable
  lib('PIT-1', 'PIT', 6), // gated by forklift question
];

const QUESTIONS: ScopingQuestion[] = [
  { key: 'q_prcs', question: 'PRCS?', activates: ['CS'] },
  { key: 'q_forklift', question: 'Forklifts?', activates: ['PIT'] },
];

async function makeAudit(answers: Record<string, boolean>) {
  const repo = createMemoryRepo(deterministicDeps());
  const audit = await repo.createAudit(
    {
      org_id: 'org-1',
      created_by: 'user-1',
      title: 'Test Audit',
      privileged: true,
      attorney_of_record: 'Conn Maciel Carey LLP',
      state_plan: null,
      library_version_id: 'lib-v1',
      answers,
    },
    { library: LIBRARY, questions: QUESTIONS },
  );
  return { repo, audit };
}

describe('createAudit instantiation + applicability', () => {
  it('instantiates one audit_item per library item with applicability from answers', async () => {
    const { repo, audit } = await makeAudit({ q_prcs: true, q_forklift: false });
    const items = await repo.getAuditItems(audit.id);
    expect(items).toHaveLength(5);
    const byCode = new Map(items.map((i) => [i.item_code, i]));
    expect(byCode.get('CS-1')!.applicable).toBe(true);
    expect(byCode.get('WW-1')!.applicable).toBe(true);
    expect(byCode.get('PIT-1')!.applicable).toBe(false); // forklifts = no
  });

  it('records an item_instantiated event for every item (event-log invariant)', async () => {
    const { repo, audit } = await makeAudit({ q_prcs: true, q_forklift: true });
    const items = await repo.getAuditItems(audit.id);
    for (const it of items) {
      const evts = await repo.listEvents(it.id);
      expect(evts.some((e) => e.type === 'item_instantiated')).toBe(true);
    }
    expect(audit.status).toBe('in_progress');
    expect(audit.privileged).toBe(true);
  });
});

describe('rating flow: every mutation appends an immutable event', () => {
  it('setRating records rating_set with from/to and updates current state', async () => {
    const { repo, audit } = await makeAudit({ q_prcs: true, q_forklift: true });
    const items = await repo.getAuditItems(audit.id);
    const cs1 = items.find((i) => i.item_code === 'CS-1')!;

    await repo.setRating(cs1.id, 'High', 'user-1');
    await repo.setRating(cs1.id, 'Low', 'user-1'); // auditor revises

    const current = await repo.getAuditItem(cs1.id);
    expect(current!.rating).toBe('Low');

    const events = (await repo.listEvents(cs1.id)).filter((e) => e.type === 'rating_set');
    expect(events).toHaveLength(2);
    expect(events[0]!.payload).toMatchObject({ from: null, to: 'High' });
    expect(events[1]!.payload).toMatchObject({ from: 'High', to: 'Low' });
  });

  it('AI-accepted observation sets ai_generated and logs ai_draft_accepted', async () => {
    const { repo, audit } = await makeAudit({ q_prcs: true, q_forklift: true });
    const cs1 = (await repo.getAuditItems(audit.id)).find((i) => i.item_code === 'CS-1')!;
    const updated = await repo.setText(cs1.id, 'observations', 'polished text', 'user-1', {
      ai_generated: true,
    });
    expect(updated.ai_generated).toBe(true);
    const events = await repo.listEvents(cs1.id);
    expect(events.some((e) => e.type === 'ai_draft_accepted')).toBe(true);
  });
});

describe('live scoring matches the engine over applicable items only', () => {
  it('excludes non-applicable items from the denominator', async () => {
    const { repo, audit } = await makeAudit({ q_prcs: true, q_forklift: false }); // PIT-1 inactive
    const items = await repo.getAuditItems(audit.id);
    const byCode = new Map(items.map((i) => [i.item_code, i]));
    await repo.setRating(byCode.get('CS-1')!.id, 'Verified', 'user-1'); // 10/10
    await repo.setRating(byCode.get('CS-2')!.id, 'Low', 'user-1'); // 6.8/8
    await repo.setRating(byCode.get('CS-3')!.id, 'Very High', 'user-1'); // 0/6
    await repo.setRating(byCode.get('WW-1')!.id, 'Not Applicable', 'user-1'); // excluded
    // PIT-1 not applicable → excluded

    const libMap = new Map(LIBRARY.map((l) => [l.item_code, l]));
    const score = scoreForAudit(await repo.getAuditItems(audit.id), libMap);
    // Numerator: 10 + 6.8 + 0 = 16.8 ; Denominator: 10 + 8 + 6 = 24 (WW-1 N/A, PIT-1 inactive)
    expect(score.rawScore).toBe(16.8);
    expect(score.effectiveMax).toBe(24);
    expect(score.percent).toBeCloseTo(70, 5);
    expect(score.sections['CS']!.effectiveMax).toBe(24);
    expect(score.sections['WW']!.effectiveMax).toBe(0); // WW-1 is N/A
  });
});

describe('findings and corrective-action queue', () => {
  it('derives findings sorted Very High → Low with SIF flags and reconciles CAs', async () => {
    const { repo, audit } = await makeAudit({ q_prcs: true, q_forklift: true });
    const items = await repo.getAuditItems(audit.id);
    const byCode = new Map(items.map((i) => [i.item_code, i]));
    await repo.setRating(byCode.get('CS-1')!.id, 'Low', 'user-1'); // finding + SIF
    await repo.setRating(byCode.get('CS-2')!.id, 'Very High', 'user-1'); // finding
    await repo.setRating(byCode.get('CS-3')!.id, 'Best Practice', 'user-1'); // NOT a finding
    await repo.setRating(byCode.get('PIT-1')!.id, 'Moderate', 'user-1'); // finding

    const libMap = new Map(LIBRARY.map((l) => [l.item_code, l]));
    const findings = deriveFindings(await repo.getAuditItems(audit.id), libMap);

    expect(findings.map((f) => f.item_code)).toEqual(['CS-2', 'PIT-1', 'CS-1']); // VH, Mod, Low
    expect(findings.find((f) => f.item_code === 'CS-1')!.sif_potential).toBe(true);

    const recon = reconcileCorrectiveActions(findings, []);
    expect(recon.create).toHaveLength(3);
    expect(recon.orphaned).toHaveLength(0);

    // Existing CA is preserved (keeps assignee/status) when its finding persists.
    const existing: CorrectiveAction = {
      id: 'ca-1',
      org_id: 'org-1',
      audit_id: audit.id,
      audit_item_id: findings[0]!.audit_item_id,
      rating: 'Very High',
      assigned_to: 'Sam',
      due_date: '2026-08-01',
      status: 'in_progress',
      verified_by: null,
      close_date: null,
      closure_evidence_attachment_id: null,
      created_at: '2026-07-10T00:00:00.000Z',
      updated_at: '2026-07-10T00:00:00.000Z',
    };
    const recon2 = reconcileCorrectiveActions(findings, [existing]);
    expect(recon2.keep.find((c) => c.id === 'ca-1')!.assigned_to).toBe('Sam');
    expect(recon2.create).toHaveLength(2);
  });

  it('orphans a CA when its item is no longer a finding', async () => {
    const { repo, audit } = await makeAudit({ q_prcs: true, q_forklift: true });
    const cs1 = (await repo.getAuditItems(audit.id)).find((i) => i.item_code === 'CS-1')!;
    const libMap = new Map(LIBRARY.map((l) => [l.item_code, l]));
    // No findings at all → an existing CA is orphaned.
    const existing: CorrectiveAction = {
      id: 'ca-x',
      org_id: 'org-1',
      audit_id: audit.id,
      audit_item_id: cs1.id,
      rating: 'High',
      assigned_to: null,
      due_date: null,
      status: 'open',
      verified_by: null,
      close_date: null,
      closure_evidence_attachment_id: null,
      created_at: '2026-07-10T00:00:00.000Z',
      updated_at: '2026-07-10T00:00:00.000Z',
    };
    const findings = deriveFindings(await repo.getAuditItems(audit.id), libMap);
    const recon = reconcileCorrectiveActions(findings, [existing]);
    expect(recon.orphaned.map((c) => c.id)).toEqual(['ca-x']);
  });
});

describe('privilege disclosure log', () => {
  it('records view/export disclosures for the privilege trail', async () => {
    const { repo, audit } = await makeAudit({ q_prcs: true, q_forklift: true });
    await repo.logDisclosure({ org_id: 'org-1', audit_id: audit.id, actor_id: 'counsel-1', action: 'view' });
    await repo.logDisclosure({ org_id: 'org-1', audit_id: audit.id, actor_id: 'lead-1', action: 'export' });
    const log = await repo.listDisclosures(audit.id);
    expect(log.map((d) => d.action)).toEqual(['view', 'export']);
  });
});

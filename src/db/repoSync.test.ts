/**
 * Repo seam behaviors added for full Phase-4 sync, specified against the
 * in-memory reference implementation: conflict resolution, the event push
 * cursor, post-creation scoping edits, and applying remote attachments.
 */
import { describe, it, expect } from 'vitest';
import { createMemoryRepo } from './memoryRepo';
import type { RepoDeps } from './repo';
import type { LibraryItem } from './types';
import type { ScopingQuestion } from '@/domain/applicability';

function deps(): RepoDeps {
  let n = 0;
  let tick = 0;
  return { newId: () => `id-${++n}`, now: () => `2026-07-11T00:00:0${Math.min(9, tick++)}.000Z` };
}

const LIB: LibraryItem[] = [
  { item_code: 'CS-1', section_code: 'CS', subsection: null, requirement: 'r', evidence_protocol: 'e',
    max_points: 8, citation: 'c', sif_potential: false, content_hash: 'h', state: null },
  { item_code: 'WD-1', section_code: 'WD', subsection: null, requirement: 'weld', evidence_protocol: 'e',
    max_points: 8, citation: 'c', sif_potential: false, content_hash: 'h2', state: null },
];
const QUESTIONS: ScopingQuestion[] = [
  { key: 'Q-WELD', question: 'Any welding?', activates: ['WD'] },
];

async function seeded(answers: Record<string, boolean> = { 'Q-WELD': false }) {
  const repo = createMemoryRepo(deps());
  const audit = await repo.createAudit(
    { org_id: 'o', created_by: 'u', title: 't', privileged: false, state_plan: null, library_version_id: 'v', answers },
    { library: LIB, questions: QUESTIONS },
  );
  const items = await repo.getAuditItems(audit.id);
  return { repo, audit, items };
}

describe('resolveRatingConflict', () => {
  it('applies the pick, clears the candidate, marks local, and logs an auditable event', async () => {
    const { repo, items } = await seeded();
    const item = items[0]!;
    await repo.applyMergedItems([{ ...item, rating: 'High', conflict_rating: 'Low', sync_state: 'needs_resolution' }]);

    const resolved = await repo.resolveRatingConflict(item.id, 'Low', 'lead');
    expect(resolved.rating).toBe('Low');
    expect(resolved.conflict_rating).toBeNull();
    expect(resolved.sync_state).toBe('local');

    const events = await repo.listEvents(item.id);
    const ev = events.find((e) => e.type === 'rating_set' && e.payload.resolution === true);
    expect(ev?.payload).toMatchObject({ to: 'Low', candidates: { local: 'High', remote: 'Low' } });
    expect(ev?.actor_id).toBe('lead');
  });
});

describe('event push cursor', () => {
  it('lists only unpushed events and marking excludes them from the next pass', async () => {
    const { repo, audit, items } = await seeded();
    await repo.setRating(items[0]!.id, 'Low', 'u');

    const first = await repo.listUnpushedEvents(audit.id);
    expect(first.length).toBeGreaterThan(0);

    await repo.markEventsPushed(first.map((e) => e.id));
    expect(await repo.listUnpushedEvents(audit.id)).toEqual([]);

    // A fresh edit is a fresh delta.
    await repo.setRating(items[0]!.id, 'High', 'u');
    const next = await repo.listUnpushedEvents(audit.id);
    expect(next.map((e) => e.type)).toEqual(['rating_set']);
  });
});

describe('updateScopingAnswer', () => {
  it('activates the group items and logs applicability_changed per flipped item', async () => {
    const { repo, audit } = await seeded({ 'Q-WELD': false });
    const before = await repo.getAuditItems(audit.id);
    const weld = before.find((i) => i.item_code === 'WD-1')!;
    expect(weld.applicable).toBe(false);

    await repo.updateScopingAnswer(audit.id, 'Q-WELD', true, 'u', { library: LIB, questions: QUESTIONS });

    const after = await repo.getAuditItems(audit.id);
    expect(after.find((i) => i.item_code === 'WD-1')!.applicable).toBe(true);
    expect(after.find((i) => i.item_code === 'CS-1')!.applicable).toBe(true); // untouched

    const events = await repo.listEvents(weld.id);
    expect(events.some((e) => e.type === 'applicability_changed' && e.payload.applicable === true)).toBe(true);

    const answers = await repo.getScopingAnswers(audit.id);
    expect(answers.find((a) => a.question_key === 'Q-WELD')?.answer).toBe(true);
  });

  it('ratings survive a deactivate/reactivate round-trip (nothing is deleted)', async () => {
    const { repo, audit } = await seeded({ 'Q-WELD': true });
    const weld = (await repo.getAuditItems(audit.id)).find((i) => i.item_code === 'WD-1')!;
    await repo.setRating(weld.id, 'Moderate', 'u');

    await repo.updateScopingAnswer(audit.id, 'Q-WELD', false, 'u', { library: LIB, questions: QUESTIONS });
    await repo.updateScopingAnswer(audit.id, 'Q-WELD', true, 'u', { library: LIB, questions: QUESTIONS });

    const again = (await repo.getAuditItems(audit.id)).find((i) => i.item_code === 'WD-1')!;
    expect(again.applicable).toBe(true);
    expect(again.rating).toBe('Moderate');
  });
});

describe('dirty-flag push eligibility (clock-independent)', () => {
  it('every local mutation flips a synced row back to local so the engine pushes it regardless of clocks', async () => {
    const { repo, items } = await seeded();
    const item = items[0]!;
    // Simulate a completed sync: row agreed with the server.
    await repo.applyMergedItems([{ ...item, sync_state: 'synced' }]);

    await repo.setRating(item.id, 'Low', 'u');
    expect((await repo.getAuditItem(item.id))?.sync_state).toBe('local');

    await repo.applyMergedItems([{ ...(await repo.getAuditItem(item.id))!, sync_state: 'synced' }]);
    await repo.setText(item.id, 'observations', 'seen', 'u');
    expect((await repo.getAuditItem(item.id))?.sync_state).toBe('local');

    await repo.applyMergedItems([{ ...(await repo.getAuditItem(item.id))!, sync_state: 'synced' }]);
    await repo.setApplicable(item.id, false, 'u');
    expect((await repo.getAuditItem(item.id))?.sync_state).toBe('local');
  });

  it('a conflicted row is NOT flattened to local by an edit (needs_resolution survives)', async () => {
    const { repo, items } = await seeded();
    const item = items[0]!;
    await repo.applyMergedItems([{ ...item, rating: 'High', conflict_rating: 'Low', sync_state: 'needs_resolution' }]);
    await repo.setText(item.id, 'observations', 'note', 'u');
    expect((await repo.getAuditItem(item.id))?.sync_state).toBe('needs_resolution');
  });
});

describe('disclosure push cursor', () => {
  it('lists only unpushed disclosures and marking excludes them next pass', async () => {
    const { repo, audit } = await seeded();
    await repo.logDisclosure({ org_id: 'o', audit_id: audit.id, actor_id: 'u', action: 'view' });
    await repo.logDisclosure({ org_id: 'o', audit_id: audit.id, actor_id: 'u', action: 'export' });

    const first = await repo.listUnpushedDisclosures(audit.id);
    expect(first.map((d) => d.action)).toEqual(['view', 'export']);

    await repo.markDisclosuresPushed(first.map((d) => d.id));
    expect(await repo.listUnpushedDisclosures(audit.id)).toEqual([]);
    // The full trail is still readable.
    expect((await repo.listDisclosures(audit.id)).length).toBe(2);
  });
});

describe('applyRemoteAttachments', () => {
  it('inserts unknown rows but never overwrites or resurrects local ones', async () => {
    const { repo, items } = await seeded();
    const itemId = items[0]!.id;
    const mine = await repo.addAttachment(itemId, 'photo', 'file:///mine.jpg', 'u');

    await repo.applyRemoteAttachments([
      // Same id as a local row — must NOT clobber the local uri.
      { ...mine, uri: '', storage_path: 'o/x/mine.jpg', sync_state: 'synced' },
      // New remote-only row — appears with empty uri for signed-URL viewing.
      { id: 'remote-1', org_id: 'o', audit_item_id: itemId, kind: 'photo', uri: '',
        storage_path: 'o/x/remote-1.jpg', sync_state: 'synced', deleted_at: null,
        transcription: null, created_at: '2026-07-11T00:00:00.000Z' },
    ]);

    const list = await repo.listAttachments(itemId);
    expect(list.find((a) => a.id === mine.id)?.uri).toBe('file:///mine.jpg');
    const remote = list.find((a) => a.id === 'remote-1');
    expect(remote?.uri).toBe('');
    expect(remote?.storage_path).toBe('o/x/remote-1.jpg');
  });
});

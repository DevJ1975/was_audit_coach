import { describe, it, expect } from 'vitest';
import { createMemoryRepo } from './memoryRepo';
import type { RepoDeps } from './repo';
import type { LibraryItem } from './types';

function deps(): RepoDeps {
  let n = 0;
  return { newId: () => `id-${++n}`, now: () => '2026-07-11T00:00:00.000Z' };
}
const LIB: LibraryItem[] = [{
  item_code: 'CS-1', section_code: 'CS', subsection: null, requirement: 'r', evidence_protocol: 'e',
  max_points: 8, citation: 'c', sif_potential: false, content_hash: 'h', state: null,
}];

async function firstItem() {
  const repo = createMemoryRepo(deps());
  const audit = await repo.createAudit(
    { org_id: 'o', created_by: 'u', title: 't', privileged: false, state_plan: null, library_version_id: 'v', answers: {} },
    { library: LIB, questions: [] },
  );
  const [item] = await repo.getAuditItems(audit.id);
  return { repo, itemId: item!.id };
}

describe('attachment writes go through the repo and log immutable events (NN #6)', () => {
  it('addAttachment stores the file and logs attachment_added', async () => {
    const { repo, itemId } = await firstItem();
    const att = await repo.addAttachment(itemId, 'photo', 'file:///photo1.jpg', 'u');
    expect(att.kind).toBe('photo');
    expect(att.uri).toBe('file:///photo1.jpg');

    const list = await repo.listAttachments(itemId);
    expect(list.map((a) => a.id)).toEqual([att.id]);

    const events = await repo.listEvents(itemId);
    const added = events.find((e) => e.type === 'attachment_added');
    expect(added?.payload).toMatchObject({ attachment_id: att.id, kind: 'photo' });
  });

  it('voice notes carry an optional transcription', async () => {
    const { repo, itemId } = await firstItem();
    const att = await repo.addAttachment(itemId, 'voice', 'file:///note.m4a', 'u', 'gap in guarding');
    expect(att.kind).toBe('voice');
    expect(att.transcription).toBe('gap in guarding');
  });

  it('removeAttachment deletes it and logs attachment_removed', async () => {
    const { repo, itemId } = await firstItem();
    const att = await repo.addAttachment(itemId, 'photo', 'file:///p.jpg', 'u');
    await repo.removeAttachment(att.id, 'u');

    expect(await repo.listAttachments(itemId)).toEqual([]);
    const events = await repo.listEvents(itemId);
    expect(events.some((e) => e.type === 'attachment_removed' && e.payload.attachment_id === att.id)).toBe(true);
  });
});

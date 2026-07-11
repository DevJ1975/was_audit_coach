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

describe('attachment upload state drives sync behind the seam', () => {
  it('a fresh attachment is pending upload, then marking synced clears it and records the path', async () => {
    const { repo, itemId } = await firstItem();
    const att = await repo.addAttachment(itemId, 'photo', 'file:///p.jpg', 'u');
    expect(att.sync_state).toBe('local');
    expect(att.storage_path).toBeNull();

    expect((await repo.listPendingUploads()).map((a) => a.id)).toEqual([att.id]);

    await repo.markAttachmentSynced(att.id, 'wls/item/att.jpg');
    expect(await repo.listPendingUploads()).toEqual([]);
    const [row] = await repo.listAttachments(itemId);
    expect(row?.sync_state).toBe('synced');
    expect(row?.storage_path).toBe('wls/item/att.jpg');
  });

  it('removing a never-uploaded attachment deletes it outright (no remote copy to clean)', async () => {
    const { repo, itemId } = await firstItem();
    const att = await repo.addAttachment(itemId, 'photo', 'file:///p.jpg', 'u');
    await repo.removeAttachment(att.id, 'u');
    expect(await repo.listPendingRemovals()).toEqual([]); // nothing to propagate
  });

  it('removing a synced attachment tombstones it: hidden from lists, queued for remote deletion, then purged', async () => {
    const { repo, itemId } = await firstItem();
    const att = await repo.addAttachment(itemId, 'photo', 'file:///p.jpg', 'u');
    await repo.markAttachmentSynced(att.id, 'wls/item/att.jpg');

    await repo.removeAttachment(att.id, 'u');
    expect(await repo.listAttachments(itemId)).toEqual([]); // gone from the UI immediately
    expect(await repo.listPendingUploads()).toEqual([]);    // not re-uploaded

    const pending = await repo.listPendingRemovals();
    expect(pending.map((a) => a.id)).toEqual([att.id]);
    expect(pending[0]?.storage_path).toBe('wls/item/att.jpg'); // path retained for Storage delete
    expect(await repo.listEvents(itemId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'attachment_removed' })]),
    );

    await repo.purgeAttachment(att.id);
    expect(await repo.listPendingRemovals()).toEqual([]);
  });
});

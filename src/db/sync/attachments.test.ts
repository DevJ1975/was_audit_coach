import { describe, it, expect } from 'vitest';
import { AttachmentSync, evidencePath, extFromUri, type AttachmentLocal, type LoadForUpload } from './attachments';
import type { EvidenceRemote, EvidenceBlob, RemoteAttachment } from './remote';
import type { Attachment } from '@/db/types';

const CREATED = '2026-07-11T00:00:00.000Z';

function att(id: string, o: Partial<Attachment> = {}): Attachment {
  return {
    id, org_id: 'wls', audit_item_id: 'item1', kind: 'photo', uri: `file:///evidence/${id}.jpg`,
    storage_path: null, sync_state: 'local', deleted_at: null, transcription: null, created_at: CREATED, ...o,
  };
}

class FakeLocal implements AttachmentLocal {
  rows = new Map<string, Attachment>();
  constructor(seed: Attachment[] = []) { for (const a of seed) this.rows.set(a.id, a); }
  async listPendingUploads() { return [...this.rows.values()].filter((a) => a.sync_state === 'local' && !a.deleted_at); }
  async markAttachmentSynced(id: string, storage_path: string) {
    const a = this.rows.get(id);
    if (a) this.rows.set(id, { ...a, sync_state: 'synced', storage_path });
  }
  async listPendingRemovals() { return [...this.rows.values()].filter((a) => a.deleted_at != null); }
  async purgeAttachment(id: string) { this.rows.delete(id); }
}

class FakeRemote implements EvidenceRemote {
  available = true;
  objects = new Map<string, EvidenceBlob>();
  rows = new Map<string, RemoteAttachment>();
  isAvailable() { return this.available; }
  async uploadEvidence(path: string, blob: EvidenceBlob) { this.objects.set(path, blob); }
  async upsertAttachments(rows: RemoteAttachment[]) { for (const r of rows) this.rows.set(r.id, r); }
  async deleteEvidence(paths: string[]) { for (const p of paths) this.objects.delete(p); }
  async deleteAttachments(ids: string[]) { for (const id of ids) this.rows.delete(id); }
  async createSignedUrl() { return 'https://signed.example/obj'; }
}

const loadOk: LoadForUpload = async () => ({ data: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' });
const loadThrowsOnBad: LoadForUpload = async (uri) => {
  if (uri.includes('bad')) throw new Error('unreadable file');
  return { data: new Uint8Array([1]), contentType: 'image/jpeg' };
};

describe('path helpers', () => {
  it('evidencePath is org/item/id.ext (org prefix is what RLS checks)', () => {
    expect(evidencePath(att('a1'))).toBe('wls/item1/a1.jpg');
    expect(evidencePath(att('v9', { uri: 'file:///e/v9.m4a' }))).toBe('wls/item1/v9.m4a');
  });

  it('extFromUri strips query/hash and falls back to dat when there is no extension', () => {
    expect(extFromUri('file:///a/b/photo.JPG')).toBe('jpg');
    expect(extFromUri('file:///a/b/note.m4a?token=xyz')).toBe('m4a');
    expect(extFromUri('file:///a/b/noextension')).toBe('dat');
    expect(extFromUri('https://host/a.b/c')).toBe('dat'); // dot is in a directory
  });
});

describe('AttachmentSync.syncAttachments', () => {
  it('uploads a pending file, writes the metadata row, and flips it to synced', async () => {
    const local = new FakeLocal([att('a1')]);
    const remote = new FakeRemote();
    const summary = await new AttachmentSync(local, remote, loadOk).syncAttachments();

    expect(summary).toEqual({ skipped: false, uploaded: 1, removed: 0, failed: 0 });
    expect(remote.objects.has('wls/item1/a1.jpg')).toBe(true);
    expect(remote.rows.get('a1')?.storage_path).toBe('wls/item1/a1.jpg');
    const row = local.rows.get('a1')!;
    expect(row.sync_state).toBe('synced');
    expect(row.storage_path).toBe('wls/item1/a1.jpg');
  });

  it('skips cleanly when the remote is unavailable (offline field mode)', async () => {
    const local = new FakeLocal([att('a1')]);
    const remote = new FakeRemote();
    remote.available = false;
    const summary = await new AttachmentSync(local, remote, loadOk).syncAttachments();

    expect(summary.skipped).toBe(true);
    expect(remote.objects.size).toBe(0);
    expect(local.rows.get('a1')?.sync_state).toBe('local'); // untouched
  });

  it('isolates a per-file failure: the good file syncs, the bad one stays pending', async () => {
    const local = new FakeLocal([att('good'), att('bad', { uri: 'file:///evidence/bad.jpg' })]);
    const remote = new FakeRemote();
    const summary = await new AttachmentSync(local, remote, loadThrowsOnBad).syncAttachments();

    expect(summary).toEqual({ skipped: false, uploaded: 1, removed: 0, failed: 1 });
    expect(local.rows.get('good')?.sync_state).toBe('synced');
    expect(local.rows.get('bad')?.sync_state).toBe('local'); // retried next sync
    expect(remote.rows.has('bad')).toBe(false);
  });

  it('propagates a tombstoned removal: deletes the object + row, then purges locally', async () => {
    const tomb = att('t1', { sync_state: 'synced', storage_path: 'wls/item1/t1.jpg', deleted_at: CREATED });
    const local = new FakeLocal([tomb]);
    const remote = new FakeRemote();
    remote.objects.set('wls/item1/t1.jpg', { data: new Uint8Array([9]), contentType: 'image/jpeg' });
    remote.rows.set('t1', { id: 't1', org_id: 'wls', audit_item_id: 'item1', kind: 'photo', storage_path: 'wls/item1/t1.jpg', transcription: null, created_at: CREATED });

    const summary = await new AttachmentSync(local, remote, loadOk).syncAttachments();

    expect(summary).toEqual({ skipped: false, uploaded: 0, removed: 1, failed: 0 });
    expect(remote.objects.has('wls/item1/t1.jpg')).toBe(false);
    expect(remote.rows.has('t1')).toBe(false);
    expect(local.rows.has('t1')).toBe(false); // purged
  });

  it('is a no-op on a second run once everything is synced', async () => {
    const local = new FakeLocal([att('a1')]);
    const remote = new FakeRemote();
    const sync = new AttachmentSync(local, remote, loadOk);
    await sync.syncAttachments();
    const second = await sync.syncAttachments();
    expect(second).toEqual({ skipped: false, uploaded: 0, removed: 0, failed: 0 });
  });
});

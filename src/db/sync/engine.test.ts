import { describe, it, expect } from 'vitest';
import { SyncEngine, type SyncLocal } from './engine';
import type { RemoteAdapter, RemoteAuditItem } from './remote';
import type { AuditItem } from '@/db/types';
import type { Rating } from '@soteria/scoring-engine';

const T1 = '2026-07-11T10:00:00.000Z';
const T2 = '2026-07-11T11:00:00.000Z';
const NOW = '2026-07-11T12:00:00.000Z';

function local(id: string, o: Partial<AuditItem> = {}): AuditItem {
  return {
    id, org_id: 'o', audit_id: 'a', item_code: id, section_code: 'CS', applicable: true,
    rating: null, observations: '', recommendations: '', auditor_notes: '', ai_generated: false,
    sync_state: 'local', conflict_rating: null, updated_at: T1, ...o,
  };
}
function remote(id: string, o: Partial<RemoteAuditItem> = {}): RemoteAuditItem {
  return {
    id, org_id: 'o', audit_id: 'a', item_code: id, section_code: 'CS', applicable: true,
    rating: null, observations: '', recommendations: '', auditor_notes: '', ai_generated: false,
    updated_at: T1, ...o,
  };
}

class FakeLocal implements SyncLocal {
  items = new Map<string, AuditItem>();
  async getAuditItems(audit_id: string) {
    return [...this.items.values()].filter((i) => i.audit_id === audit_id);
  }
  async applyMergedItems(rows: AuditItem[]) {
    for (const r of rows) this.items.set(r.id, r);
  }
}
class FakeRemote implements RemoteAdapter {
  rows = new Map<string, RemoteAuditItem>();
  isAvailable() { return true; }
  async pullAuditItems(audit_id: string, since: string | null) {
    return [...this.rows.values()].filter((r) => r.audit_id === audit_id && (since === null || r.updated_at > since));
  }
  async upsertAuditItems(items: RemoteAuditItem[]) { for (const it of items) this.rows.set(it.id, it); }
  async upsertAudit() {}
  async pullAudits() { return []; }
  async deleteAudit() {}
  async pullScopingAnswers() { return []; }
  async upsertScopingAnswers() {}
  async upsertCorrectiveActions() {}
  async insertDisclosures() {}
  async insertEvents() {}
}

function makeEngine() {
  const l = new FakeLocal();
  const r = new FakeRemote();
  return { l, r, engine: new SyncEngine(l, r, () => NOW) };
}

describe('SyncEngine.syncAudit', () => {
  it('pushes local-only rows to the server', async () => {
    const { l, r, engine } = makeEngine();
    l.items.set('L', local('L', { rating: 'Low', updated_at: T1 }));
    const s = await engine.syncAudit('a');
    expect(s.pushed).toBe(1);
    expect(s.appliedLocal).toBe(0);
    expect(r.rows.get('L')?.rating).toBe('Low');
  });

  it('applies remote-only rows locally (created on another device)', async () => {
    const { l, r, engine } = makeEngine();
    r.rows.set('R', remote('R', { rating: 'High', updated_at: T1 }));
    const s = await engine.syncAudit('a');
    expect(s.appliedLocal).toBe(1);
    expect(s.pushed).toBe(0);
    expect(l.items.get('R')?.rating).toBe('High');
    expect(l.items.get('R')?.sync_state).toBe('synced');
  });

  it('LWW: local-newer text is pushed, not overwritten', async () => {
    const { l, r, engine } = makeEngine();
    l.items.set('X', local('X', { observations: 'local', updated_at: T2 }));
    r.rows.set('X', remote('X', { observations: 'remote', updated_at: T1 }));
    const s = await engine.syncAudit('a');
    expect(s.pushed).toBe(1);
    expect(r.rows.get('X')?.observations).toBe('local');
    expect(l.items.get('X')?.observations).toBe('local'); // unchanged locally
  });

  it('LWW: remote-newer text is applied locally, not pushed', async () => {
    const { l, r, engine } = makeEngine();
    l.items.set('X', local('X', { observations: 'local', updated_at: T1 }));
    r.rows.set('X', remote('X', { observations: 'remote', updated_at: T2 }));
    const s = await engine.syncAudit('a');
    expect(s.appliedLocal).toBe(1);
    expect(s.pushed).toBe(0);
    expect(l.items.get('X')?.observations).toBe('remote');
  });

  it('divergent ratings flag needs_resolution locally and are NOT pushed', async () => {
    const { l, r, engine } = makeEngine();
    l.items.set('X', local('X', { rating: 'Very High' as Rating, updated_at: T2 }));
    r.rows.set('X', remote('X', { rating: 'Moderate' as Rating, updated_at: T2 }));
    const s = await engine.syncAudit('a');
    expect(s.conflicts).toEqual(['X']);
    expect(s.pushed).toBe(0); // never overwrite the peer's rating
    const applied = l.items.get('X');
    expect(applied?.sync_state).toBe('needs_resolution');
    expect(applied?.rating).toBe('Very High'); // local value retained
    expect(applied?.conflict_rating).toBe('Moderate'); // peer candidate persisted for the resolve UI
    expect(r.rows.get('X')?.rating).toBe('Moderate'); // remote untouched
  });

  it('advances the cursor and is a no-op on a second run with no new changes', async () => {
    const { l, r, engine } = makeEngine();
    r.rows.set('R', remote('R', { rating: 'Low', updated_at: T2 }));
    const first = await engine.syncAudit('a');
    expect(first.cursor).toBe(T2);
    expect(first.appliedLocal).toBe(1);

    const second = await engine.syncAudit('a');
    expect(second.appliedLocal).toBe(0);
    expect(second.pushed).toBe(0);
  });

  it('skips cleanly when the remote is unavailable (offline field mode)', async () => {
    const { l } = makeEngine();
    const offlineRemote = new FakeRemote();
    offlineRemote.isAvailable = () => false;
    const s = await new SyncEngine(l, offlineRemote, () => NOW).syncAudit('a');
    expect(s.skipped).toBe(true);
    expect(s.pushed).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { compareByCode } from './ordering';
import { createMemoryRepo } from '@/db/memoryRepo';
import type { RepoDeps } from '@/db/repo';
import type { LibraryItem } from '@/db/types';

describe('compareByCode — canonical audit-item order', () => {
  it('orders by section, then item code numerically (CS-2 before CS-10)', () => {
    const codes = [
      { section_code: 'PPE', item_code: 'PPE-1' },
      { section_code: 'CS', item_code: 'CS-10' },
      { section_code: 'CS', item_code: 'CS-2' },
      { section_code: 'MED', item_code: 'MED-1' },
    ];
    const sorted = [...codes].sort(compareByCode).map((c) => c.item_code);
    expect(sorted).toEqual(['CS-2', 'CS-10', 'MED-1', 'PPE-1']);
  });
});

describe('memoryRepo.getAuditItems returns canonical order regardless of library input order', () => {
  it('sorts a scrambled library into section+numeric order (parity with sqliteRepo)', async () => {
    const deps: RepoDeps = (() => {
      let n = 0;
      return { newId: () => `id-${++n}`, now: () => '2026-07-10T00:00:00.000Z' };
    })();
    const lib = (item_code: string, section_code: string): LibraryItem => ({
      item_code, section_code, subsection: null, requirement: '', evidence_protocol: '',
      max_points: 8, citation: '', sif_potential: false, content_hash: item_code, state: null,
    });
    // Deliberately scrambled input order.
    const library = [lib('PPE-2', 'PPE'), lib('CS-10', 'CS'), lib('CS-1', 'CS'), lib('MED-1', 'MED'), lib('CS-2', 'CS')];
    const repo = createMemoryRepo(deps);
    const audit = await repo.createAudit(
      { org_id: 'o', created_by: 'u', title: 't', privileged: false, state_plan: null, library_version_id: 'v', answers: {} },
      { library, questions: [] },
    );
    const order = (await repo.getAuditItems(audit.id)).map((i) => i.item_code);
    expect(order).toEqual(['CS-1', 'CS-2', 'CS-10', 'MED-1', 'PPE-2']);
  });
});

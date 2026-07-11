import { describe, it, expect } from 'vitest';
import { buildReportModel, renderReportHtml } from './report';
import type { Audit, AuditItem, LibraryItem } from '@/db/types';
import type { Rating } from '@soteria/scoring-engine';

function lib(item_code: string, section_code: string, max_points: number, sif = false): LibraryItem {
  return {
    item_code, section_code, subsection: null,
    requirement: `req ${item_code}`, evidence_protocol: `ev ${item_code}`,
    max_points, citation: '29 CFR 1910.x', sif_potential: sif, content_hash: item_code, state: null,
  };
}
function ai(item_code: string, section_code: string, rating: Rating | null, applicable = true): AuditItem {
  return {
    id: item_code, org_id: 'o', audit_id: 'a', item_code, section_code, applicable,
    rating, observations: rating ? `obs ${item_code}` : '', recommendations: '', auditor_notes: '',
    ai_generated: false, sync_state: 'local', conflict_rating: null, updated_at: '2026-07-11T00:00:00Z',
  };
}

const LIBRARY = new Map<string, LibraryItem>([
  ['CS-1', lib('CS-1', 'CS', 10, true)],
  ['CS-2', lib('CS-2', 'CS', 8)],
  ['PP-1', lib('PP-1', 'PP', 6)],
]);
const SECTION_NAMES = { CS: 'Confined Space', PP: 'PPE' };
const AUDIT: Audit = {
  id: 'a', org_id: 'o', facility_id: null, title: 'Acme Q3', status: 'in_progress',
  privileged: true, attorney_of_record: 'Conn Maciel Carey LLP', state_plan: null,
  library_version_id: 'v', created_by: 'u', created_at: '2026-07-11T00:00:00Z', updated_at: '2026-07-11T00:00:00Z',
};

describe('buildReportModel', () => {
  const items = [ai('CS-1', 'CS', 'Very High'), ai('CS-2', 'CS', 'Low'), ai('PP-1', 'PP', 'Best Practice')];
  const model = buildReportModel(AUDIT, items, LIBRARY, SECTION_NAMES, '2026-07-11');

  it('counts ratings and flags SIF / High+', () => {
    expect(model.ratingCounts['Very High']).toBe(1);
    expect(model.ratingCounts['Low']).toBe(1);
    expect(model.ratingCounts['Best Practice']).toBe(1);
    expect(model.sifCount).toBe(1); // CS-1 is SIF and a finding
    expect(model.highPlusCount).toBe(1); // CS-1 Very High
  });

  it('sorts findings Very High → Low and carries observations', () => {
    expect(model.findings.map((f) => f.item_code)).toEqual(['CS-1', 'CS-2']);
    expect(model.findings[0]!.observations).toBe('obs CS-1');
  });

  it('includes a section score table row per active section', () => {
    expect(model.sections.map((s) => s.code)).toEqual(['CS', 'PP']);
    expect(model.sections[0]!.name).toBe('Confined Space');
  });
});

describe('renderReportHtml', () => {
  const items = [ai('CS-1', 'CS', 'Very High'), ai('CS-2', 'CS', 'Low')];

  it('watermarks privileged audits and omits it for non-privileged', () => {
    const priv = renderReportHtml(buildReportModel(AUDIT, items, LIBRARY, SECTION_NAMES, 'now'));
    expect(priv).toContain('PRIVILEGED &amp; CONFIDENTIAL');
    const open = renderReportHtml(
      buildReportModel({ ...AUDIT, privileged: false, attorney_of_record: null }, items, LIBRARY, SECTION_NAMES, 'now'),
    );
    expect(open).not.toContain('PRIVILEGED &amp; CONFIDENTIAL');
  });

  it('escapes HTML and renders findings + section table', () => {
    const html = renderReportHtml(
      buildReportModel({ ...AUDIT, title: 'A & <b>B</b>' }, items, LIBRARY, SECTION_NAMES, 'now'),
    );
    expect(html).toContain('A &amp; &lt;b&gt;B&lt;/b&gt;'); // escaped title
    expect(html).toContain('Section scores');
    expect(html).toContain('CS-1');
    expect(html).toContain('29 CFR 1910.x');
  });
});

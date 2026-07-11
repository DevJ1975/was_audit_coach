/**
 * RETIRED placeholder seed. The app now loads the real ETL output via
 * src/seed/index.ts (library_v1 / state_plans_v1 / scoping_questions_v1). This
 * file is retained only for offline demos / tests that want a tiny fixed library
 * and is no longer imported by the app. Do not reintroduce it into '@/seed'.
 */
import type { LibraryItem } from '@/db/types';
import type { ScopingQuestion } from '@/domain/applicability';

const P = '[PLACEHOLDER] ';

function item(
  item_code: string,
  section_code: string,
  max_points: number,
  requirement: string,
  evidence_protocol: string,
  citation: string,
  sif_potential = false,
): LibraryItem {
  return {
    item_code,
    section_code,
    subsection: null,
    requirement: P + requirement,
    evidence_protocol: P + evidence_protocol,
    max_points,
    citation,
    sif_potential,
    content_hash: item_code,
    state: null,
  };
}

export const PLACEHOLDER_SECTIONS: Record<string, string> = {
  CS: 'Confined Space',
  PPE: 'Personal Protective Equipment',
  MED: 'Medical & First Aid',
  PIT: 'Powered Industrial Trucks (Forklifts)',
  FP: 'Fire Protection',
};

export const PLACEHOLDER_LIBRARY: LibraryItem[] = [
  // Confined Space — gated by the PRCS scoping question
  item('CS-1', 'CS', 10, 'Written permit-required confined space program in place.', 'Request the written PRCS program; confirm it is site-specific and current.', '29 CFR 1910.146(c)(4)', true),
  item('CS-2', 'CS', 8, 'Atmospheric testing performed before and during entry.', 'Sample 20% of recent permits; verify O2, LEL, and toxic readings recorded.', '29 CFR 1910.146(d)(5)', true),
  item('CS-3', 'CS', 6, 'Rescue and emergency services arranged and evaluated.', 'Confirm the rescue provider was evaluated; verify response-time drill records.', '29 CFR 1910.146(k)', true),
  // PPE — baseline (always applicable)
  item('PPE-1', 'PPE', 8, 'PPE hazard assessment completed and certified.', 'Request the written certification; confirm it covers each work area.', '29 CFR 1910.132(d)'),
  item('PPE-2', 'PPE', 6, 'Eye and face protection provided where required.', 'Walk the floor; verify compliant protection at grinding/chemical stations.', '29 CFR 1910.133(a)'),
  item('PPE-3', 'PPE', 6, 'Respiratory protection program where respirators are used.', 'Confirm fit-test and medical-evaluation records for a 10% sample.', '29 CFR 1910.134(c)'),
  // Medical & First Aid — small section (denominator visibility matters)
  item('MED-1', 'MED', 8, 'First-aid supplies adequate and readily available.', 'Inspect two kits; verify contents against the posted checklist.', '29 CFR 1910.151(b)'),
  item('MED-2', 'MED', 10, 'Emergency eyewash/shower where corrosives are present.', 'Activate units; confirm flow and 10-second access path.', '29 CFR 1910.151(c)', true),
  // Forklifts — gated by the forklift scoping question
  item('PIT-1', 'PIT', 6, 'Operators trained, evaluated, and certified.', 'Verify certification dates for a 25% operator sample.', '29 CFR 1910.178(l)'),
  item('PIT-2', 'PIT', 8, 'Daily pre-operation inspections documented.', 'Review the last 30 days of checklists for two trucks.', '29 CFR 1910.178(q)(7)'),
  // Fire Protection — FP-16 gated by the INVERTED standpipe question
  item('FP-1', 'FP', 6, 'Portable fire extinguishers mounted, inspected monthly.', 'Check tags on a 20% sample; verify annual maintenance.', '29 CFR 1910.157(e)'),
  item('FP-16', 'FP', 8, 'Standpipe and hose systems maintained and tested.', 'Verify hydrostatic test records and hose-station access.', '29 CFR 1910.158(e)'),
];

/**
 * PLACEHOLDER scoping questions (real set is 15 — Open Item polarity notes apply).
 * FP-16 uses the inverted "No → applies" polarity (Open Item 2).
 */
export const PLACEHOLDER_QUESTIONS: ScopingQuestion[] = [
  { key: 'q_prcs', question: 'Does the facility have permit-required confined spaces?', activates: ['CS'] },
  { key: 'q_forklift', question: 'Are powered industrial trucks (forklifts) operated on site?', activates: ['PIT'] },
  { key: 'q_welding', question: 'Is welding or hot work performed?', activates: ['WC'] },
  { key: 'q_lpgas', question: 'Is LP gas stored or used?', activates: ['HM'] },
  { key: 'q_noise', question: 'Are employees exposed to noise at or above 85 dBA (8-hr TWA)?', activates: ['OH'] },
  { key: 'q_compressed_gas', question: 'Are compressed gas cylinders present?', activates: ['HM'] },
  { key: 'q_flammable', question: 'Are flammable liquids stored above container-exemption limits?', activates: ['FP'] },
  {
    key: 'q_standpipe',
    question: 'Is the building EXEMPT from standpipe system requirements?',
    activates: ['FP-16'],
    applies_on: 'No', // No (not exempt) → FP-16 applies. Open Item 2 — confirm with Jay.
  },
];

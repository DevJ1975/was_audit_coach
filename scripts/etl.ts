/**
 * ETL: WLS_Audit_Coach_OSHA.xlsx → seed JSON.  Run: npm run etl
 *
 * Emits into src/seed/:
 *   library_v1.json           286 federal items (18 section tabs) + section names
 *   state_plans_v1.json        88 state-plan items (State_Data sheet) + plan list
 *   scoping_questions_v1.json  15 process-inventory questions (Pre-Audit Scoping §2)
 *
 * Invariants (asserted — EXITS NON-ZERO on any miss):
 *   286 federal + 88 state = 374 items · 15 scoping questions.
 *
 * Column layout VERIFIED against the real workbook (2026-07-10):
 *  Section tabs: an "Item #" header row precedes the items; then
 *    0 Item#  1 Subsection  2 Requirement  3 Evidence  4 Rating(pilot)  5 Score
 *    6 Max    7 Obs(pilot)  8 Rec(pilot)   9 Citation  10 Notes  14 Eff.Max
 *  We extract ONLY the clean library columns (0,1,2,3,6,9) — never the pilot's
 *  rating/observations (those belong in pilot_validation_fixture.json).
 *  State_Data: 0 State 1 Seq 2 Item_ID 3 Subsection 4 Requirement 5 Evidence
 *    6 Citation 7 Max_Score.
 *  Pre-Audit Scoping §2: col1 Question, col3 pilot answer, col4 Audit Impact
 *    (item-code ranges parsed into explicit codes).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SEED_DIR = resolve(ROOT, 'src/seed');
const workbookPath = resolve(ROOT, process.argv[2] ?? 'WLS_Audit_Coach_OSHA.xlsx');

const FED_COLS = { item_code: 0, subsection: 1, requirement: 2, evidence: 3, max_points: 6, citation: 9 } as const;
const ITEM_CODE_RE = /^[A-Z]{2,4}-\d+$/;
const STATE_CODE_RE = /^SP-([A-Z]{2})-\d+$/;

// Sheets that are NOT federal section tabs.
const NON_SECTION_SHEETS = new Set(
  ['Pre-Audit Scoping', 'HSE Dashboard', 'Audit Report', 'CA Tracker', 'State Requirements', 'DataPool', 'State_Data'].map(
    (s) => s.toLowerCase(),
  ),
);

// Expected federal per-section counts (plan §1.4), keyed by item-code prefix.
// NB: keys are the ACTUAL item-code prefixes in the workbook, which differ from
// the plan's shorthand for three sections: PP (not PPE), PT (not HT), MA (not MED).
const FEDERAL_SECTIONS: Record<string, { name: string; count: number }> = {
  CS: { name: 'Confined Space', count: 24 },
  PP: { name: 'PPE', count: 26 },
  WW: { name: 'Walking & Working Surfaces', count: 22 },
  RK: { name: 'Recordkeeping', count: 36 },
  LO: { name: 'LOTO', count: 17 },
  EG: { name: 'Egress & Emergency', count: 19 },
  FP: { name: 'Fire Protection', count: 17 },
  MG: { name: 'Machine Guarding', count: 12 },
  EL: { name: 'Electrical', count: 16 },
  PT: { name: 'Hand & Power Tools', count: 13 },
  HC: { name: 'HazCom', count: 10 },
  PIT: { name: 'Forklifts', count: 11 },
  CR: { name: 'Cranes & Rigging', count: 10 },
  HM: { name: 'Hazardous Materials', count: 11 },
  OH: { name: 'Occ. Health & Noise', count: 10 },
  MA: { name: 'Medical & First Aid', count: 8 },
  WC: { name: 'Welding & Hot Work', count: 10 },
  BP: { name: 'BBP & Sanitation', count: 14 },
};

const EXPECTED_FEDERAL = 286;
const EXPECTED_STATE = 88;
const EXPECTED_SCOPING = 15;

// Part 5, Open Item 2 — three rows read inverted ("No → item applies").
const INVERTED_ITEMS = new Set(['FP-16', 'OH-1', 'OH-3']);

interface LibraryItem {
  item_code: string;
  section_code: string;
  subsection: string | null;
  requirement: string;
  evidence_protocol: string;
  max_points: number;
  citation: string;
  sif_potential: boolean;
  content_hash: string;
  state?: string | null;
}

function contentHash(parts: (string | number | null)[]): string {
  return createHash('sha256').update(parts.map((p) => String(p ?? '')).join('')).digest('hex').slice(0, 16);
}
function cell(row: unknown[], idx: number): string {
  const v = row[idx];
  return v == null ? '' : String(v).trim();
}
function isAllCaps(s: string): boolean {
  return s.length > 0 && s === s.toUpperCase() && /[A-Z]/.test(s);
}
function rowsOf(ws: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
}

function extractSectionTab(sheetName: string, ws: XLSX.WorkSheet): LibraryItem[] {
  const rows = rowsOf(ws);
  // The item table begins right after the row whose first cell is "Item #".
  const headerIdx = rows.findIndex((r) => cell(r, 0).replace(/\s+/g, ' ').toLowerCase() === 'item #');
  if (headerIdx < 0) return [];

  const items: LibraryItem[] = [];
  let currentSubsection: string | null = null;
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const code = cell(row, FED_COLS.item_code);
    if (!code) continue;
    if (ITEM_CODE_RE.test(code)) {
      const section_code = code.split('-')[0]!;
      const requirement = cell(row, FED_COLS.requirement);
      const evidence = cell(row, FED_COLS.evidence);
      const citation = cell(row, FED_COLS.citation);
      const max_points = Number(cell(row, FED_COLS.max_points));
      if (!Number.isFinite(max_points) || max_points <= 0) {
        throw new Error(`[${sheetName}] ${code}: bad max_points "${cell(row, FED_COLS.max_points)}"`);
      }
      items.push({
        item_code: code,
        section_code,
        subsection: cell(row, FED_COLS.subsection) || currentSubsection,
        requirement,
        evidence_protocol: evidence,
        max_points,
        citation,
        sif_potential: false,
        content_hash: contentHash([code, requirement, evidence, citation, max_points]),
        state: null,
      });
    } else if (isAllCaps(code)) {
      currentSubsection = code;
    }
  }
  return items;
}

function extractStatePlans(wb: XLSX.WorkBook): { items: LibraryItem[]; plans: string[] } {
  const ws = wb.Sheets['State_Data'];
  if (!ws) throw new Error('State_Data sheet not found');
  const rows = rowsOf(ws);
  const items: LibraryItem[] = [];
  const plans = new Set<string>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const code = cell(row, 2);
    const m = STATE_CODE_RE.exec(code);
    if (!m) continue;
    const state = cell(row, 0);
    const requirement = cell(row, 4);
    const evidence = cell(row, 5);
    const citation = cell(row, 6);
    const max_points = Number(cell(row, 7));
    if (!Number.isFinite(max_points) || max_points <= 0) continue;
    plans.add(state);
    items.push({
      item_code: code,
      section_code: m[1]!, // 2-letter state code, e.g. CA
      subsection: cell(row, 3) || null,
      requirement,
      evidence_protocol: evidence,
      max_points,
      citation,
      sif_potential: false,
      content_hash: contentHash([state, code, requirement, citation, max_points]),
      state,
    });
  }
  return { items, plans: [...plans] };
}

interface ScopingQuestion {
  key: string;
  question: string;
  activates: string[];
  applies_on: 'Yes' | 'No';
  needs_polarity_confirmation: boolean;
  audit_impact: string;
}

/** Expand "XX-a through XX-b", "XX-a and XX-b", and single "XX-n" into codes. */
function parseActivations(impact: string): string[] {
  const codes = new Set<string>();
  const rangeRe = /([A-Z]{2,4})-(\d+)\s+through\s+([A-Z]{2,4})-(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = rangeRe.exec(impact))) {
    const [, p1, a, p2, b] = m;
    if (p1 === p2) for (let n = Number(a); n <= Number(b); n++) codes.add(`${p1}-${n}`);
  }
  for (const c of impact.match(/[A-Z]{2,4}-\d+/g) ?? []) codes.add(c);
  return [...codes].sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
}

function extractScoping(wb: XLSX.WorkBook): ScopingQuestion[] {
  const ws = wb.Sheets['Pre-Audit Scoping'];
  if (!ws) throw new Error('Pre-Audit Scoping sheet not found');
  const rows = rowsOf(ws);
  const start = rows.findIndex((r) => cell(r, 0).toUpperCase().startsWith('SECTION 2'));
  const end = rows.findIndex((r, i) => i > start && cell(r, 0).toUpperCase().startsWith('SECTION 3'));
  const out: ScopingQuestion[] = [];
  for (let r = start + 1; r < (end < 0 ? rows.length : end); r++) {
    const row = rows[r] ?? [];
    const question = cell(row, 1);
    const impact = cell(row, 4);
    if (!question || !question.includes('?')) continue; // header row has no '?'
    const activates = parseActivations(impact);
    const inverted = activates.some((c) => INVERTED_ITEMS.has(c));
    out.push({
      key: `SCOPE-${String(out.length + 1).padStart(2, '0')}`,
      question,
      activates,
      applies_on: inverted ? 'No' : 'Yes',
      needs_polarity_confirmation: inverted,
      audit_impact: impact,
    });
  }
  return out;
}

function write(name: string, data: unknown): void {
  writeFileSync(resolve(SEED_DIR, name), JSON.stringify(data, null, 2) + '\n');
  console.log(`  wrote src/seed/${name}`);
}

function main(): void {
  if (!existsSync(workbookPath)) {
    console.error(`\n✗ Workbook not found: ${workbookPath}\n  Place WLS_Audit_Coach_OSHA.xlsx at the repo root and re-run.\n`);
    process.exit(2);
  }
  const wb = XLSX.readFile(workbookPath);

  const library: LibraryItem[] = [];
  const perSection: Record<string, number> = {};
  const sectionNames: Record<string, string> = {};
  for (const sheetName of wb.SheetNames) {
    if (NON_SECTION_SHEETS.has(sheetName.toLowerCase())) continue;
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const items = extractSectionTab(sheetName, ws);
    if (items.length === 0) continue;
    for (const it of items) {
      perSection[it.section_code] = (perSection[it.section_code] ?? 0) + 1;
      sectionNames[it.section_code] ??= FEDERAL_SECTIONS[it.section_code]?.name ?? sheetName;
    }
    library.push(...items);
  }

  console.log('\nFederal section coverage:');
  let sectionsOk = true;
  for (const [code, meta] of Object.entries(FEDERAL_SECTIONS)) {
    const got = perSection[code] ?? 0;
    if (got !== meta.count) sectionsOk = false;
    console.log(`  ${got === meta.count ? '✓' : '✗'} ${code.padEnd(4)} ${String(got).padStart(3)}/${meta.count}  ${meta.name}`);
  }

  const { items: state, plans } = extractStatePlans(wb);
  const scoping = extractScoping(wb);

  console.log(
    `\nTotals: federal=${library.length}/${EXPECTED_FEDERAL} · state=${state.length}/${EXPECTED_STATE} · ` +
      `scoping=${scoping.length}/${EXPECTED_SCOPING} · library total=${library.length + state.length}/374`,
  );

  const checks: [string, boolean][] = [
    [`federal == ${EXPECTED_FEDERAL}`, library.length === EXPECTED_FEDERAL],
    [`state == ${EXPECTED_STATE}`, state.length === EXPECTED_STATE],
    [`scoping == ${EXPECTED_SCOPING}`, scoping.length === EXPECTED_SCOPING],
    ['per-section counts match', sectionsOk],
  ];
  const failed = checks.filter(([, ok]) => !ok);
  if (failed.length) {
    console.error('\n✗ ETL invariants failed:');
    for (const [name] of failed) console.error(`    - ${name}`);
    process.exit(1);
  }

  if (!existsSync(SEED_DIR)) mkdirSync(SEED_DIR, { recursive: true });
  write('library_v1.json', { version: 1, count: library.length, sections: sectionNames, items: library });
  write('state_plans_v1.json', { version: 1, count: state.length, plans, items: state });
  write('scoping_questions_v1.json', { version: 1, count: scoping.length, questions: scoping });

  const inverted = scoping.filter((q) => q.needs_polarity_confirmation).map((q) => `${q.key} (${q.activates.join(',')})`);
  if (inverted.length) {
    console.log(`\n⚠ ${inverted.length} scoping row(s) wired as "No → applies" — CONFIRM polarity with Jay (Part 5 Open Item 2):`);
    for (const i of inverted) console.log(`    ${i}`);
  }
  console.log('\n✓ ETL complete — seed JSON written to src/seed/\n');
}

main();

/**
 * Audit report model + HTML renderer (Phase 5). Pure — no platform, no network —
 * so it's unit-testable and shared by the on-device PDF export (expo-print) and
 * any server-side exporter. Mirrors the workbook's Audit Report layout:
 * info block · executive summary · section score table · severity-sorted findings.
 *
 * Privileged audits render a repeating watermark on every page (Part 1.5). The
 * disclosure-log entry is written by the caller at export time, not here.
 */
import { RATINGS, type Rating, type Tier } from '@soteria/scoring-engine';
import { ratingColors } from '@/theme/tokens';
import type { AuditItem, Audit, LibraryItem, ReportBriefContent } from '@/db/types';
import { scoreForAudit, deriveFindings, type Finding } from './audit';

export interface ReportSection {
  code: string;
  name: string;
  rawScore: number;
  effectiveMax: number;
  percent: number | null;
  tier: Tier | null;
  ratedCount: number;
  itemCount: number;
}

export interface ReportModel {
  title: string;
  statePlan: string | null;
  privileged: boolean;
  attorney: string | null;
  generatedAt: string;
  overall: { rawScore: number; effectiveMax: number; percent: number | null; tier: Tier | null };
  ratingCounts: Record<Rating, number>;
  sifCount: number;
  highPlusCount: number; // High + Very High findings
  sections: ReportSection[];
  findings: Finding[];
}

export function buildReportModel(
  audit: Audit,
  auditItems: AuditItem[],
  library: Map<string, LibraryItem>,
  sectionNames: Record<string, string>,
  generatedAt: string,
): ReportModel {
  const score = scoreForAudit(auditItems, library);
  const findings = deriveFindings(auditItems, library);

  const ratingCounts = Object.fromEntries(RATINGS.map((r) => [r, 0])) as Record<Rating, number>;
  for (const it of auditItems) {
    if (it.applicable && it.rating) ratingCounts[it.rating] += 1;
  }

  const sections: ReportSection[] = Object.keys(score.sections)
    .sort()
    .map((code) => {
      const s = score.sections[code]!;
      return {
        code,
        name: sectionNames[code] ?? code,
        rawScore: s.rawScore,
        effectiveMax: s.effectiveMax,
        percent: s.percent,
        tier: s.tier,
        ratedCount: s.ratedCount,
        itemCount: s.itemCount,
      };
    });

  return {
    title: audit.title,
    statePlan: audit.state_plan,
    privileged: audit.privileged,
    attorney: audit.attorney_of_record,
    generatedAt,
    overall: {
      rawScore: score.rawScore,
      effectiveMax: score.effectiveMax,
      percent: score.percent,
      tier: score.tier,
    },
    ratingCounts,
    sifCount: findings.filter((f) => f.sif_potential).length,
    highPlusCount: findings.filter((f) => f.rating === 'High' || f.rating === 'Very High').length,
    sections,
    findings,
  };
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
function pct(p: number | null): string {
  return p === null ? '—' : `${p.toFixed(1)}%`;
}

/** Render the report as a self-contained print-ready HTML document. */
/** Per-finding evidence prepared by the caller (data URIs — this module stays
 *  pure). Keyed by audit_item_id. */
export interface ReportEvidence {
  [audit_item_id: string]: {
    /** Embedded photo data URIs (caller caps count/size). */
    photos: string[];
    /** Voice-note transcriptions, when captured. */
    transcriptions: string[];
    /** Evidence that exists but could not be embedded (cloud-only, unreadable). */
    unembedded: number;
  };
}

/**
 * The accepted legal-brief narrative to interleave into the report, plus who
 * accepted it (rendered on every AI block so the human sign-off is on the page).
 * The AI text is strictly ADDITIVE — it never supplies a rating or score.
 */
export interface ReportBriefRender {
  content: ReportBriefContent;
  acceptedBy?: string | null;
  acceptedAt?: string | null;
  model?: string | null;
}

/** A labeled container for AI-drafted, human-accepted prose. Empty body → nothing. */
function aiBlock(body: string, meta?: { acceptedBy?: string | null; acceptedAt?: string | null }): string {
  if (!body || !body.trim()) return '';
  const who = meta?.acceptedBy ? `reviewed &amp; accepted by ${esc(meta.acceptedBy)}` : 'reviewed &amp; accepted';
  const when = meta?.acceptedAt ? ` on ${esc(meta.acceptedAt)}` : '';
  return `<div class="ai-block">
    <div class="ai-tag">AI-drafted narrative — ${who}${when}</div>
    <div class="ai-body">${esc(body).replace(/\n/g, '<br/>')}</div>
  </div>`;
}

export function renderReportHtml(
  model: ReportModel,
  evidence?: ReportEvidence,
  brief?: ReportBriefRender,
): string {
  const watermark = model.privileged
    ? `<div class="wm">PRIVILEGED &amp; CONFIDENTIAL — ATTORNEY WORK PRODUCT</div>`
    : '';
  const b = brief?.content;
  const bmeta = brief ? { acceptedBy: brief.acceptedBy, acceptedAt: brief.acceptedAt } : undefined;

  const sectionRows = model.sections
    .map(
      (s) => `<tr>
        <td class="mono">${esc(s.code)}</td>
        <td>${esc(s.name)}</td>
        <td class="num">${s.rawScore.toFixed(1)} / ${s.effectiveMax}</td>
        <td class="num">${pct(s.percent)}</td>
        <td>${s.tier ?? 'N/A'}</td>
        <td class="num">${s.ratedCount}/${s.itemCount}</td>
      </tr>`,
    )
    .join('');

  const evidenceBlock = (itemId: string): string => {
    const ev = evidence?.[itemId];
    if (!ev || (ev.photos.length === 0 && ev.transcriptions.length === 0 && ev.unembedded === 0)) return '';
    const imgs = ev.photos.map((p) => `<img src="${p}" alt="evidence photo"/>`).join('');
    const notes = ev.transcriptions.map((t) => `<div class="ev-note">🎙 ${esc(t)}</div>`).join('');
    const more = ev.unembedded > 0
      ? `<div class="ev-more">+${ev.unembedded} more evidence item${ev.unembedded === 1 ? '' : 's'} on file</div>`
      : '';
    return `<div class="lbl">Evidence</div>${imgs ? `<div class="ev-imgs">${imgs}</div>` : ''}${notes}${more}`;
  };

  const findingRows = model.findings
    .map(
      (f) => `<div class="finding" style="border-left:5px solid ${ratingColors[f.rating]}">
        <div class="fh"><span class="mono">${esc(f.item_code)}</span>
          <span class="tag" style="color:${ratingColors[f.rating]}">${f.rating}</span>
          ${f.sif_potential ? '<span class="sif">SIF</span>' : ''}</div>
        <div class="req">${esc(f.requirement)}</div>
        <div class="cite mono">${esc(f.citation)}</div>
        ${f.observations ? `<div class="lbl">Observations</div><div>${esc(f.observations)}</div>` : ''}
        ${f.recommendations ? `<div class="lbl">Recommendations</div><div>${esc(f.recommendations)}</div>` : ''}
        ${b?.findingNarratives[f.audit_item_id]
          ? `<div class="lbl">Risk characterization</div>${aiBlock(b.findingNarratives[f.audit_item_id]!, bmeta)}`
          : ''}
        ${evidenceBlock(f.audit_item_id)}
      </div>`,
    )
    .join('');

  // AI-drafted, human-accepted document sections (all optional — a report with
  // no accepted brief renders exactly as before). Scores/ratings above are never
  // sourced from here.
  const disclaimerBlock = b?.legalDisclaimer
    ? `<h2>Disclaimers</h2><div class="disclaimer">${esc(b.legalDisclaimer).replace(/\n/g, '<br/>')}</div>`
    : '';
  const execNarrative = b?.execSummary
    ? `<div class="lbl">Summary for counsel</div>${aiBlock(b.execSummary, bmeta)}`
    : '';
  const methodologyBlock = b?.methodology
    ? `<h2>Scope &amp; methodology</h2>${aiBlock(b.methodology, bmeta)}`
    : '';
  const chainOfCustodyBlock = b?.chainOfCustody
    ? `<h2>Evidentiary integrity &amp; chain of custody</h2>${aiBlock(b.chainOfCustody, bmeta)}`
    : '';
  const limitationsBlock = b?.limitations
    ? `<h2>Limitations &amp; reservations</h2>${aiBlock(b.limitations, bmeta)}`
    : '';
  // A hard, always-present statement whenever a brief is included — belt and
  // suspenders alongside the AI-generated disclaimer.
  const humanRatedNote = b
    ? `<div class="human-note">Ratings, scores, and effective maximums in this report were determined by the human auditor using the validated scoring engine. The AI-drafted narrative was reviewed and accepted by a human and does not set or alter any rating.</div>`
    : '';

  const ratingPills = RATINGS.map(
    (r) =>
      `<span class="pill"><span class="dot" style="background:${ratingColors[r]}"></span>${r}: <b>${model.ratingCounts[r]}</b></span>`,
  ).join('');

  return `<!doctype html><html><head><meta charset="utf-8"/>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #17202B; margin: 32px; }
    h1 { font-size: 22px; margin: 0 0 2px; }
    h2 { font-size: 15px; margin: 22px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
    .muted { color: #5F6E7D; font-size: 12px; }
    .mono { font-family: 'Courier New', monospace; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 5px 7px; border-bottom: 1px solid #e5e5e5; text-align: left; }
    th { background: #f2f4f6; }
    .summary { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
    .pill { font-size: 12px; background: #f2f4f6; border-radius: 999px; padding: 3px 10px; }
    .ev-imgs { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0; }
    .ev-imgs img { max-width: 180px; max-height: 140px; object-fit: cover; border: 1px solid #ddd; border-radius: 4px; }
    .ev-note { font-size: 12px; font-style: italic; margin: 2px 0; }
    .ev-more { font-size: 11px; color: #5F6E7D; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 4px; margin-right: 5px; vertical-align: middle; }
    .kpi { font-size: 13px; margin: 6px 0; }
    .finding { padding: 8px 10px; margin: 8px 0; background: #fafbfc; border-radius: 6px; }
    .fh { display: flex; gap: 8px; align-items: center; font-weight: 700; }
    .tag { font-weight: 800; margin-left: auto; }
    .sif { background: #8F1D28; color: #fff; font-size: 10px; font-weight: 800; padding: 1px 6px; border-radius: 4px; }
    .req { margin: 4px 0; font-size: 13px; }
    .cite { color: #5F6E7D; font-size: 11px; }
    .lbl { color: #5F6E7D; font-size: 10px; text-transform: uppercase; letter-spacing: .5px; margin-top: 6px; }
    .wm { position: fixed; top: 45%; left: 0; right: 0; text-align: center;
          transform: rotate(-24deg); color: rgba(143,29,40,.10); font-size: 34px;
          font-weight: 800; letter-spacing: 2px; pointer-events: none; z-index: 0; }
    .content { position: relative; z-index: 1; }
    .ai-block { background: #f6f8fb; border: 1px solid #dbe3ec; border-left: 4px solid #4A6FA5;
                border-radius: 5px; padding: 8px 10px; margin: 4px 0 8px; }
    .ai-tag { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: #4A6FA5;
              font-weight: 700; margin-bottom: 4px; }
    .ai-body { font-size: 13px; }
    .disclaimer { font-size: 11px; color: #5F6E7D; background: #f2f4f6; border-radius: 5px;
                  padding: 8px 10px; }
    .human-note { font-size: 11px; color: #17202B; background: #fff7e6; border: 1px solid #f0d9a8;
                  border-radius: 5px; padding: 6px 10px; margin: 6px 0; }
  </style></head><body>
  ${watermark}
  <div class="content">
    <h1>${esc(model.title)}</h1>
    <div class="muted">Generated ${esc(model.generatedAt)}${model.statePlan ? ` · State plan: ${esc(model.statePlan)}` : ' · Federal OSHA General Industry'}</div>
    ${model.privileged ? `<div class="muted">Prepared at the direction of counsel${model.attorney ? `: ${esc(model.attorney)}` : ''}</div>` : ''}
    ${humanRatedNote}
    ${disclaimerBlock}

    <h2>Executive summary</h2>
    <div class="kpi">Overall: <b>${model.overall.rawScore.toFixed(1)} / ${model.overall.effectiveMax}</b> · ${pct(model.overall.percent)} · Tier <b>${model.overall.tier ?? 'N/A'}</b></div>
    <div class="summary">${ratingPills}</div>
    <div class="kpi">High/Very High findings: <b>${model.highPlusCount}</b> · SIF-potential: <b>${model.sifCount}</b> · Total findings: <b>${model.findings.length}</b></div>
    ${execNarrative}
    ${methodologyBlock}

    <h2>Section scores</h2>
    <table><thead><tr><th>Code</th><th>Section</th><th>Score / Max</th><th>%</th><th>Tier</th><th>Rated</th></tr></thead>
    <tbody>${sectionRows}</tbody></table>

    <h2>Findings (Very High → Low)</h2>
    ${findingRows || '<div class="muted">No findings.</div>'}
    ${chainOfCustodyBlock}
    ${limitationsBlock}
  </div>
  </body></html>`;
}

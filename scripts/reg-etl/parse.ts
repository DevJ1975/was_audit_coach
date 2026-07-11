/**
 * eCFR XML → RegDocument[] (Phase C1).
 *
 * The eCFR "full" endpoint returns one XML tree per part:
 *   DIV5 (PART) › DIV6 (SUBPART) › [DIV7 (SUBJGRP)] › DIV8 (SECTION) / DIV9 (APPENDIX)
 * Every DIV carries `hierarchy_metadata` (JSON in an attribute) with the official
 * citation and a path we turn into a stable ecfr.gov URL. Section text lives in
 * P / NOTE / EXTRACT / FP blocks; appendices may hold large GPO tables, which we
 * flatten row-wise so their content (e.g. exempt NAICS codes) stays retrievable.
 * CITA (the source credit, "[66 FR 6122, Jan. 19, 2001, as amended …]") is
 * excluded from the body but mined for the last-amended date.
 */
import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'node:crypto';
import type { RegDocument } from './types';

// preserveOrder keeps document order (text interleaved with markup), which is
// what a legal text needs — paragraph (a) must precede (b).
type XNode = { [tag: string]: XNode[] | string } & { ':@'?: Record<string, string> };

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  htmlEntities: true,
  trimValues: false,
});

const BLOCK_TAGS = new Set(['P', 'FP', 'PSPACE', 'HED', 'GPH', 'SECAUTH']);
const SKIP_TAGS = new Set(['CITA', 'PRTPAGE', 'EAR', 'HD1', 'FTREF', 'STARS']);

function tagOf(node: XNode): string | null {
  return Object.keys(node).find((k) => k !== ':@' && k !== '#text') ?? null;
}

function children(node: XNode): XNode[] {
  const tag = tagOf(node);
  const kids = tag ? node[tag] : null;
  return Array.isArray(kids) ? kids : [];
}

function attrs(node: XNode): Record<string, string> {
  return node[':@'] ?? {};
}

/** All descendant text of `node`, whitespace-collapsed. */
function textOf(node: XNode): string {
  const t = node['#text'];
  if (typeof t === 'string' || typeof t === 'number') return String(t);
  let out = '';
  for (const child of children(node)) {
    const tag = tagOf(child);
    if (tag && SKIP_TAGS.has(tag)) continue;
    out += `${textOf(child)} `;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Flatten a node into block-level paragraph strings, in document order.
 * Tables become one string per row ("cell | cell | …"); NOTE blocks keep their
 * heading inline so the caveat travels with the text.
 */
function blocksOf(node: XNode, out: string[]): void {
  for (const child of children(node)) {
    const tag = tagOf(child);
    if (!tag) continue;
    if (SKIP_TAGS.has(tag)) continue;
    if (tag === 'HEAD') continue; // handled by the caller as the title
    if (tag === 'TR') {
      const row = children(child)
        .map((cell) => textOf(cell))
        .filter(Boolean)
        .join(' | ');
      if (row) out.push(row);
    } else if (BLOCK_TAGS.has(tag)) {
      const text = textOf(child);
      if (text) out.push(text);
    } else {
      // Container (NOTE, EXTRACT, DIV, TABLE, THEAD, TBODY, …) — recurse.
      blocksOf(child, out);
    }
  }
}

/** Last "Month D, YYYY" in a source credit → ISO date, or null. */
export function lastAmendedFrom(cita: string): string | null {
  const re = /(Jan|Feb|Mar|Apr|May|June?|July?|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),\s+(\d{4})/g;
  const months: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  let last: string | null = null;
  for (const m of cita.matchAll(re)) {
    const mon = months[m[1]!.toLowerCase().slice(0, 3)];
    if (!mon) continue;
    last = `${m[3]}-${String(mon).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
  }
  return last;
}

function metaOf(node: XNode): { citation: string | null; url: string | null } {
  const raw = attrs(node)['hierarchy_metadata'];
  if (!raw) return { citation: null, url: null };
  try {
    // Some DIV levels double-encode the attribute (&amp;quot;) — decode twice.
    const meta = JSON.parse(raw.replace(/&quot;/g, '"')) as { citation?: string; path?: string };
    const url = meta.path
      ? `https://www.ecfr.gov${encodeURI(meta.path.replace('/on/_SUBSTITUTE_DATE_', '/current'))}`
      : null;
    return { citation: meta.citation ?? null, url };
  } catch {
    return { citation: null, url: null };
  }
}

function headOf(node: XNode): string {
  const head = children(node).find((c) => tagOf(c) === 'HEAD');
  return head ? textOf(head) : '';
}

function citaOf(node: XNode): string {
  return children(node)
    .filter((c) => tagOf(c) === 'CITA')
    .map((c) => textOf(c))
    .join(' ');
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** '§ 1904.1 Partial exemption …' → 'Partial exemption …' */
function sectionTitle(head: string): string {
  return head.replace(/^§+\s*[\d.]+([-–][\d.]+)?\s*/, '').trim();
}

export interface ParseResult {
  part: string;
  partHeading: string;
  documents: RegDocument[];
}

/**
 * Parse one part's eCFR XML into section/appendix documents.
 * `version` is the eCFR issue date the XML was fetched at.
 */
export function parsePartXml(xml: string, version: string): ParseResult {
  const roots = parser.parse(xml) as XNode[];
  const partNode = findDiv(roots, 'DIV5');
  if (!partNode) throw new Error('No DIV5 (PART) node found in eCFR XML.');

  const part = attrs(partNode)['N'] ?? 'unknown';
  const partHeading = headOf(partNode);
  const documents: RegDocument[] = [];

  const walk = (node: XNode, trail: string[]): void => {
    for (const child of children(node)) {
      const tag = tagOf(child);
      if (!tag) continue;
      const type = attrs(child)['TYPE'];

      if ((tag === 'DIV6' && type === 'SUBPART') || (tag === 'DIV7' && type === 'SUBJGRP')) {
        walk(child, [...trail, headOf(child)]);
      } else if (tag === 'DIV8' && type === 'SECTION') {
        const doc = buildDoc(child, `ecfr:${attrs(child)['N']}`, trail, true);
        if (doc) documents.push(doc);
      } else if (tag === 'DIV9' && type === 'APPENDIX') {
        const doc = buildDoc(child, `ecfr:${part}:${slug(attrs(child)['N'] ?? 'appendix')}`, trail, false);
        if (doc) documents.push(doc);
      }
    }
  };

  const buildDoc = (node: XNode, id: string, trail: string[], isSection: boolean): RegDocument | null => {
    const head = headOf(node);
    const { citation, url } = metaOf(node);
    const paragraphs: string[] = [];
    blocksOf(node, paragraphs);
    const body = paragraphs.join('\n');
    if (!body || /\[reserved\]/i.test(head)) return null; // skip reserved/empty rows

    const heading_path = [partHeading, ...trail, head].filter(Boolean).join(' › ');
    return {
      id,
      jurisdiction: 'federal',
      citation: citation ?? head,
      title: isSection ? sectionTitle(head) : head,
      heading_path,
      part,
      body,
      paragraphs,
      source_url: url ?? `https://www.ecfr.gov/current/title-29/part-${part}`,
      last_amended: lastAmendedFrom(citaOf(node)),
      version,
      content_hash: sha256(body),
    };
  };

  walk(partNode, []);
  return { part, partHeading, documents };
}

function findDiv(nodes: XNode[], tag: string): XNode | null {
  for (const node of nodes) {
    if (tagOf(node) === tag) return node;
    const found = findDiv(children(node), tag);
    if (found) return found;
  }
  return null;
}

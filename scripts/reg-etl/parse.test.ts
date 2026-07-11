import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lastAmendedFrom, parsePartXml, sha256 } from './parse';
import { chunkDocument } from './chunk';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Real eCFR XML (title 29, part 1904, subparts A–B) captured 2026-07-09.
const xml = readFileSync(resolve(__dirname, 'fixtures/part1904.sample.xml'), 'utf8');

describe('parsePartXml (real eCFR fixture)', () => {
  const { part, documents } = parsePartXml(xml, '2026-07-09');
  const byId = new Map(documents.map((d) => [d.id, d]));

  it('extracts sections and appendices with deterministic ids', () => {
    expect(part).toBe('1904');
    expect(byId.has('ecfr:1904.0')).toBe(true);
    expect(byId.has('ecfr:1904.1')).toBe(true);
    const appendix = documents.find((d) => d.id.includes('appendix'));
    expect(appendix).toBeDefined();
    expect(appendix!.id).toMatch(/^ecfr:1904:[a-z0-9-]+$/); // slug: URL/id-safe
  });

  it('carries the official citation and hierarchy from eCFR metadata', () => {
    const s = byId.get('ecfr:1904.1')!;
    expect(s.citation).toBe('29 CFR 1904.1');
    expect(s.title).toBe('Partial exemption for employers with 10 or fewer employees.');
    expect(s.heading_path).toContain('PART 1904');
    expect(s.heading_path).toContain('Subpart B');
    expect(s.source_url).toBe('https://www.ecfr.gov/current/title-29/section-1904.1');
    expect(s.jurisdiction).toBe('federal');
    expect(s.version).toBe('2026-07-09');
  });

  it('keeps regulatory text in document order, entities decoded', () => {
    const s = byId.get('ecfr:1904.1')!;
    expect(s.paragraphs[0]).toMatch(/^\(a\) Basic requirement/);
    expect(s.body).toContain('§ 1904.41'); // &#xA7; decoded
    expect(s.body).not.toContain('<'); // no markup leaks
    expect(s.body.indexOf('(a)')).toBeLessThan(s.body.indexOf('(b)'));
  });

  it('flattens appendix tables so their rows stay retrievable', () => {
    const appendix = documents.find((d) => d.id.includes('appendix'))!;
    // Appendix A to subpart B is the exempt-NAICS table.
    expect(appendix.body).toMatch(/\d{4} \|/); // 'NAICS | description' rows
  });

  it('mines last_amended from the source credit, excludes it from the body', () => {
    const s = byId.get('ecfr:1904.0')!;
    expect(s.last_amended).toBe('2017-05-03'); // [82 FR 20548, May 3, 2017]
    expect(s.body).not.toContain('82 FR 20548');
  });

  it('hashes content deterministically (idempotent re-runs)', () => {
    const again = parsePartXml(xml, '2026-07-09').documents;
    expect(again.map((d) => d.content_hash)).toEqual(documents.map((d) => d.content_hash));
    expect(sha256('a')).not.toBe(sha256('b'));
  });
});

describe('lastAmendedFrom', () => {
  it('takes the most recent date in a multi-credit CITA', () => {
    expect(
      lastAmendedFrom('[66 FR 6122, Jan. 19, 2001, as amended at 79 FR 56187, Sept. 18, 2014]'),
    ).toBe('2014-09-18');
  });
  it('returns null when no date is present', () => {
    expect(lastAmendedFrom('')).toBeNull();
  });
});

describe('chunkDocument (on the real fixture)', () => {
  const { documents } = parsePartXml(xml, '2026-07-09');

  it('prefixes every chunk with its citation header and preserves all body text', () => {
    for (const doc of documents) {
      const chunks = chunkDocument(doc);
      expect(chunks.length).toBeGreaterThan(0);
      chunks.forEach((c, i) => {
        expect(c.ordinal).toBe(i);
        expect(c.id).toBe(`${doc.id}#${i}`);
        expect(c.text.startsWith(`${doc.citation} — ${doc.title}`)).toBe(true);
      });
      const rebuilt = chunks
        .map((c) => c.text.split('\n').slice(1).join('\n'))
        .join('\n');
      expect(rebuilt).toBe(doc.body); // no text lost or duplicated
    }
  });
});

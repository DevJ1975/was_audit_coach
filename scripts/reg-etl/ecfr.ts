/**
 * eCFR API client (Phase C1). https://www.ecfr.gov/developers — public, no key.
 * The versioner API is date-addressed: we resolve title 29's current issue date
 * once, then fetch each part's full XML at that date, so a single ETL run is
 * internally consistent and the date doubles as the corpus `version`.
 */

const BASE = 'https://www.ecfr.gov/api/versioner/v1';

/** 29 CFR parts in corpus scope (SOTERIA_CHAT_KB_PLAN.md §2, Tier 1). */
export const FEDERAL_PARTS = ['1903', '1904', '1910', '1915', '1917', '1918', '1926'] as const;

async function get(url: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { accept: '*/*' } });
    if (res.ok) return res;
    if (attempt >= 3 || (res.status < 500 && res.status !== 429)) {
      throw new Error(`eCFR ${res.status} for ${url}`);
    }
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
}

/** Title 29's `up_to_date_as_of` date — the version stamp for this run. */
export async function latestIssueDate(): Promise<string> {
  const res = await get(`${BASE}/titles.json`);
  const data = (await res.json()) as { titles: { number: number; up_to_date_as_of: string }[] };
  const t29 = data.titles.find((t) => t.number === 29);
  if (!t29?.up_to_date_as_of) throw new Error('eCFR titles.json missing title 29.');
  return t29.up_to_date_as_of;
}

/** Full XML for one part of title 29 at the given issue date. */
export async function fetchPartXml(date: string, part: string): Promise<string> {
  const res = await get(`${BASE}/full/${date}/title-29.xml?part=${part}`);
  return res.text();
}

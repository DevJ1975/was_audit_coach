/**
 * Pure eval checks for AI drafts. These validate a draft's TEXT against the
 * grounded item — they never call a model, so they run in CI and can also gate
 * accepted drafts at runtime if desired.
 */

export function wordCount(text: string): number {
  const t = text.trim();
  return t.length === 0 ? 0 : t.split(/\s+/).length;
}

export function withinWordLimit(text: string, max: number): boolean {
  return wordCount(text) <= max;
}

/** Verdict/rating language a draft must not contain (Non-Negotiable #2). */
const RATING_PATTERNS: RegExp[] = [
  /\b(best practice|verified|low|moderate|high|very high|not applicable)\s+rating\b/i,
  /\brating\s*[:=]/i,
  /\b(non-?compliant|compliant)\b/i,
  /\b(pass|fail)(ed|s)?\b/i,
  /\bi\s+(would\s+)?(rate|score|assign)\b/i,
  /\bthis\s+is\s+a\s+(finding|deficiency|violation)\b/i,
];

export function hasNoRatingLanguage(text: string): boolean {
  return !RATING_PATTERNS.some((re) => re.test(text));
}

/** Extract citation-like tokens (federal CFR and state CCR/§ forms). */
export function extractCitations(text: string): string[] {
  const out = new Set<string>();
  const re = /\b\d+\s*CFR\s*[\d.]+(?:\([\da-z]+\))*|Title\s+\d+\s+CCR\s*§?\s*[\d.]+/gi;
  for (const m of text.match(re) ?? []) out.add(m.replace(/\s+/g, ' ').trim());
  return [...out];
}

/** Normalize a citation to its numeric spine for loose comparison. */
function citationCore(c: string): string {
  return c.replace(/\s+/g, '').toLowerCase();
}

/**
 * Citation fidelity — a draft must not cite regulations other than the item's
 * own citation (i.e. it must not invent regs). Returns any invented citations.
 */
export function citesOnlyAllowed(
  draft: string,
  allowedCitation: string,
): { ok: boolean; invented: string[] } {
  const allowed = citationCore(allowedCitation);
  const invented = extractCitations(draft).filter((c) => {
    const core = citationCore(c);
    // OK if the cited token is a prefix/substring of the item's citation
    // (paragraph subsets like 1910.146 within 1910.146(c)(2)) or vice-versa.
    return !(allowed.includes(core) || core.includes(allowed.split('(')[0] ?? allowed));
  });
  return { ok: invented.length === 0, invented };
}

export interface DraftCheck {
  withinLimit: boolean;
  noRatingLanguage: boolean;
  citationOk: boolean;
  invented: string[];
}

export function checkDraft(draft: string, allowedCitation: string, wordLimit: number): DraftCheck {
  const cite = citesOnlyAllowed(draft, allowedCitation);
  return {
    withinLimit: withinWordLimit(draft, wordLimit),
    noRatingLanguage: hasNoRatingLanguage(draft),
    citationOk: cite.ok,
    invented: cite.invented,
  };
}

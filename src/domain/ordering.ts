/**
 * Canonical audit-item ordering — the SINGLE source of truth used by every repo
 * implementation and the item list, so what ships matches the tested reference
 * (memoryRepo) exactly. Order: by section_code, then item_code numerically
 * (CS-2 before CS-10). Findings inherit this order under the stable severity sort.
 */
export function compareByCode(
  a: { section_code: string; item_code: string },
  b: { section_code: string; item_code: string },
): number {
  if (a.section_code !== b.section_code) return a.section_code < b.section_code ? -1 : 1;
  return a.item_code.localeCompare(b.item_code, undefined, { numeric: true });
}

/**
 * Applicability: the pre-audit scoping answers conditionally activate item
 * groups (Engine #1). Pure — no storage, no platform. Tested in isolation.
 *
 * Model: each scoping question activates one or more GROUPS (a group id is a
 * section_code like "PIT" or a specific item_code like "FP-16"). A question has
 * a polarity `applies_on`: normally 'Yes' (answering Yes activates the group),
 * but three source rows are inverted — 'No' activates the group (Open Item 2:
 * FP-16 standpipe, OH-1 abrasive blasting, OH-3 spray finishing).
 *
 * An item is APPLICABLE unless every group that gates it is inactive. Items no
 * question gates are always applicable (baseline OSHA General Industry items).
 */
import type { LibraryItem } from '@/db/types';

export interface ScopingQuestion {
  key: string;
  question: string;
  /** section_codes and/or item_codes this question activates. */
  activates: string[];
  /** Which answer activates the group. Default 'Yes'; inverted rows use 'No'. */
  applies_on?: 'Yes' | 'No';
}

/** True when the answer activates the question's groups given its polarity. */
export function isQuestionActive(q: ScopingQuestion, answer: boolean | undefined): boolean {
  if (answer === undefined) return false; // unanswered → group inactive (conservative)
  const activatingAnswer = (q.applies_on ?? 'Yes') === 'Yes';
  return answer === activatingAnswer;
}

function itemGroupIds(item: LibraryItem): string[] {
  return [item.section_code, item.item_code];
}

/**
 * Given the scoping questions and the audit's answers (question_key → bool),
 * return the set of item_codes that are applicable within `library`.
 */
export function computeApplicableCodes(
  library: LibraryItem[],
  questions: ScopingQuestion[],
  answers: Record<string, boolean>,
): Set<string> {
  // Which groups does any question gate, and is each gate active?
  const gateActive = new Map<string, boolean>(); // groupId → active?
  for (const q of questions) {
    const active = isQuestionActive(q, answers[q.key]);
    for (const g of q.activates) {
      // A group is active if ANY question that activates it is active.
      gateActive.set(g, (gateActive.get(g) ?? false) || active);
    }
  }

  const applicable = new Set<string>();
  for (const item of library) {
    const gates = itemGroupIds(item).filter((g) => gateActive.has(g));
    // Ungated items are always applicable; gated items need an active gate.
    const isApplicable = gates.length === 0 || gates.some((g) => gateActive.get(g));
    if (isApplicable) applicable.add(item.item_code);
  }
  return applicable;
}

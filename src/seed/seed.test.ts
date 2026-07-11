import { describe, it, expect } from 'vitest';
import { seedLibrary, seedQuestions, statePlans, libraryByCode } from './index';
import fixture from './pilot_validation_fixture.json';

describe('seed counts (ETL invariants)', () => {
  const federal = seedLibrary.filter((i) => i.state == null);
  const state = seedLibrary.filter((i) => i.state != null);

  it('has 286 federal + 88 state = 374 items', () => {
    expect(federal.length).toBe(286);
    expect(state.length).toBe(88);
    expect(seedLibrary.length).toBe(374);
  });

  it('has 15 scoping questions and 22 state plans', () => {
    expect(seedQuestions.length).toBe(15);
    expect(statePlans.length).toBe(22);
  });

  it('flags exactly the three inverted "No → applies" scoping rows (Part 5 Open Item 2)', () => {
    const inverted = seedQuestions.filter((q) => q.applies_on === 'No');
    const invertedItems = inverted.flatMap((q) => q.activates).sort();
    expect(invertedItems).toEqual(['FP-16', 'OH-1', 'OH-3']);
  });

  it('every item has non-empty requirement, evidence protocol, citation, and a valid weight', () => {
    for (const it of seedLibrary) {
      expect(it.requirement.length).toBeGreaterThan(0);
      expect(it.evidence_protocol.length).toBeGreaterThan(0);
      expect(it.citation.length).toBeGreaterThan(0);
      expect(it.max_points).toBeGreaterThanOrEqual(3);
      expect(it.max_points).toBeLessThanOrEqual(10);
    }
  });
});

describe('extracted CS library agrees with the §1.2 validation fixture', () => {
  it('every CS item weight in the real library matches the sacred fixture', () => {
    for (const f of fixture.items) {
      const lib = libraryByCode.get(f.item_code);
      expect(lib, `missing ${f.item_code}`).toBeDefined();
      expect(lib!.max_points, `weight mismatch for ${f.item_code}`).toBe(f.max_points);
    }
  });
});

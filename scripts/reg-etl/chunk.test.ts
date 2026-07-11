import { describe, expect, it } from 'vitest';
import { estimateTokens, HARD_MAX_TOKENS, packParagraphs, TARGET_TOKENS } from './chunk';

const para = (tokens: number, ch = 'x'): string => ch.repeat(tokens * 4);

describe('packParagraphs', () => {
  it('packs small paragraphs greedily up to the target', () => {
    const chunks = packParagraphs(Array.from({ length: 10 }, () => para(300)));
    // 300 + 300 fits (600 ≤ 800); a third would overflow → pairs.
    expect(chunks).toHaveLength(5);
    for (const c of chunks) expect(estimateTokens(c)).toBeLessThanOrEqual(TARGET_TOKENS + 1);
  });

  it('never splits inside a normal-size paragraph', () => {
    const chunks = packParagraphs([para(500, 'a'), para(500, 'b')]);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(para(500, 'a'));
  });

  it('splits an oversized paragraph at sentence boundaries', () => {
    const sentence = `${'word '.repeat(50)}. `; // ~63 tokens each
    const oversized = sentence.repeat(80); // ~5000 tokens
    const chunks = packParagraphs([oversized]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(estimateTokens(c)).toBeLessThanOrEqual(HARD_MAX_TOKENS);
    }
  });

  it('emits nothing for an empty document', () => {
    expect(packParagraphs([])).toHaveLength(0);
  });

  it('is deterministic', () => {
    const input = [para(100), para(700), para(300), para(300)];
    expect(packParagraphs(input)).toEqual(packParagraphs(input));
  });
});

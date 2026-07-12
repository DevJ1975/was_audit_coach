import { describe, it, expect } from 'vitest';
import { parseExecSummary, LEGAL_DISCLAIMER } from './reportBriefFormat';

describe('parseExecSummary', () => {
  it('splits the four tagged sections in any order', () => {
    const text = [
      '[EXEC_SUMMARY]',
      'Posture is developing.',
      '[METHODOLOGY]',
      'WLS workbook basis.',
      '[CHAIN_OF_CUSTODY]',
      'Immutable events.',
      '[LIMITATIONS]',
      'Point in time.',
    ].join('\n');
    const out = parseExecSummary(text);
    expect(out.EXEC_SUMMARY).toBe('Posture is developing.');
    expect(out.METHODOLOGY).toBe('WLS workbook basis.');
    expect(out.CHAIN_OF_CUSTODY).toBe('Immutable events.');
    expect(out.LIMITATIONS).toBe('Point in time.');
  });

  it('keeps untagged output rather than dropping it', () => {
    const out = parseExecSummary('The model forgot the tags but wrote a summary.');
    expect(out.EXEC_SUMMARY).toBe('The model forgot the tags but wrote a summary.');
    expect(out.METHODOLOGY).toBe('');
  });

  it('tolerates missing sections', () => {
    const out = parseExecSummary('[EXEC_SUMMARY]\nonly this one');
    expect(out.EXEC_SUMMARY).toBe('only this one');
    expect(out.CHAIN_OF_CUSTODY).toBe('');
  });
});

describe('LEGAL_DISCLAIMER', () => {
  it('states AI-assisted, human-rated, and not legal advice', () => {
    expect(LEGAL_DISCLAIMER).toMatch(/AI/i);
    expect(LEGAL_DISCLAIMER).toMatch(/not legal advice/i);
    expect(LEGAL_DISCLAIMER).toMatch(/determined solely by the auditor/i);
  });
});

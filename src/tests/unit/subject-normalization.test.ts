import { describe, expect, it } from 'vitest';
import { getSubjectSearchVariants, normalizeSubjectLabel } from '../../shared/utils/subjects';

describe('subject normalization', () => {
  it('maps legacy English labels to the canonical exam subject', () => {
    expect(normalizeSubjectLabel('English Language')).toBe('English');
    expect(normalizeSubjectLabel('  use of english  ')).toBe('English');
  });

  it('returns lookup variants for canonical subjects', () => {
    expect(getSubjectSearchVariants('English')).toEqual([
      'English',
      'English Language',
      'Use of English'
    ]);
  });

  it('normalizes common mathematics aliases', () => {
    expect(normalizeSubjectLabel('maths')).toBe('Mathematics');
    expect(getSubjectSearchVariants('Mathematics')).toContain('Math');
  });
});

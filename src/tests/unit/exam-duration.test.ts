import { describe, expect, it } from 'vitest';
import { EXAM_CONFIG } from '../../modules/exams/exams.constants';
import { calculateExamDuration } from '../../modules/exams/question-selector';

describe('calculateExamDuration', () => {
  it('uses 22 minutes for single-subject exams', () => {
    expect(calculateExamDuration(25)).toBe(EXAM_CONFIG.SINGLE_SUBJECT_DURATION_SECONDS);
  });

  it('uses 44 minutes for two-subject exams', () => {
    expect(calculateExamDuration(50)).toBe(EXAM_CONFIG.TWO_SUBJECT_DURATION_SECONDS);
  });

  it('uses 66 minutes for three-subject exams', () => {
    expect(calculateExamDuration(75)).toBe(EXAM_CONFIG.THREE_SUBJECT_DURATION_SECONDS);
  });

  it('uses 90 minutes for full exams', () => {
    expect(calculateExamDuration(100)).toBe(EXAM_CONFIG.FULL_EXAM_DURATION_SECONDS);
  });
});

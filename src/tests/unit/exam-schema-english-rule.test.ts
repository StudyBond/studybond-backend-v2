import { describe, expect, it } from 'vitest';
import { EXAM_TYPES } from '../../modules/exams/exams.constants';
import { startExamSchema } from '../../modules/exams/exams.schema';

describe('startExamSchema English requirement', () => {
  it('allows non-full exams without English for real mode', () => {
    const parsed = startExamSchema.parse({
      examType: EXAM_TYPES.REAL_PAST_QUESTION,
      subjects: ['Biology']
    });
    expect(parsed.subjects).toEqual(['Biology']);
  });

  it('rejects full exams without English', () => {
    const result = startExamSchema.safeParse({
      examType: EXAM_TYPES.PRACTICE,
      subjects: ['Biology', 'Chemistry', 'Physics', 'Mathematics']
    });
    expect(result.success).toBe(false);
  });

  it('accepts full exams with English', () => {
    const result = startExamSchema.safeParse({
      examType: EXAM_TYPES.PRACTICE,
      subjects: ['Biology', 'English', 'Physics', 'Mathematics']
    });
    expect(result.success).toBe(true);
  });

  it('rejects mixed mode for full exams', () => {
    const result = startExamSchema.safeParse({
      examType: EXAM_TYPES.MIXED,
      subjects: ['Biology', 'English', 'Physics', 'Mathematics']
    });
    expect(result.success).toBe(false);
  });

  it('allows partial exams without an explicit examType so service can resolve the default', () => {
    const result = startExamSchema.safeParse({
      subjects: ['Biology', 'Chemistry']
    });
    expect(result.success).toBe(true);
  });

  it('allows full exams without an explicit examType so service can resolve the default to real UI questions', () => {
    const result = startExamSchema.safeParse({
      subjects: ['Biology', 'English', 'Physics', 'Mathematics']
    });
    expect(result.success).toBe(true);
  });
});

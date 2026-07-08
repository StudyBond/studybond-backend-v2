import { describe, expect, it } from 'vitest';
import { createQuestionSchema, updateQuestionSchema } from '../../modules/questions/questions.schema';

describe('Questions schema validation', () => {
  it('allows a parent prompt with no answer choices and no correct answer', () => {
    const payload = {
      questionText: 'Read the passage and answer the questions below.',
      subject: 'English',
      questionType: 'REAL_PAST_QUESTION',
      questionPool: 'REAL_BANK'
    };

    const result = createQuestionSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('rejects a child question missing required answer choices', () => {
    const payload = {
      questionText: 'What is the main idea?',
      subject: 'English',
      questionType: 'REAL_PAST_QUESTION',
      questionPool: 'REAL_BANK',
      parentQuestionId: 123,
      correctAnswer: 'A'
    };

    const result = createQuestionSchema.safeParse(payload);
    expect(result.success).toBe(false);
    expect(result.error.issues.some((issue) => issue.path.includes('optionA'))).toBe(true);
    expect(result.error.issues.some((issue) => issue.path.includes('correctAnswer'))).toBe(false);
  });

  it('rejects a create payload that includes a correct answer without options', () => {
    const payload = {
      questionText: 'Which option is correct?',
      subject: 'Mathematics',
      questionType: 'REAL_PAST_QUESTION',
      questionPool: 'REAL_BANK',
      correctAnswer: 'A'
    };

    const result = createQuestionSchema.safeParse(payload);
    expect(result.success).toBe(false);
    expect(result.error.issues.some((issue) => issue.path.includes('correctAnswer'))).toBe(true);
  });

  it('requires all option fields when any answer choice is provided', () => {
    const payload = {
      questionText: 'Select the correct answer.',
      subject: 'Biology',
      questionType: 'REAL_PAST_QUESTION',
      questionPool: 'REAL_BANK',
      optionA: 'Option A',
      optionB: 'Option B',
      optionC: 'Option C',
      correctAnswer: 'A'
    };

    const result = createQuestionSchema.safeParse(payload);
    expect(result.success).toBe(false);
    expect(result.error.issues.some((issue) => issue.path.includes('optionD'))).toBe(true);
  });

  it('allows a valid child question with all answer choices and correct answer', () => {
    const payload = {
      questionText: 'What is 2 + 2?',
      subject: 'Mathematics',
      questionType: 'REAL_PAST_QUESTION',
      questionPool: 'REAL_BANK',
      parentQuestionId: 90,
      optionA: '3',
      optionB: '4',
      optionC: '5',
      optionD: '6',
      correctAnswer: 'B'
    };

    const result = createQuestionSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('rejects update payload when options and correct answer are partially provided for a child question', () => {
    const payload = {
      parentQuestionId: 12,
      optionA: 'True'
    };

    const result = updateQuestionSchema.safeParse(payload);
    expect(result.success).toBe(false);
    expect(result.error.issues.some((issue) => issue.path.includes('optionB'))).toBe(true);
  });
});

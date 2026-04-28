import { describe, expect, it } from 'vitest';
import {
  normalizeQuestionSource,
  QUESTION_POOLS,
  QUESTION_TYPES
} from '../../modules/questions/questions.constants';

describe('Question source normalization', () => {
  it('defaults real questions into the REAL_BANK pool', () => {
    expect(
      normalizeQuestionSource({
        questionType: 'REAL_PAST_QUESTION'
      })
    ).toEqual({
      questionType: QUESTION_TYPES.REAL_PAST_QUESTION,
      questionPool: QUESTION_POOLS.REAL_BANK
    });
  });

  it('allows explicit FREE_EXAM real questions', () => {
    expect(
      normalizeQuestionSource({
        questionType: 'real_past_question',
        questionPool: 'FREE_EXAM'
      })
    ).toEqual({
      questionType: QUESTION_TYPES.REAL_PAST_QUESTION,
      questionPool: QUESTION_POOLS.FREE_EXAM
    });
  });

  it('rejects practice sources inside FREE_EXAM pool', () => {
    expect(() =>
      normalizeQuestionSource({
        questionType: 'PRACTICE',
        questionPool: 'FREE_EXAM'
      })
    ).toThrow('FREE_EXAM and REAL_BANK questions must use REAL_PAST_QUESTION as their source type.');
  });
});

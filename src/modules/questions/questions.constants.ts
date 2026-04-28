import { ValidationError } from '../../shared/errors/ValidationError';
import { EXAM_CONFIG } from '../exams/exams.constants';

export const QUESTION_TYPES = {
  REAL_PAST_QUESTION: 'real_past_question',
  PRACTICE: 'practice',
  AI_GENERATED: 'ai_generated'
} as const;

export const QUESTION_POOLS = {
  FREE_EXAM: 'FREE_EXAM',
  REAL_BANK: 'REAL_BANK',
  PRACTICE: 'PRACTICE'
} as const;

export const QUESTION_POOL_LIMITS = {
  FREE_EXAM_PER_SUBJECT: EXAM_CONFIG.QUESTIONS_PER_SUBJECT
} as const;

export type QuestionTypeValue = typeof QUESTION_TYPES[keyof typeof QUESTION_TYPES];
export type QuestionPoolValue = typeof QUESTION_POOLS[keyof typeof QUESTION_POOLS];

const QUESTION_TYPE_ALIASES: Record<string, QuestionTypeValue> = {
  REAL_PAST_QUESTION: QUESTION_TYPES.REAL_PAST_QUESTION,
  real_past_question: QUESTION_TYPES.REAL_PAST_QUESTION,
  'Real past question': QUESTION_TYPES.REAL_PAST_QUESTION,
  'Real Past Question': QUESTION_TYPES.REAL_PAST_QUESTION,
  'Real past questions': QUESTION_TYPES.REAL_PAST_QUESTION,
  'Real Past Questions': QUESTION_TYPES.REAL_PAST_QUESTION,
  PRACTICE: QUESTION_TYPES.PRACTICE,
  practice: QUESTION_TYPES.PRACTICE,
  Practice: QUESTION_TYPES.PRACTICE,
  AI_GENERATED: QUESTION_TYPES.AI_GENERATED,
  ai_generated: QUESTION_TYPES.AI_GENERATED,
  'AI generated': QUESTION_TYPES.AI_GENERATED,
  'AI Generated': QUESTION_TYPES.AI_GENERATED
};

const QUESTION_POOL_ALIASES: Record<string, QuestionPoolValue> = {
  FREE_EXAM: QUESTION_POOLS.FREE_EXAM,
  free_exam: QUESTION_POOLS.FREE_EXAM,
  'Free exam pool': QUESTION_POOLS.FREE_EXAM,
  'Free Exam Pool': QUESTION_POOLS.FREE_EXAM,
  'Free exam': QUESTION_POOLS.FREE_EXAM,
  'Free Exam': QUESTION_POOLS.FREE_EXAM,
  REAL_BANK: QUESTION_POOLS.REAL_BANK,
  real_bank: QUESTION_POOLS.REAL_BANK,
  'Real past questions': QUESTION_POOLS.REAL_BANK,
  'Real Past Questions': QUESTION_POOLS.REAL_BANK,
  'Real past question': QUESTION_POOLS.REAL_BANK,
  'Real Past Question': QUESTION_POOLS.REAL_BANK,
  PRACTICE: QUESTION_POOLS.PRACTICE,
  practice: QUESTION_POOLS.PRACTICE,
  'Practice pool': QUESTION_POOLS.PRACTICE,
  'Practice Pool': QUESTION_POOLS.PRACTICE,
  Practice: QUESTION_POOLS.PRACTICE
};

export function normalizeQuestionType(value?: string | null): QuestionTypeValue {
  const normalized = value ? QUESTION_TYPE_ALIASES[value.trim()] : QUESTION_TYPES.REAL_PAST_QUESTION;
  if (!normalized) {
    throw new ValidationError('Invalid question type. Use REAL_PAST_QUESTION, PRACTICE, or AI_GENERATED.');
  }

  return normalized;
}

export function normalizeQuestionPool(
  value?: string | null,
  questionType?: string | null
): QuestionPoolValue {
  if (!value) {
    const normalizedType = normalizeQuestionType(questionType);
    return normalizedType === QUESTION_TYPES.REAL_PAST_QUESTION
      ? QUESTION_POOLS.REAL_BANK
      : QUESTION_POOLS.PRACTICE;
  }

  const normalized = QUESTION_POOL_ALIASES[value.trim()];
  if (!normalized) {
    throw new ValidationError('Invalid question pool. Use FREE_EXAM, REAL_BANK, or PRACTICE.');
  }

  return normalized;
}

export function normalizeQuestionSource(input: {
  questionType?: string | null;
  questionPool?: string | null;
}): { questionType: QuestionTypeValue; questionPool: QuestionPoolValue } {
  const questionType = normalizeQuestionType(input.questionType);
  const questionPool = normalizeQuestionPool(input.questionPool, questionType);

  if (
    (questionPool === QUESTION_POOLS.FREE_EXAM || questionPool === QUESTION_POOLS.REAL_BANK) &&
    questionType !== QUESTION_TYPES.REAL_PAST_QUESTION
  ) {
    throw new ValidationError(
      'FREE_EXAM and REAL_BANK questions must use REAL_PAST_QUESTION as their source type.'
    );
  }

  if (
    questionPool === QUESTION_POOLS.PRACTICE &&
    questionType !== QUESTION_TYPES.PRACTICE &&
    questionType !== QUESTION_TYPES.AI_GENERATED
  ) {
    throw new ValidationError(
      'PRACTICE pool questions must use PRACTICE or AI_GENERATED as their source type.'
    );
  }

  return {
    questionType,
    questionPool
  };
}

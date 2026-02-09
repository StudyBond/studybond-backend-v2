// ============================================
// EXAMS MODULE VALIDATION SCHEMAS
// ============================================
// Zod schemas for request validation
// Strict validation with helpful error messages

import { z } from 'zod';
import { SUBJECTS, EXAM_TYPES, EXAM_STATUS, PAGINATION } from './exams.constants';

// ============================================
// SHARED VALIDATORS
// ============================================

/** Valid answer options */
const answerOptions = ['A', 'B', 'C', 'D', 'E'] as const;

/** Subject validator */
const subjectValidator = z.enum(SUBJECTS, {
    errorMap: () => ({ message: `Invalid subject. Must be one of: ${SUBJECTS.join(', ')}` })
} as any); // Cast to any to avoid errorMap type issue

/** Exam type validator */
const examTypeValidator = z.enum(
    [EXAM_TYPES.REAL_PAST_QUESTION, EXAM_TYPES.PRACTICE] as const,
    {
        errorMap: () => ({ message: 'Invalid exam type. Must be REAL_PAST_QUESTION or PRACTICE' })
    } as any // Cast to any to avoid errorMap type issue
);

// ============================================
// REQUEST SCHEMAS
// ============================================

/**
 * Schema for starting a new exam
 */
export const startExamSchema = z.object({
    examType: examTypeValidator,

    subjects: z
        .array(subjectValidator)
        .min(1, 'At least one subject is required')
        .max(4, 'Maximum 4 subjects allowed')
        .refine(
            (subjects) => new Set(subjects).size === subjects.length,
            'Duplicate subjects are not allowed'
        )
}).strict().superRefine((data, ctx) => {
    // Enforce English mandatory for REAL_PAST_QUESTION (Full Exam)
    if (data.examType === EXAM_TYPES.REAL_PAST_QUESTION) {
        if (!data.subjects.includes('English')) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "English Language is mandatory for Full Exams",
                path: ["subjects"]
            });
        }
    }
});

/**
 * Schema for a single answer
 */
export const answerSchema = z.object({
    questionId: z
        .number({ message: 'Question ID is required' } as any)
        .int('Question ID must be an integer')
        .positive('Question ID must be positive'),

    answer: z
        .string()
        .toUpperCase()
        .refine(
            (val) => val === '' || answerOptions.includes(val as any),
            'Answer must be A, B, C, D, E or empty string for skipped'
        )
        .nullable()
        .transform((val) => (val === '' ? null : val)),

    timeSpentSeconds: z
        .number()
        .int()
        .min(0, 'Time spent cannot be negative')
        .max(7200, 'Time spent cannot exceed exam duration')
        .optional()
        .default(0)
}).strict();

/**
 * Schema for submitting exam answers
 */
export const submitExamSchema = z.object({
    answers: z
        .array(answerSchema)
        .min(1, 'At least one answer is required')
        .refine(
            (answers) => {
                const ids = answers.map(a => a.questionId);
                return new Set(ids).size === ids.length;
            },
            'Duplicate question IDs are not allowed'
        )
}).strict();

/**
 * Schema for exam ID path parameter
 */
export const examIdParamSchema = z.object({
    examId: z
        .string()
        .regex(/^\d+$/, 'Exam ID must be a number')
        .transform(Number)
        .refine((val) => val > 0, 'Exam ID must be positive')
}).strict();

/**
 * Schema for exam history query parameters
 */
export const historyQuerySchema = z.object({
    page: z
        .string()
        .regex(/^\d+$/, 'Page must be a number')
        .transform(Number)
        .refine((val) => val >= 1, 'Page must be at least 1')
        .optional(),

    limit: z
        .string()
        .regex(/^\d+$/, 'Limit must be a number')
        .transform(Number)
        .refine((val) => val >= 1 && val <= PAGINATION.MAX_LIMIT, `Limit must be between 1 and ${PAGINATION.MAX_LIMIT}`)
        .optional(),

    examType: z
        .enum([EXAM_TYPES.REAL_PAST_QUESTION, EXAM_TYPES.PRACTICE, EXAM_TYPES.ONE_V_ONE_DUEL, EXAM_TYPES.GROUP_COLLAB])
        .optional(),

    status: z
        .enum([EXAM_STATUS.IN_PROGRESS, EXAM_STATUS.COMPLETED, EXAM_STATUS.ABANDONED])
        .optional()
}).strict();

// ============================================
// TYPE EXPORTS (inferred from schemas)
// ============================================

export type StartExamInput = z.infer<typeof startExamSchema>;
export type AnswerInput = z.infer<typeof answerSchema>;
export type SubmitExamInput = z.infer<typeof submitExamSchema>;
export type ExamIdParam = z.infer<typeof examIdParamSchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

// ============================================
// VALIDATION HELPERS
// ============================================

/**
 * Safe parse with formatted error messages
 */
export function validateStartExam(data: unknown) {
    return startExamSchema.safeParse(data);
}

export function validateSubmitExam(data: unknown) {
    return submitExamSchema.safeParse(data);
}

export function validateExamId(params: unknown) {
    return examIdParamSchema.safeParse(params);
}

export function validateHistoryQuery(query: unknown) {
    return historyQuerySchema.safeParse(query);
}

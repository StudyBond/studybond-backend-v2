import { z } from 'zod';
import { SUBJECTS, EXAM_TYPES, EXAM_STATUS, PAGINATION } from './exams.constants';
import { optionalInstitutionCodeSchema } from '../../shared/institutions/schema';

const answerOptions = ['A', 'B', 'C', 'D', 'E'] as const;

const subjectValidator = z.enum(SUBJECTS, {
    errorMap: () => ({ message: `Invalid subject. Must be one of: ${SUBJECTS.join(', ')}` })
} as any);

const examTypeValidator = z.enum(
    [EXAM_TYPES.REAL_PAST_QUESTION, EXAM_TYPES.PRACTICE, EXAM_TYPES.MIXED, EXAM_TYPES.DAILY_CHALLENGE] as const,
    {
        errorMap: () => ({ message: 'Invalid exam type. Must be REAL_PAST_QUESTION, PRACTICE, MIXED, or DAILY_CHALLENGE' })
    } as any
);

export const startExamSchema = z.object({
    institutionCode: optionalInstitutionCodeSchema,
    examType: examTypeValidator.optional(),

    subjects: z
        .array(subjectValidator)
        .min(1, 'At least one subject is required')
        .max(4, 'Maximum 4 subjects allowed')
        .refine(
            (subjects) => new Set(subjects).size === subjects.length,
            'Duplicate subjects are not allowed'
        )
}).strict().superRefine((data, ctx) => {
    // English is mandatory only for full exams (4-subject mode), regardless of exam type.
    const isFullExam = data.subjects.length === 4;
    if (isFullExam && !data.subjects.includes('English')) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'English Language is mandatory for full exams.',
            path: ['subjects']
        });
    }

    if (isFullExam && data.examType === EXAM_TYPES.MIXED) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Full exams must be either REAL_PAST_QUESTION or PRACTICE. Mixed mode is only available for 1-3 subject solo exams.',
            path: ['examType']
        });
    }
});

export const startDailyChallengeSchema = z.object({
    subjects: z
        .array(subjectValidator)
        .length(4, 'Exactly 4 subjects are required for the daily challenge')
        .refine(
            (subjects) => new Set(subjects).size === subjects.length,
            'Duplicate subjects are not allowed'
        )
}).strict();


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
        .max(5400, 'Time spent cannot exceed exam duration')
        .optional()
        .default(0)
}).strict();


export const submitExamSchema = z.object({
    answers: z
        .array(answerSchema)
        .refine(
            (answers) => {
                const ids = answers.map(a => a.questionId);
                return new Set(ids).size === ids.length;
            },
            'Duplicate question IDs are not allowed'
        )
}).strict();

/* Schema for exam ID path parameter */
export const examIdParamSchema = z.object({
    examId: z
        .coerce
        .number()
        .int('Exam ID must be an integer')
        .positive('Exam ID must be positive')
}).strict();

/* Schema for exam history query parameters */
export const historyQuerySchema = z.object({
    institutionCode: optionalInstitutionCodeSchema,
    page: z
        .coerce
        .number()
        .int('Page must be an integer')
        .refine((val) => val >= 1, 'Page must be at least 1')
        .optional(),

    limit: z
        .coerce
        .number()
        .int('Limit must be an integer')
        .refine((val) => val >= 1 && val <= PAGINATION.MAX_LIMIT, `Limit must be between 1 and ${PAGINATION.MAX_LIMIT}`)
        .optional(),

    examType: z
        .enum([EXAM_TYPES.REAL_PAST_QUESTION, EXAM_TYPES.PRACTICE, EXAM_TYPES.MIXED, EXAM_TYPES.ONE_V_ONE_DUEL, EXAM_TYPES.GROUP_COLLAB, EXAM_TYPES.DAILY_CHALLENGE])
        .optional(),

    status: z
        .enum([EXAM_STATUS.IN_PROGRESS, EXAM_STATUS.COMPLETED, EXAM_STATUS.ABANDONED])
        .optional()
}).strict();

// TYPE EXPORTS (inferred from schemas)

export const reportViolationSchema = z.object({
    violationType: z.enum(['tab_switch', 'screenshot', 'copy_paste', 'right_click', 'devtools']),
    metadata: z.record(z.string(), z.any()).optional()
}).strict();

export type StartExamInput = z.infer<typeof startExamSchema>;
export type StartDailyChallengeInput = z.infer<typeof startDailyChallengeSchema>;
export type AnswerInput = z.infer<typeof answerSchema>;
export type SubmitExamInput = z.infer<typeof submitExamSchema>;
export type ExamIdParam = z.infer<typeof examIdParamSchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
export type ReportViolationInput = z.infer<typeof reportViolationSchema>;

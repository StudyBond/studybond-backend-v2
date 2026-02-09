
// ============================================
// QUESTIONS MODULE SCHEMAS
// ============================================
// Zod schemas for request validation

import { z } from 'zod';

export const createQuestionSchema = z.object({
    questionText: z.string().min(1, 'Question text is required'),
    hasImage: z.boolean().optional().default(false),
    imageUrl: z.string().url().nullable().optional(),

    // Options (A-D required, E optional)
    optionA: z.string().min(1, 'Option A is required'),
    optionB: z.string().min(1, 'Option B is required'),
    optionC: z.string().min(1, 'Option C is required'),
    optionD: z.string().min(1, 'Option D is required'),
    optionE: z.string().nullable().optional(),

    // Option Images
    optionAImageUrl: z.string().url().nullable().optional(),
    optionBImageUrl: z.string().url().nullable().optional(),
    optionCImageUrl: z.string().url().nullable().optional(),
    optionDImageUrl: z.string().url().nullable().optional(),
    optionEImageUrl: z.string().url().nullable().optional(),

    // Correct Answer
    correctAnswer: z.enum(['A', 'B', 'C', 'D', 'E'], {
        message: 'Correct answer must be A, B, C, D, or E'
    }),

    // Classification
    subject: z.string().min(1, 'Subject is required'),
    topic: z.string().nullable().optional(),
    difficultyLevel: z.string().nullable().optional(),
    questionType: z.string().min(1, 'Question type is required').default('REAL_PAST_QUESTION'),

    // Parent Question
    parentQuestionId: z.number().int().positive().nullable().optional(),

    // Explanation
    explanationText: z.string().nullable().optional(),
    explanationImageUrl: z.string().url().nullable().optional(),
    additionalNotes: z.string().nullable().optional(),
});

export const updateQuestionSchema = createQuestionSchema.partial();

export const questionFilterSchema = z.object({
    subject: z.string().optional(),
    topic: z.string().optional(),
    questionType: z.string().optional(),
    search: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    hasImage: z.coerce.boolean().optional(),
    isAiGenerated: z.coerce.boolean().optional(),
});

export const questionIdParamSchema = z.object({
    id: z.coerce.number().int().positive()
});

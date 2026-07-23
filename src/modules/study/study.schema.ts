import { z } from 'zod';
import { SUBJECTS } from '../exams/exams.constants';
import { optionalInstitutionCodeSchema } from '../../shared/institutions/schema';

const subjectValidator = z.enum(SUBJECTS, {
    errorMap: () => ({ message: `Invalid subject. Must be one of: ${SUBJECTS.join(', ')}` })
} as any);

/** POST /study/start — start a new study session */
export const startStudySessionSchema = z.object({
    institutionCode: optionalInstitutionCodeSchema,
    subjects: z
        .array(subjectValidator)
        .min(1, 'At least one subject is required')
        .max(5, 'Maximum 5 subjects allowed for study mode')
        .refine(
            (subjects) => new Set(subjects).size === subjects.length,
            'Duplicate subjects are not allowed'
        ),
    mode: z.enum(['random', 'topic']).optional().default('random'),
    selectedTopics: z.array(z.string()).optional().default([]),
    limit: z.number().int().min(1).max(500).optional()
}).strict();

/** GET /study/topics — fetch available topics tree */
export const getTopicsQuerySchema = z.object({
    institutionCode: optionalInstitutionCodeSchema,
    subjects: z.string().optional() // Comma-separated subject list
}).passthrough();

/** POST /study/:examId/complete — mark a study session as complete */
export const completeStudySessionSchema = z.object({
    correctCount: z.number().int().min(0),
    wrongCount: z.number().int().min(0),
    revealedCount: z.number().int().min(0),
    skippedCount: z.number().int().min(0),
    bestStreak: z.number().int().min(0),
    timeSpentSeconds: z.number().int().min(0).max(86400, 'Time spent cannot exceed 24 hours'),
    subjectMastery: z.array(z.object({
        subject: z.string(),
        correct: z.number().int().min(0),
        total: z.number().int().min(0),
    })).optional().default([]),
}).strict();

/** Path param for study session */
export const studyIdParamSchema = z.object({
    examId: z
        .coerce
        .number()
        .int('Study session ID must be an integer')
        .positive('Study session ID must be positive')
}).strict();

// Type exports
export type StartStudySessionInput = z.infer<typeof startStudySessionSchema>;
export type CompleteStudySessionInput = z.infer<typeof completeStudySessionSchema>;
export type StudyIdParam = z.infer<typeof studyIdParamSchema>;

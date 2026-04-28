import { z } from 'zod';
import { isoDateTimeSchema, paginationSchema } from '../../shared/openapi/responses';

export const examQuestionSchema = z.object({
  id: z.number().int().positive(),
  questionText: z.string(),
  hasImage: z.boolean(),
  imageUrl: z.string().nullable(),
  optionA: z.string(),
  optionB: z.string(),
  optionC: z.string(),
  optionD: z.string(),
  optionE: z.string().nullable(),
  optionAImageUrl: z.string().nullable(),
  optionBImageUrl: z.string().nullable(),
  optionCImageUrl: z.string().nullable(),
  optionDImageUrl: z.string().nullable(),
  optionEImageUrl: z.string().nullable(),
  parentQuestionText: z.string().nullable(),
  parentQuestionImageUrl: z.string().nullable(),
  subject: z.string(),
  topic: z.string().nullable()
}).strict();

export const examSessionPayloadSchema = z.object({
  examId: z.number().int().positive(),
  examType: z.string(),
  subjects: z.array(z.string()),
  sessionNumber: z.number().int().positive(),
  displayNameLong: z.string(),
  displayNameShort: z.string(),
  totalQuestions: z.number().int().positive(),
  timeAllowedSeconds: z.number().int().positive(),
  startedAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
  questions: z.array(examQuestionSchema)
}).strict();

export const examQuestionWithAnswerSchema = examQuestionSchema.extend({
  correctAnswer: z.string(),
  userAnswer: z.string().nullable(),
  isCorrect: z.boolean(),
  timeSpentSeconds: z.number().int().nullable(),
  explanation: z.object({
    text: z.string(),
    imageUrl: z.string().nullable(),
    additionalNotes: z.string().nullable()
  }).nullable().optional()
});

export const examResultPayloadSchema = z.object({
  examId: z.number().int().positive(),
  examType: z.string(),
  subjects: z.array(z.string()),
  sessionNumber: z.number().int().positive(),
  displayNameLong: z.string(),
  displayNameShort: z.string(),
  totalQuestions: z.number().int().positive(),
  score: z.number().int().nonnegative(),
  percentage: z.number(),
  spEarned: z.number().int(),
  spMultiplier: z.number(),
  timeTakenSeconds: z.number().int().nonnegative(),
  isRetake: z.boolean(),
  attemptNumber: z.number().int().positive(),
  startedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema,
  questions: z.array(examQuestionWithAnswerSchema),
  stats: z.object({
    totalSp: z.number().int(),
    weeklySp: z.number().int(),
    currentStreak: z.number().int()
  }).strict()
}).strict();

export const examSummarySchema = z.object({
  id: z.number().int().positive(),
  examType: z.string(),
  subjects: z.array(z.string()),
  sessionNumber: z.number().int().positive(),
  displayNameLong: z.string(),
  displayNameShort: z.string(),
  totalQuestions: z.number().int().positive(),
  score: z.number().int().nonnegative(),
  percentage: z.number(),
  spEarned: z.number().int(),
  status: z.string(),
  isRetake: z.boolean(),
  attemptNumber: z.number().int().positive(),
  retakesRemaining: z.number().int().nonnegative(),
  startedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
  timeTakenSeconds: z.number().int().nullable()
}).strict();

export const examHistoryPayloadSchema = z.object({
  exams: z.array(examSummarySchema),
  pagination: paginationSchema,
  stats: z.object({
    totalExams: z.number().int().nonnegative(),
    averageScore: z.number(),
    totalSpEarned: z.number().int().nonnegative(),
    bestScore: z.number()
  }).strict()
}).strict();

export const examAbandonPayloadSchema = z.object({
  examId: z.number().int().positive(),
  status: z.string(),
  message: z.string()
}).passthrough();

export const examEligibilityPayloadSchema = z.object({
  canTakeExam: z.boolean(),
  reason: z.string().optional(),
  errorCode: z.string().optional(),
  creditsUsed: z.number().int().optional(),
  creditsRemaining: z.number().int().optional(),
  requestedCredits: z.number().int().optional()
}).strict();

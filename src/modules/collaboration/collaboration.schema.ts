import { z } from 'zod';
import { SUBJECTS } from '../exams/exams.constants';
import { COLLAB_QUESTION_SOURCE } from './collaboration.constants';
import { optionalInstitutionCodeSchema } from '../../shared/institutions/schema';

const subjectValidator = z.enum(SUBJECTS, {
  errorMap: () => ({ message: `Invalid subject. Must be one of: ${SUBJECTS.join(', ')}` })
} as any);

export const idempotencyHeadersSchema = z.object({
  'idempotency-key': z.string().trim().min(8, 'Idempotency-Key must be at least 8 characters').optional()
}).passthrough();

export const createSessionBodySchema = z.object({
  sessionType: z.literal('ONE_V_ONE_DUEL').default('ONE_V_ONE_DUEL'),
  institutionCode: optionalInstitutionCodeSchema,
  subjects: z
    .array(subjectValidator)
    .min(1, 'At least one subject is required')
    .max(4, 'Maximum 4 subjects allowed')
    .refine((subjects) => new Set(subjects).size === subjects.length, 'Duplicate subjects are not allowed'),
  questionSource: z
    .enum([
      COLLAB_QUESTION_SOURCE.REAL_PAST_QUESTION,
      COLLAB_QUESTION_SOURCE.PRACTICE,
      COLLAB_QUESTION_SOURCE.MIXED
    ] as const)
    .optional(),
  maxParticipants: z.literal(2).optional(),
  customName: z.string().trim().min(3, 'Custom name must be at least 3 characters').max(80).optional()
}).strict().superRefine((data, ctx) => {
  if (data.subjects.length === 4 && !data.subjects.includes('English')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'English Language is mandatory for full collaboration exams.',
      path: ['subjects']
    });
  }
});

export const codeParamSchema = z.object({
  code: z.string().trim().min(4).max(32).transform((value) => value.toUpperCase())
}).strict();

export const sessionIdParamSchema = z.object({
  sessionId: z.coerce.number().int().positive()
}).strict();

export const updateSessionNameBodySchema = z.object({
  customName: z.string().trim().min(3, 'Custom name must be at least 3 characters').max(80).nullable()
}).strict();

export const wsAuthQuerySchema = z.object({
  token: z.string().trim().min(10).optional()
}).strict();

const readyMessageSchema = z.object({
  type: z.literal('ready'),
  eventId: z.string().trim().min(8).max(80).optional(),
  payload: z.object({}).passthrough().optional()
}).strict();

const heartbeatMessageSchema = z.object({
  type: z.literal('heartbeat'),
  eventId: z.string().trim().min(8).max(80).optional(),
  payload: z.object({}).passthrough().optional()
}).strict();

const progressMessageSchema = z.object({
  type: z.literal('progress_update'),
  eventId: z.string().trim().min(8).max(80),
  payload: z.object({
    currentQuestion: z.number().int().min(1),
    totalQuestions: z.number().int().min(1),
    elapsedSeconds: z.number().int().min(0).optional()
  }).strict()
}).strict();

const timeAlertMessageSchema = z.object({
  type: z.literal('time_alert'),
  eventId: z.string().trim().min(8).max(80),
  payload: z.object({
    questionId: z.number().int().positive(),
    elapsedSeconds: z.number().int().min(0)
  }).strict()
}).strict();

const emojiMessageSchema = z.object({
  type: z.literal('emoji_reaction'),
  eventId: z.string().trim().min(8).max(80),
  payload: z.object({
    emoji: z.string().trim().min(1).max(6)
  }).strict()
}).strict();

const finishedMessageSchema = z.object({
  type: z.literal('finished'),
  eventId: z.string().trim().min(8).max(80),
  payload: z.object({
    examId: z.number().int().positive()
  }).strict()
}).strict();

export const wsClientEventSchema = z.union([
  readyMessageSchema,
  heartbeatMessageSchema,
  progressMessageSchema,
  timeAlertMessageSchema,
  emojiMessageSchema,
  finishedMessageSchema
]);

export type CreateSessionBodyInput = z.infer<typeof createSessionBodySchema>;
export type CodeParamInput = z.infer<typeof codeParamSchema>;
export type SessionIdParamInput = z.infer<typeof sessionIdParamSchema>;
export type UpdateSessionNameBodyInput = z.infer<typeof updateSessionNameBodySchema>;
export type WsClientEventInput = z.infer<typeof wsClientEventSchema>;

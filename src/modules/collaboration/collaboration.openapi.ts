import { z } from 'zod';
import { isoDateTimeSchema } from '../../shared/openapi/responses';

const collaborationSessionTypeSchema = z.enum(['ONE_V_ONE_DUEL']);
const collaborationStatusSchema = z.enum(['WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
const participantStateSchema = z.enum(['JOINED', 'READY', 'DISCONNECTED', 'FINISHED']);
const collaborationQuestionSourceSchema = z.enum(['REAL_PAST_QUESTION', 'PRACTICE', 'MIXED']);

export const collaborationParticipantSchema = z.object({
  userId: z.number().int().positive(),
  fullName: z.string(),
  participantState: participantStateSchema,
  joinedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.nullable(),
  score: z.number().int().nullable(),
  spEarned: z.number().int().nullable(),
  finalRank: z.number().int().nullable()
}).strict();

export const collaborationSessionViewSchema = z.object({
  id: z.number().int().positive(),
  code: z.string(),
  sessionType: collaborationSessionTypeSchema,
  status: collaborationStatusSchema,
  sessionNumber: z.number().int().positive(),
  displayNameLong: z.string(),
  displayNameShort: z.string(),
  customName: z.string().nullable(),
  effectiveDisplayName: z.string(),
  questionSource: collaborationQuestionSourceSchema,
  subjects: z.array(z.string()),
  totalQuestions: z.number().int().positive(),
  maxParticipants: z.number().int().positive(),
  hostUserId: z.number().int().positive(),
  startedAt: isoDateTimeSchema.nullable(),
  endedAt: isoDateTimeSchema.nullable(),
  participants: z.array(collaborationParticipantSchema)
}).strict();

export const collaborationSessionSnapshotSchema = z.object({
  session: collaborationSessionViewSchema,
  myExamId: z.number().int().positive().nullable().optional()
}).strict();

export const collaborationQuestionSchema = z.object({
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

export const collaborationExamAssignmentSchema = z.object({
  userId: z.number().int().positive(),
  examId: z.number().int().positive()
}).strict();

export const collaborationStartSessionSchema = collaborationSessionSnapshotSchema.extend({
  questions: z.array(collaborationQuestionSchema),
  examAssignments: z.array(collaborationExamAssignmentSchema),
  timeAllowedSeconds: z.number().int().positive(),
  startedAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema
}).strict();

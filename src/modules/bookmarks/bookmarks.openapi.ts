import { z } from 'zod';
import { isoDateTimeSchema, paginationSchema } from '../../shared/openapi/responses';

export const bookmarkQuestionSchema = z.object({
  id: z.number().int().positive(),
  questionText: z.string(),
  subject: z.string(),
  topic: z.string().nullable(),
  hasImage: z.boolean(),
  imageUrl: z.string().nullable()
}).strict();

export const bookmarkSchema = z.object({
  id: z.number().int().positive(),
  questionId: z.number().int().positive(),
  examId: z.number().int().positive().nullable(),
  notes: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema.nullable(),
  question: bookmarkQuestionSchema
}).strict();

export const bookmarkQuestionFullSchema = bookmarkQuestionSchema.extend({
  optionA: z.string().nullable(),
  optionAImageUrl: z.string().nullable(),
  optionB: z.string().nullable(),
  optionBImageUrl: z.string().nullable(),
  optionC: z.string().nullable(),
  optionCImageUrl: z.string().nullable(),
  optionD: z.string().nullable(),
  optionDImageUrl: z.string().nullable(),
  optionE: z.string().nullable(),
  optionEImageUrl: z.string().nullable(),
  correctAnswer: z.string(),
  parentQuestionText: z.string().nullable(),
  explanation: z.object({
    text: z.string(),
    imageUrl: z.string().nullable(),
    additionalNotes: z.string().nullable()
  }).nullable()
}).strict();

export const bookmarkFullSchema = bookmarkSchema.extend({
  question: bookmarkQuestionFullSchema
}).strict();

export const bookmarksListPayloadSchema = z.object({
  bookmarks: z.array(bookmarkSchema),
  pagination: paginationSchema,
  limits: z.object({
    activeBookmarks: z.number().int().nonnegative(),
    maxBookmarks: z.number().int().positive(),
    remainingBookmarks: z.number().int().nonnegative(),
    expiryDays: z.number().int().positive(),
    accessTier: z.enum(['FREE', 'PREMIUM'])
  }).strict()
}).strict();

export const bookmarkDeletedPayloadSchema = z.object({
  success: z.literal(true),
  message: z.string()
}).strict();

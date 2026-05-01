import { z } from 'zod';
import { isoDateTimeSchema, paginationSchema } from '../../shared/openapi/responses';

export const questionResponseSchema = z.object({
  id: z.number().int().positive(),
  institutionId: z.number().int().positive().nullable(),
  institutionCode: z.string().nullable(),
  questionText: z.string(),
  hasImage: z.boolean(),
  imageUrl: z.string().nullable(),
  imagePublicId: z.string().nullable(),
  optionA: z.string(),
  optionB: z.string(),
  optionC: z.string(),
  optionD: z.string(),
  optionE: z.string().nullable(),
  optionAImageUrl: z.string().nullable(),
  optionAImagePublicId: z.string().nullable(),
  optionBImageUrl: z.string().nullable(),
  optionBImagePublicId: z.string().nullable(),
  optionCImageUrl: z.string().nullable(),
  optionCImagePublicId: z.string().nullable(),
  optionDImageUrl: z.string().nullable(),
  optionDImagePublicId: z.string().nullable(),
  optionEImageUrl: z.string().nullable(),
  optionEImagePublicId: z.string().nullable(),
  correctAnswer: z.string(),
  subject: z.string(),
  topic: z.string().nullable(),
  difficultyLevel: z.string().nullable(),
  questionType: z.string(),
  questionPool: z.string(),
  isAiGenerated: z.boolean(),
  isFeaturedFree: z.boolean(),
  year: z.number().int().nullable(),
  parentQuestionId: z.number().int().positive().nullable(),
  parentQuestion: z.object({
    id: z.number().int().positive(),
    questionText: z.string(),
    imageUrl: z.string().nullable()
  }).nullable().optional(),
  explanation: z.object({
    explanationText: z.string(),
    explanationImageUrl: z.string().nullable(),
    explanationImagePublicId: z.string().nullable(),
    additionalNotes: z.string().nullable()
  }).nullable().optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
}).passthrough();

export const questionAssetUploadResponseSchema = z.object({
  provider: z.literal('CLOUDINARY'),
  kind: z.string(),
  url: z.string().url(),
  publicId: z.string(),
  bytes: z.number().int().nonnegative().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  format: z.string().nullable(),
  originalFilename: z.string().nullable()
}).strict();

export const questionListResponseSchema = z.object({
  questions: z.array(questionResponseSchema),
  meta: paginationSchema
}).strict();

export const bulkUploadRowErrorSchema = z.object({
  row: z.number().int().positive(),
  field: z.string(),
  message: z.string()
}).passthrough();

export const bulkUploadResponseSchema = z.object({
  success: z.boolean(),
  totalRows: z.number().int().nonnegative(),
  successCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  errors: z.array(bulkUploadRowErrorSchema),
  createdIds: z.array(z.number().int().positive()),
  batchId: z.number().int().positive().nullable()
}).passthrough();

// ── Batch history ──────────────────────────────────────

export const bulkUploadBatchSchema = z.object({
  id: z.number().int().positive(),
  institutionId: z.number().int().positive(),
  institutionCode: z.string(),
  uploadedById: z.number().int().positive(),
  uploaderName: z.string(),
  fileName: z.string(),
  fileHash: z.string(),
  totalRows: z.number().int().nonnegative(),
  successCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  questionCount: z.number().int().nonnegative(),
  status: z.string(),
  createdAt: z.string()
}).passthrough();

export const bulkUploadHistoryResponseSchema = z.object({
  batches: z.array(bulkUploadBatchSchema),
  total: z.number().int().nonnegative()
}).strict();

// ── Duplicate check ────────────────────────────────────

export const bulkUploadDuplicateCheckResponseSchema = z.object({
  isDuplicate: z.boolean(),
  existingBatch: bulkUploadBatchSchema.nullable()
}).strict();

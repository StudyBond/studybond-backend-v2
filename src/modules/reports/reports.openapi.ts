import { z } from 'zod';
import { isoDateTimeSchema, paginationSchema } from '../../shared/openapi/responses';

export const reportQuestionSchema = z.object({
  id: z.number().int().positive(),
  questionText: z.string(),
  subject: z.string(),
  topic: z.string().nullable(),
  questionType: z.string(),
  questionPool: z.string(),
  hasImage: z.boolean(),
  imageUrl: z.string().nullable()
}).strict();

export const reportReporterSchema = z.object({
  id: z.number().int().positive(),
  email: z.email(),
  fullName: z.string()
}).strict();

export const userReportSchema = z.object({
  id: z.number().int().positive(),
  questionId: z.number().int().positive(),
  issueType: z.string(),
  description: z.string().nullable(),
  status: z.enum(['PENDING', 'REVIEWED', 'RESOLVED']),
  adminNote: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  reviewedAt: isoDateTimeSchema.nullable(),
  resolvedAt: isoDateTimeSchema.nullable(),
  question: reportQuestionSchema
}).strict();

export const adminReportSchema = z.object({
  id: z.number().int().positive(),
  issueType: z.string(),
  description: z.string().nullable(),
  status: z.enum(['PENDING', 'REVIEWED', 'RESOLVED']),
  adminNote: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  reviewedAt: isoDateTimeSchema.nullable(),
  resolvedAt: isoDateTimeSchema.nullable(),
  reporter: reportReporterSchema,
  question: reportQuestionSchema,
  reviewedByAdmin: reportReporterSchema.nullable(),
  resolvedByAdmin: reportReporterSchema.nullable()
}).strict();

export const userReportsListPayloadSchema = z.object({
  reports: z.array(userReportSchema),
  pagination: paginationSchema
}).strict();

export const adminReportsListPayloadSchema = z.object({
  reports: z.array(adminReportSchema),
  pagination: paginationSchema,
  summary: z.object({
    pending: z.number().int().nonnegative(),
    reviewed: z.number().int().nonnegative(),
    resolved: z.number().int().nonnegative(),
    totalTracked: z.number().int().nonnegative()
  }).strict()
}).strict();

export const reportDeletedPayloadSchema = z.object({
  success: z.literal(true),
  message: z.string()
}).strict();

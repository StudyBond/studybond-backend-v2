import { z } from 'zod';

export const REPORT_LIMITS = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100
} as const;

export const reportIssueTypeSchema = z.enum([
  'WRONG_ANSWER',
  'TYPO',
  'AMBIGUOUS',
  'IMAGE_MISSING',
  'OTHER'
]);

export const reportStatusSchema = z.enum([
  'PENDING',
  'REVIEWED',
  'RESOLVED'
]);

const optionalDescriptionSchema = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}, z.union([
  z.string().min(5, 'Description must be at least 5 characters.').max(2000, 'Description is too long.'),
  z.null()
]));

const requiredAdminNoteSchema = z.string()
  .trim()
  .min(5, 'Admin note must be at least 5 characters.')
  .max(2000, 'Admin note is too long.');

export const createReportSchema = z.object({
  questionId: z.coerce.number().int().positive('Question id must be a positive integer.'),
  issueType: reportIssueTypeSchema,
  description: optionalDescriptionSchema.optional()
}).strict().superRefine((input, ctx) => {
  if (input.issueType === 'OTHER' && !input.description) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['description'],
      message: 'Please describe the issue when you choose OTHER.'
    });
  }
});

export const reportQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(REPORT_LIMITS.DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(REPORT_LIMITS.MAX_PAGE_SIZE).default(REPORT_LIMITS.DEFAULT_PAGE_SIZE),
  status: reportStatusSchema.optional()
}).strict();

export const reportIdParamSchema = z.object({
  reportId: z.coerce.number().int().positive('Report id must be a positive integer.')
}).strict();

export const adminReportQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(REPORT_LIMITS.DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(REPORT_LIMITS.MAX_PAGE_SIZE).default(REPORT_LIMITS.DEFAULT_PAGE_SIZE),
  status: reportStatusSchema.optional(),
  issueType: reportIssueTypeSchema.optional(),
  subject: z.string().trim().min(1).max(80).optional(),
  questionId: z.coerce.number().int().positive('Question id must be a positive integer.').optional(),
  userId: z.coerce.number().int().positive('User id must be a positive integer.').optional()
}).strict();

export const updateReportStatusSchema = z.object({
  status: z.enum(['REVIEWED', 'RESOLVED']),
  adminNote: requiredAdminNoteSchema
}).strict();

export const hardDeleteReportSchema = z.object({
  reason: requiredAdminNoteSchema.max(500, 'Deletion reason is too long.')
}).strict();

export type CreateReportInput = z.infer<typeof createReportSchema>;
export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type AdminReportQuery = z.infer<typeof adminReportQuerySchema>;
export type UpdateReportStatusInput = z.infer<typeof updateReportStatusSchema>;
export type HardDeleteReportInput = z.infer<typeof hardDeleteReportSchema>;

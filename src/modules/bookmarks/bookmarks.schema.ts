import { z } from 'zod';

const normalizedNotesSchema = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}, z.union([
  z.string().min(1, 'Bookmark notes cannot be empty.').max(2000, 'Bookmark notes are too long.'),
  z.null()
]));

export const BOOKMARK_LIMITS = {
  FREE_USER_MAX_BOOKMARKS: 20,
  PREMIUM_USER_MAX_BOOKMARKS: 50,
  EXPIRY_DAYS: 30,
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 50,
  TX_MAX_WAIT_MS: 8000,
  TX_TIMEOUT_MS: 15000
} as const;

export const createBookmarkSchema = z.object({
  questionId: z.coerce.number().int().positive('Question id must be a positive integer.'),
  examId: z.coerce.number().int().positive('Exam id must be a positive integer.').optional(),
  notes: normalizedNotesSchema.optional()
}).strict();

export const updateBookmarkSchema = z.object({
  notes: normalizedNotesSchema
}).strict();

export const bookmarkQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(BOOKMARK_LIMITS.DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(BOOKMARK_LIMITS.MAX_PAGE_SIZE).default(BOOKMARK_LIMITS.DEFAULT_PAGE_SIZE),
  subject: z.string().trim().min(1).max(80).optional()
}).strict();

export const bookmarkIdParamSchema = z.object({
  bookmarkId: z.coerce.number().int().positive('Bookmark id must be a positive integer.')
}).strict();

export type CreateBookmarkInput = z.infer<typeof createBookmarkSchema>;
export type UpdateBookmarkInput = z.infer<typeof updateBookmarkSchema>;
export type BookmarkListQuery = z.infer<typeof bookmarkQuerySchema>;

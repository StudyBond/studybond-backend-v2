import { z } from 'zod';

export const startBookmarkExamSchema = z.object({
  subject: z.string().trim().min(1).max(80).optional()
}).strict();

export type StartBookmarkExamInput = z.infer<typeof startBookmarkExamSchema>;

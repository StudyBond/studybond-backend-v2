import { z } from 'zod';
import { institutionScopeQuerySchema } from '../../shared/institutions/query';

export const leaderboardQuerySchema = institutionScopeQuerySchema.extend({
  limit: z.coerce
    .number()
    .int('limit must be an integer')
    .min(1, 'limit must be at least 1')
    .max(50, 'limit cannot exceed 50')
    .optional()
}).strict();

export type LeaderboardQueryInput = z.infer<typeof leaderboardQuerySchema>;

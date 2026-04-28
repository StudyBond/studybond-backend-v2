import { z } from 'zod';
import { isoDateTimeSchema } from '../../shared/openapi/responses';

export const leaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  userId: z.number().int().positive(),
  fullName: z.string(),
  points: z.number().int(),
  weeklySp: z.number().int(),
  totalSp: z.number().int(),
  isCurrentUser: z.boolean()
}).strict();

export const leaderboardInstitutionSchema = z.object({
  id: z.number().int().positive(),
  code: z.string(),
  name: z.string(),
  slug: z.string()
}).strict();

export const leaderboardPayloadSchema = z.object({
  type: z.enum(['WEEKLY', 'ALL_TIME']),
  institution: leaderboardInstitutionSchema,
  limit: z.number().int().positive(),
  generatedAt: isoDateTimeSchema,
  totalParticipants: z.number().int().nonnegative(),
  entries: z.array(leaderboardEntrySchema)
}).strict();

export const myRankPayloadSchema = z.object({
  institution: leaderboardInstitutionSchema,
  user: z.object({
    id: z.number().int().positive(),
    fullName: z.string(),
    weeklySp: z.number().int(),
    totalSp: z.number().int()
  }).strict(),
  weekly: z.object({
    rank: z.number().int().positive().nullable(),
    points: z.number().int(),
    totalParticipants: z.number().int().nonnegative()
  }).strict(),
  allTime: z.object({
    rank: z.number().int().positive().nullable(),
    points: z.number().int(),
    totalParticipants: z.number().int().nonnegative()
  }).strict()
}).strict();

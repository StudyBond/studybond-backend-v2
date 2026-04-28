import { z } from 'zod';
import { isoDateTimeSchema } from '../../shared/openapi/responses';

const institutionContextSchema = z.object({
  id: z.number().int().positive(),
  code: z.string(),
  name: z.string(),
  slug: z.string(),
  source: z.enum(['explicit', 'user_target', 'launch_default'])
}).strict();

export const userProfileSchema = z.object({
  id: z.number().int().positive(),
  email: z.email(),
  fullName: z.string(),
  isVerified: z.boolean(),
  role: z.string(),
  aspiringCourse: z.string().nullable().optional(),
  targetScore: z.number().int().nullable().optional(),
  isPremium: z.boolean(),
  subscriptionEndDate: isoDateTimeSchema.nullable().optional(),
  deviceAccessMode: z.enum(['FREE', 'PREMIUM']).optional(),
  emailUnsubscribed: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
}).passthrough();

export const userStatsSchema = z.object({
  institution: institutionContextSchema,
  totalSp: z.number().int(),
  weeklySp: z.number().int(),
  currentStreak: z.number().int(),
  longestStreak: z.number().int(),
  streakFreezesAvailable: z.number().int(),
  realExamsCompleted: z.number().int(),
  completedCollaborationExams: z.number().int(),
  hasTakenFreeExam: z.boolean(),
  aiExplanationsUsedToday: z.number().int(),
  isPremium: z.boolean(),
  deviceAccessMode: z.enum(['FREE', 'PREMIUM']),
  completedExams: z.number().int(),
  abandonedExams: z.number().int(),
  inProgressExams: z.number().int(),
  bookmarkedQuestions: z.number().int(),
  activeSessions: z.number().int(),
  registeredPremiumDevices: z.number().int()
}).passthrough();

export const userAchievementSchema = z.object({
  key: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  unlocked: z.boolean().optional(),
  unlockedAt: isoDateTimeSchema.nullable().optional(),
  progress: z.object({
    current: z.number(),
    target: z.number(),
    percentage: z.number()
  }).optional()
}).passthrough();

export const securityOverviewSchema = z.object({
  deviceAccessMode: z.enum(['FREE', 'PREMIUM']),
  currentSessionId: z.string(),
  currentDeviceId: z.string(),
  activeSessions: z.array(z.object({
    sessionId: z.string(),
    deviceId: z.string(),
    deviceName: z.string().nullable(),
    userAgent: z.string().nullable(),
    createdAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema.nullable(),
    lastLoginAt: isoDateTimeSchema.nullable(),
    isCurrent: z.boolean(),
    isRegisteredPremiumDevice: z.boolean(),
    registrationMethod: z.string().nullable()
  }).strict()),
  registeredPremiumDevices: z.array(z.object({
    deviceId: z.string(),
    deviceName: z.string(),
    userAgent: z.string(),
    createdAt: isoDateTimeSchema,
    verifiedAt: isoDateTimeSchema.nullable(),
    lastLoginAt: isoDateTimeSchema.nullable(),
    isCurrent: z.boolean(),
    isActive: z.boolean(),
    registrationMethod: z.string().nullable()
  }).strict())
}).strict();

export const passwordChangedPayloadSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  changedAt: isoDateTimeSchema,
  invalidatedSessions: z.number().int().nonnegative()
}).strict();

export const accountDeletedPayloadSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  deletedAt: isoDateTimeSchema
}).strict();

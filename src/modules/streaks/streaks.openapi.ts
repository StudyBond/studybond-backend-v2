import { z } from 'zod';
import { isoDateTimeSchema } from '../../shared/openapi/responses';

export const streakMilestoneSchema = z.object({
  days: z.number().int().positive(),
  label: z.string(),
  reward: z.string(),
  achieved: z.boolean(),
  active: z.boolean()
}).strict();

export const streakSummaryPayloadSchema = z.object({
  currentStreak: z.number().int().nonnegative(),
  longestStreak: z.number().int().nonnegative(),
  status: z.string(),
  studiedToday: z.boolean(),
  studiedYesterday: z.boolean(),
  lastActivityDate: z.string().nullable(),
  streakEndsAt: isoDateTimeSchema.nullable(),
  canStillSaveToday: z.boolean(),
  streakFreezesAvailable: z.number().int().nonnegative(),
  freezerProtectionActive: z.boolean(),
  today: z.object({
    examsTaken: z.number().int().nonnegative(),
    spEarnedToday: z.number().int()
  }).strict(),
  nextMilestone: z.object({
    days: z.number().int().positive(),
    label: z.string(),
    reward: z.string(),
    remainingDays: z.number().int().nonnegative()
  }).nullable(),
  milestones: z.array(streakMilestoneSchema),
  reminderState: z.object({
    emailOptedOut: z.boolean(),
    lastReminderDate: z.string().nullable()
  }).strict()
}).strict();

export const streakCalendarDaySchema = z.object({
  date: z.string(),
  studied: z.boolean(),
  examsTaken: z.number().int().nonnegative(),
  spEarnedToday: z.number().int(),
  isToday: z.boolean(),
  isYesterday: z.boolean(),
  isCurrentStreakDay: z.boolean()
}).strict();

export const streakCalendarPayloadSchema = z.object({
  daysRequested: z.number().int().positive(),
  currentStreak: z.number().int().nonnegative(),
  longestStreak: z.number().int().nonnegative(),
  status: z.string(),
  activeDaysInRange: z.number().int().nonnegative(),
  totalSpEarnedInRange: z.number().int(),
  days: z.array(streakCalendarDaySchema)
}).strict();

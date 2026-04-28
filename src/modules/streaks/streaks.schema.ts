import { z } from 'zod';
import { STREAK_CONFIG } from '../../config/constants';

export const streakCalendarQuerySchema = z.object({
  days: z.coerce.number()
    .int('Days must be a whole number.')
    .min(7, 'Calendar range must be at least 7 days.')
    .max(STREAK_CONFIG.CALENDAR_MAX_DAYS, `Calendar range cannot exceed ${STREAK_CONFIG.CALENDAR_MAX_DAYS} days.`)
    .default(STREAK_CONFIG.CALENDAR_DEFAULT_DAYS)
}).strict();

export type StreakCalendarQuery = z.infer<typeof streakCalendarQuerySchema>;

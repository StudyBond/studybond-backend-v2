import { StreakStatus } from '../../shared/streaks/domain';

export interface StreakSummaryResponse {
  currentStreak: number;
  longestStreak: number;
  status: StreakStatus;
  studiedToday: boolean;
  studiedYesterday: boolean;
  lastActivityDate: string | null;
  streakEndsAt: string | null;
  canStillSaveToday: boolean;
  streakFreezesAvailable: number;
  freezerProtectionActive: boolean;
  today: {
    examsTaken: number;
    spEarnedToday: number;
  };
  nextMilestone: {
    days: number;
    label: string;
    reward: string;
    remainingDays: number;
  } | null;
  milestones: Array<{
    days: number;
    label: string;
    reward: string;
    achieved: boolean;
    active: boolean;
  }>;
  reminderState: {
    emailOptedOut: boolean;
    lastReminderDate: string | null;
  };
}

export interface StreakCalendarDay {
  date: string;
  studied: boolean;
  examsTaken: number;
  spEarnedToday: number;
  isToday: boolean;
  isYesterday: boolean;
  isCurrentStreakDay: boolean;
}

export interface StreakCalendarResponse {
  daysRequested: number;
  currentStreak: number;
  longestStreak: number;
  status: StreakStatus;
  activeDaysInRange: number;
  totalSpEarnedInRange: number;
  days: StreakCalendarDay[];
}

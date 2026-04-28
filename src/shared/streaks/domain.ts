export const STREAK_MILESTONES = [
  {
    days: 7,
    label: '7-day streak',
    reward: 'Badge + Streak Freezer'
  },
  {
    days: 30,
    label: '30-day streak',
    reward: 'Consistency milestone'
  }
] as const;

export type StreakStatus = 'INACTIVE' | 'ACTIVE' | 'AT_RISK' | 'BROKEN';

export interface StreakSnapshot {
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
}

export interface NextMilestone {
  days: number;
  label: string;
  reward: string;
  remainingDays: number;
}

export interface MilestoneProgress {
  days: number;
  label: string;
  reward: string;
  achieved: boolean;
  active: boolean;
}

const FIRST_FREEZER_STREAK_DAY = 7;
const FREEZER_RENEWAL_INTERVAL_DAYS = 14;

const LAGOS_DAY_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function shiftToLagos(date: Date): Date {
  return new Date(date.getTime() + LAGOS_DAY_OFFSET_MS);
}

export function getLagosDayStart(date = new Date()): Date {
  const shifted = shiftToLagos(date);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - LAGOS_DAY_OFFSET_MS);
}

export function getLagosDateValue(date = new Date()): Date {
  return new Date(`${getLagosDateKey(date)}T00:00:00.000Z`);
}

export function getLagosDayEnd(date = new Date()): Date {
  const dayStart = getLagosDayStart(date);
  return new Date(dayStart.getTime() + DAY_MS - 1);
}

export function addLagosDays(date: Date, days: number): Date {
  const dayStart = getLagosDayStart(date);
  return new Date(dayStart.getTime() + (days * DAY_MS));
}

export function addLagosDateDays(date: Date, days: number): Date {
  return new Date(date.getTime() + (days * DAY_MS));
}

export function getLagosDateKey(date: Date): string {
  return shiftToLagos(date).toISOString().slice(0, 10);
}

export function getLagosDayDifference(from: Date, to: Date): number {
  const fromDay = getLagosDayStart(from);
  const toDay = getLagosDayStart(to);
  return Math.round((fromDay.getTime() - toDay.getTime()) / DAY_MS);
}

export function deriveStreakSnapshot(
  currentStreak: number,
  longestStreak: number,
  lastActivityDate: Date | null,
  now = new Date(),
  streakFreezesAvailable = 0
): StreakSnapshot {
  const availableFreezes = Math.max(0, streakFreezesAvailable);

  if (!lastActivityDate || currentStreak <= 0) {
    return {
      currentStreak: 0,
      longestStreak,
      status: 'INACTIVE',
      studiedToday: false,
      studiedYesterday: false,
      lastActivityDate: lastActivityDate ? getLagosDateKey(lastActivityDate) : null,
      streakEndsAt: null,
      canStillSaveToday: false,
      streakFreezesAvailable: availableFreezes,
      freezerProtectionActive: false
    };
  }

  const daysSinceLastActivity = getLagosDayDifference(now, lastActivityDate);
  const studiedToday = daysSinceLastActivity === 0;
  const studiedYesterday = daysSinceLastActivity === 1;

  if (studiedToday) {
    return {
      currentStreak,
      longestStreak,
      status: 'ACTIVE',
      studiedToday: true,
      studiedYesterday: false,
      lastActivityDate: getLagosDateKey(lastActivityDate),
      streakEndsAt: getLagosDayEnd(now).toISOString(),
      canStillSaveToday: false,
      streakFreezesAvailable: availableFreezes,
      freezerProtectionActive: false
    };
  }

  if (studiedYesterday) {
    return {
      currentStreak,
      longestStreak,
      status: 'AT_RISK',
      studiedToday: false,
      studiedYesterday: true,
      lastActivityDate: getLagosDateKey(lastActivityDate),
      streakEndsAt: getLagosDayEnd(now).toISOString(),
      canStillSaveToday: true,
      streakFreezesAvailable: availableFreezes,
      freezerProtectionActive: false
    };
  }

  if (daysSinceLastActivity === 2 && availableFreezes > 0) {
    return {
      currentStreak,
      longestStreak,
      status: 'AT_RISK',
      studiedToday: false,
      studiedYesterday: false,
      lastActivityDate: getLagosDateKey(lastActivityDate),
      streakEndsAt: getLagosDayEnd(now).toISOString(),
      canStillSaveToday: true,
      streakFreezesAvailable: availableFreezes,
      freezerProtectionActive: true
    };
  }

  return {
    currentStreak: 0,
    longestStreak,
    status: 'BROKEN',
    studiedToday: false,
    studiedYesterday: false,
    lastActivityDate: getLagosDateKey(lastActivityDate),
    streakEndsAt: null,
    canStillSaveToday: false,
    streakFreezesAvailable: availableFreezes,
    freezerProtectionActive: false
  };
}

export function calculateNextStreakValues(
  currentStreak: number,
  longestStreak: number,
  lastActivityDate: Date | null,
  streakFreezesAvailable = 0,
  now = new Date()
): {
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: Date;
  milestonesUnlocked: number[];
  streakFreezesAvailable: number;
} {
  const previousSnapshot = deriveStreakSnapshot(
    currentStreak,
    longestStreak,
    lastActivityDate,
    now,
    streakFreezesAvailable
  );
  let nextAvailableFreezes = Math.max(0, streakFreezesAvailable);

  let nextCurrentStreak = 1;
  if (previousSnapshot.status === 'ACTIVE') {
    nextCurrentStreak = Math.max(currentStreak, 1);
  } else if (previousSnapshot.status === 'AT_RISK') {
    nextCurrentStreak = Math.max(currentStreak, 1) + 1;
    if (previousSnapshot.freezerProtectionActive && nextAvailableFreezes > 0) {
      nextAvailableFreezes -= 1;
    }
  }

  const nextLongestStreak = Math.max(longestStreak, nextCurrentStreak);
  const milestonesUnlocked = STREAK_MILESTONES
    .filter((milestone) => longestStreak < milestone.days && nextLongestStreak >= milestone.days)
    .map((milestone) => milestone.days);
  const streakProgressedToday = previousSnapshot.status !== 'ACTIVE' || currentStreak <= 0;
  const hitFreezerRenewalCheckpoint = streakProgressedToday
    && nextCurrentStreak >= FIRST_FREEZER_STREAK_DAY
    && ((nextCurrentStreak - FIRST_FREEZER_STREAK_DAY) % FREEZER_RENEWAL_INTERVAL_DAYS === 0);
  const freezerAwards = hitFreezerRenewalCheckpoint && streakFreezesAvailable <= 0 ? 1 : 0;

  return {
    currentStreak: nextCurrentStreak,
    longestStreak: nextLongestStreak,
    lastActivityDate: getLagosDateValue(now),
    milestonesUnlocked,
    streakFreezesAvailable: nextAvailableFreezes + freezerAwards
  };
}

export function buildMilestoneProgress(currentStreak: number, longestStreak: number): MilestoneProgress[] {
  return STREAK_MILESTONES.map((milestone) => ({
    days: milestone.days,
    label: milestone.label,
    reward: milestone.reward,
    achieved: longestStreak >= milestone.days,
    active: currentStreak >= milestone.days
  }));
}

export function getNextMilestone(currentStreak: number): NextMilestone | null {
  const nextMilestone = STREAK_MILESTONES.find((milestone) => currentStreak < milestone.days);
  if (!nextMilestone) {
    return null;
  }

  return {
    days: nextMilestone.days,
    label: nextMilestone.label,
    reward: nextMilestone.reward,
    remainingDays: nextMilestone.days - currentStreak
  };
}

import { EmailType, Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { STREAK_CONFIG } from '../../config/constants';
import { NotFoundError } from '../../shared/errors/NotFoundError';
import {
  addLagosDateDays,
  buildMilestoneProgress,
  deriveStreakSnapshot,
  getLagosDateKey,
  getLagosDateValue,
  getNextMilestone
} from '../../shared/streaks/domain';
import { StreakCalendarDay, StreakCalendarResponse, StreakSummaryResponse } from './streaks.types';

const streakUserSelect = {
  id: true,
  email: true,
  fullName: true,
  aspiringCourse: true,
  targetScore: true,
  isPremium: true,
  isVerified: true,
  isBanned: true,
  hasTakenFreeExam: true,
  currentStreak: true,
  longestStreak: true,
  lastActivityDate: true,
  streakFreezesAvailable: true,
  lastStreakReminder: true,
  emailUnsubscribed: true
} satisfies Prisma.UserSelect;

type StreakReminderUser = Prisma.UserGetPayload<{ select: typeof streakUserSelect }>;

interface ReminderCandidate {
  id: number;
  email: string;
  fullName: string;
  aspiringCourse: string | null;
  targetScore: number | null;
  isPremium: boolean;
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: Date | null;
  status: ReturnType<typeof deriveStreakSnapshot>['status'];
}

export class StreaksService {
  async getSummary(userId: number, now = new Date()): Promise<StreakSummaryResponse> {
    const today = getLagosDateValue(now);

    const [user, todayActivity] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: streakUserSelect
      }),
      prisma.studyActivity.findUnique({
        where: {
          userId_activityDate: {
            userId,
            activityDate: today
          }
        },
        select: {
          examsTaken: true,
          spEarnedToday: true
        }
      })
    ]);

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    const snapshot = deriveStreakSnapshot(
      user.currentStreak,
      user.longestStreak,
      user.lastActivityDate ? new Date(user.lastActivityDate) : null,
      now,
      user.streakFreezesAvailable
    );

    return {
      currentStreak: snapshot.currentStreak,
      longestStreak: user.longestStreak,
      status: snapshot.status,
      studiedToday: snapshot.studiedToday,
      studiedYesterday: snapshot.studiedYesterday,
      lastActivityDate: snapshot.lastActivityDate,
      streakEndsAt: snapshot.streakEndsAt,
      canStillSaveToday: snapshot.canStillSaveToday,
      streakFreezesAvailable: snapshot.streakFreezesAvailable,
      freezerProtectionActive: snapshot.freezerProtectionActive,
      today: {
        examsTaken: todayActivity?.examsTaken ?? 0,
        spEarnedToday: todayActivity?.spEarnedToday ?? 0
      },
      nextMilestone: getNextMilestone(snapshot.currentStreak),
      milestones: buildMilestoneProgress(snapshot.currentStreak, user.longestStreak),
      reminderState: {
        emailOptedOut: user.emailUnsubscribed,
        lastReminderDate: user.lastStreakReminder ? getLagosDateKey(user.lastStreakReminder) : null
      }
    };
  }

  async getCalendar(userId: number, days: number, now = new Date()): Promise<StreakCalendarResponse> {
    const today = getLagosDateValue(now);
    const rangeStart = addLagosDateDays(today, -(days - 1));

    const [user, activityRows] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          currentStreak: true,
          longestStreak: true,
          lastActivityDate: true,
          streakFreezesAvailable: true
        }
      }),
      prisma.studyActivity.findMany({
        where: {
          userId,
          activityDate: {
            gte: rangeStart,
            lte: today
          }
        },
        orderBy: {
          activityDate: 'asc'
        },
        select: {
          activityDate: true,
          examsTaken: true,
          spEarnedToday: true
        }
      })
    ]);

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    const snapshot = deriveStreakSnapshot(
      user.currentStreak,
      user.longestStreak,
      user.lastActivityDate ? new Date(user.lastActivityDate) : null,
      now,
      user.streakFreezesAvailable
    );

    const activityByDate = new Map<string, { examsTaken: number; spEarnedToday: number }>();
    for (const row of activityRows) {
      activityByDate.set(getLagosDateKey(row.activityDate), {
        examsTaken: row.examsTaken,
        spEarnedToday: row.spEarnedToday
      });
    }

    const streakDayKeys = new Set<string>();
    if (snapshot.currentStreak > 0) {
      let cursor = snapshot.studiedToday
        ? today
        : snapshot.studiedYesterday
          ? addLagosDateDays(today, -1)
          : snapshot.freezerProtectionActive
            ? addLagosDateDays(today, -2)
            : null;
      let remaining = snapshot.currentStreak;

      while (cursor && remaining > 0) {
        streakDayKeys.add(getLagosDateKey(cursor));
        cursor = addLagosDateDays(cursor, -1);
        remaining -= 1;
      }
    }

    const daysPayload: StreakCalendarDay[] = [];
    for (let index = 0; index < days; index += 1) {
      const day = addLagosDateDays(rangeStart, index);
      const key = getLagosDateKey(day);
      const activity = activityByDate.get(key);

      daysPayload.push({
        date: key,
        studied: Boolean(activity),
        examsTaken: activity?.examsTaken ?? 0,
        spEarnedToday: activity?.spEarnedToday ?? 0,
        isToday: key === getLagosDateKey(today),
        isYesterday: key === getLagosDateKey(addLagosDateDays(today, -1)),
        isCurrentStreakDay: streakDayKeys.has(key)
      });
    }

    return {
      daysRequested: days,
      currentStreak: snapshot.currentStreak,
      longestStreak: user.longestStreak,
      status: snapshot.status,
      activeDaysInRange: daysPayload.filter((day) => day.studied).length,
      totalSpEarnedInRange: daysPayload.reduce((total, day) => total + day.spEarnedToday, 0),
      days: daysPayload
    };
  }

  async reconcileBrokenStreaks(now = new Date()): Promise<{
    reconciledUsers: number;
    batchesProcessed: number;
  }> {
    const twoDaysAgoStart = addLagosDateDays(getLagosDateValue(now), -2);
    let reconciledUsers = 0;
    let batchesProcessed = 0;

    for (let batchIndex = 0; batchIndex < STREAK_CONFIG.RECONCILIATION_MAX_BATCHES; batchIndex += 1) {
      const staleUsers = await prisma.user.findMany({
        where: {
          currentStreak: { gt: 0 },
          OR: [
            {
              lastActivityDate: {
                lt: twoDaysAgoStart
              }
            },
            {
              lastActivityDate: twoDaysAgoStart,
              streakFreezesAvailable: 0
            }
          ]
        },
        orderBy: [
          { lastActivityDate: 'asc' },
          { id: 'asc' }
        ],
        take: STREAK_CONFIG.RECONCILIATION_BATCH_SIZE,
        select: {
          id: true
        }
      });

      if (staleUsers.length === 0) {
        break;
      }

      const result = await prisma.user.updateMany({
        where: {
          id: {
            in: staleUsers.map((user: { id: number }) => user.id)
          },
          currentStreak: { gt: 0 }
        },
        data: {
          currentStreak: 0
        }
      });

      reconciledUsers += result.count;
      batchesProcessed += 1;

      if (staleUsers.length < STREAK_CONFIG.RECONCILIATION_BATCH_SIZE) {
        break;
      }
    }

    return {
      reconciledUsers,
      batchesProcessed
    };
  }

  async listPremiumReminderCandidates(now = new Date()): Promise<ReminderCandidate[]> {
    const today = getLagosDateValue(now);
    const yesterday = addLagosDateDays(today, -1);
    const twoDaysAgo = addLagosDateDays(today, -2);

    const users = await prisma.user.findMany({
      where: {
        isPremium: true,
        isVerified: true,
        isBanned: false,
        emailUnsubscribed: false,
        currentStreak: { gt: 0 },
        AND: [
          {
            OR: [
              { lastActivityDate: yesterday },
              {
                lastActivityDate: twoDaysAgo,
                streakFreezesAvailable: { gt: 0 }
              }
            ]
          },
          {
            OR: [
              { lastStreakReminder: null },
              { lastStreakReminder: { lt: today } }
            ]
          }
        ]
      },
      orderBy: [
        { currentStreak: 'desc' },
        { id: 'asc' }
      ],
      take: STREAK_CONFIG.REMINDER_BATCH_SIZE,
      select: streakUserSelect
    });

    return users.map((user: StreakReminderUser) => ({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      aspiringCourse: user.aspiringCourse,
      targetScore: user.targetScore,
      isPremium: user.isPremium,
      currentStreak: user.currentStreak,
      longestStreak: user.longestStreak,
      lastActivityDate: user.lastActivityDate ? new Date(user.lastActivityDate) : null,
      status: deriveStreakSnapshot(
        user.currentStreak,
        user.longestStreak,
        user.lastActivityDate ? new Date(user.lastActivityDate) : null,
        now,
        user.streakFreezesAvailable
      ).status
    })).filter((user: ReminderCandidate) => user.status === 'AT_RISK');
  }

  async listFreePromptCandidates(now = new Date()): Promise<ReminderCandidate[]> {
    const today = getLagosDateValue(now);
    const yesterday = addLagosDateDays(today, -1);
    const twoDaysAgo = addLagosDateDays(today, -2);

    const users = await prisma.user.findMany({
      where: {
        isPremium: false,
        isVerified: true,
        isBanned: false,
        hasTakenFreeExam: true,
        emailUnsubscribed: false,
        currentStreak: { gt: 0 },
        OR: [
          { lastActivityDate: yesterday },
          {
            lastActivityDate: twoDaysAgo,
            streakFreezesAvailable: { gt: 0 }
          }
        ]
      },
      orderBy: [
        { currentStreak: 'desc' },
        { id: 'asc' }
      ],
      take: STREAK_CONFIG.REMINDER_BATCH_SIZE,
      select: streakUserSelect
    });

    if (users.length === 0) {
      return [];
    }

    const recentPromptThreshold = addLagosDateDays(today, -STREAK_CONFIG.FREE_PROMPT_COOLDOWN_DAYS);
    const recentPromptLogs = await prisma.emailLog.findMany({
      where: {
        userId: {
          in: users.map((user: StreakReminderUser) => user.id)
        },
        emailType: EmailType.SUBSCRIPTION_PROMPT,
        sentAt: {
          gt: recentPromptThreshold
        },
        status: {
          in: ['sent', 'preview']
        }
      },
      orderBy: [
        { sentAt: 'desc' },
        { id: 'desc' }
      ],
      select: {
        userId: true
      }
    });

    const recentlyPrompted = new Set<number>(recentPromptLogs.map((row: { userId: number }) => row.userId));

    return users
      .filter((user: StreakReminderUser) => !recentlyPrompted.has(user.id))
      .map((user: StreakReminderUser) => ({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        aspiringCourse: user.aspiringCourse,
        targetScore: user.targetScore,
        isPremium: user.isPremium,
        currentStreak: user.currentStreak,
        longestStreak: user.longestStreak,
        lastActivityDate: user.lastActivityDate ? new Date(user.lastActivityDate) : null,
        status: deriveStreakSnapshot(
          user.currentStreak,
          user.longestStreak,
          user.lastActivityDate ? new Date(user.lastActivityDate) : null,
          now,
          user.streakFreezesAvailable
        ).status
      }))
      .filter((user: ReminderCandidate) => user.status === 'AT_RISK');
  }

  async markReminderSent(userId: number, now = new Date()): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: {
        lastStreakReminder: getLagosDateValue(now)
      }
    });
  }
}

export const streaksService = new StreaksService();

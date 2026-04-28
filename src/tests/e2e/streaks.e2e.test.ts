import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import prisma from '../../config/database';
import { addLagosDateDays, getLagosDateKey, getLagosDateValue } from '../../shared/streaks/domain';
import { hashPassword } from '../../shared/utils/hash';
import { generateTokens } from '../../shared/utils/jwt';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeE2E = runIntegration ? describe : describe.skip;

interface Fixture {
  userIds: number[];
}

function uniqueToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

async function createUserFixture(
  fixture: Fixture,
  input: Partial<{
    currentStreak: number;
    longestStreak: number;
    lastActivityDate: Date | null;
    streakFreezesAvailable: number;
    isPremium: boolean;
    hasTakenFreeExam: boolean;
  }> = {}
) {
  const user = await prisma.user.create({
    data: {
      email: `${uniqueToken('streaks')}@example.com`,
      passwordHash: await hashPassword('SecurePass123!'),
      fullName: uniqueToken('Streaks Fixture User'),
      isVerified: true,
      currentStreak: input.currentStreak ?? 0,
      longestStreak: input.longestStreak ?? 0,
      lastActivityDate: input.lastActivityDate ?? null,
      streakFreezesAvailable: input.streakFreezesAvailable ?? 0,
      isPremium: input.isPremium ?? false,
      hasTakenFreeExam: input.hasTakenFreeExam ?? false
    }
  });

  fixture.userIds.push(user.id);
  return user;
}

async function createAuthHeader(user: { id: number; email: string; role: string }, deviceId = uniqueToken('streak-device')) {
  const session = await prisma.userSession.create({
    data: {
      userId: user.id,
      deviceId,
      isActive: true,
      authPolicyVersion: 0,
      tokenVersion: 0,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    }
  });

  const tokens = generateTokens(
    {
      id: user.id,
      email: user.email,
      role: user.role
    },
    session.id,
    deviceId,
    session.tokenVersion
  );

  return `Bearer ${tokens.accessToken}`;
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  await prisma.studyActivity.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.emailLog.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.auditLog.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.userSession.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.user.deleteMany({
    where: { id: { in: fixture.userIds } }
  });
}

describeE2E('Streaks module (HTTP e2e)', () => {
  it('returns an active streak summary with milestone progress and today activity', async () => {
    const fixture: Fixture = { userIds: [] };
    const app = await buildApp();

    try {
      const today = getLagosDateValue(new Date());
      const yesterday = addLagosDateDays(today, -1);
      const twoDaysAgo = addLagosDateDays(today, -2);

      const user = await createUserFixture(fixture, {
        currentStreak: 3,
        longestStreak: 5,
        lastActivityDate: today,
        isPremium: true
      });

      await prisma.studyActivity.createMany({
        data: [
          { userId: user.id, activityDate: twoDaysAgo, examsTaken: 1, spEarnedToday: 12 },
          { userId: user.id, activityDate: yesterday, examsTaken: 2, spEarnedToday: 20 },
          { userId: user.id, activityDate: today, examsTaken: 1, spEarnedToday: 18 }
        ]
      });

      const authHeader = await createAuthHeader(user);

      const response = await app.inject({
        method: 'GET',
        url: '/api/streaks',
        headers: { authorization: authHeader }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual(expect.objectContaining({
        currentStreak: 3,
        longestStreak: 5,
        status: 'ACTIVE',
        studiedToday: true,
        streakFreezesAvailable: 0,
        freezerProtectionActive: false,
        today: expect.objectContaining({
          examsTaken: 1,
          spEarnedToday: 18
        }),
        nextMilestone: expect.objectContaining({
          days: 7,
          remainingDays: 4
        })
      }));
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('keeps a streak alive when a freezer can bridge one missed day', async () => {
    const fixture: Fixture = { userIds: [] };
    const app = await buildApp();

    try {
      const today = getLagosDateValue(new Date());
      const twoDaysAgo = addLagosDateDays(today, -2);
      const threeDaysAgo = addLagosDateDays(today, -3);

      const user = await createUserFixture(fixture, {
        currentStreak: 8,
        longestStreak: 10,
        lastActivityDate: twoDaysAgo,
        streakFreezesAvailable: 1,
        isPremium: true
      });

      await prisma.studyActivity.createMany({
        data: [
          { userId: user.id, activityDate: threeDaysAgo, examsTaken: 1, spEarnedToday: 14 },
          { userId: user.id, activityDate: twoDaysAgo, examsTaken: 1, spEarnedToday: 20 }
        ]
      });

      const authHeader = await createAuthHeader(user);

      const response = await app.inject({
        method: 'GET',
        url: '/api/streaks',
        headers: { authorization: authHeader }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual(expect.objectContaining({
        currentStreak: 8,
        longestStreak: 10,
        status: 'AT_RISK',
        studiedToday: false,
        studiedYesterday: false,
        canStillSaveToday: true,
        streakFreezesAvailable: 1,
        freezerProtectionActive: true
      }));
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('returns a streak calendar and marks the current streak window correctly', async () => {
    const fixture: Fixture = { userIds: [] };
    const app = await buildApp();

    try {
      const today = getLagosDateValue(new Date());
      const yesterday = addLagosDateDays(today, -1);
      const twoDaysAgo = addLagosDateDays(today, -2);

      const user = await createUserFixture(fixture, {
        currentStreak: 3,
        longestStreak: 6,
        lastActivityDate: today
      });

      await prisma.studyActivity.createMany({
        data: [
          { userId: user.id, activityDate: twoDaysAgo, examsTaken: 1, spEarnedToday: 10 },
          { userId: user.id, activityDate: yesterday, examsTaken: 1, spEarnedToday: 15 },
          { userId: user.id, activityDate: today, examsTaken: 1, spEarnedToday: 18 }
        ]
      });

      const authHeader = await createAuthHeader(user);

      const response = await app.inject({
        method: 'GET',
        url: '/api/streaks/calendar?days=7',
        headers: { authorization: authHeader }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual(expect.objectContaining({
        daysRequested: 7,
        currentStreak: 3,
        status: 'ACTIVE',
        activeDaysInRange: 3,
        totalSpEarnedInRange: 43
      }));
      expect(response.json().data.days).toEqual(expect.arrayContaining([
        expect.objectContaining({
          date: getLagosDateKey(twoDaysAgo),
          studied: true,
          isCurrentStreakDay: true
        }),
        expect.objectContaining({
          date: getLagosDateKey(yesterday),
          studied: true,
          isCurrentStreakDay: true
        }),
        expect.objectContaining({
          date: getLagosDateKey(today),
          studied: true,
          isCurrentStreakDay: true
        })
      ]));
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('marks the current streak window correctly when freezer protection is active', async () => {
    const fixture: Fixture = { userIds: [] };
    const app = await buildApp();

    try {
      const today = getLagosDateValue(new Date());
      const twoDaysAgo = addLagosDateDays(today, -2);
      const threeDaysAgo = addLagosDateDays(today, -3);
      const fourDaysAgo = addLagosDateDays(today, -4);

      const user = await createUserFixture(fixture, {
        currentStreak: 3,
        longestStreak: 7,
        lastActivityDate: twoDaysAgo,
        streakFreezesAvailable: 1
      });

      await prisma.studyActivity.createMany({
        data: [
          { userId: user.id, activityDate: fourDaysAgo, examsTaken: 1, spEarnedToday: 8 },
          { userId: user.id, activityDate: threeDaysAgo, examsTaken: 1, spEarnedToday: 11 },
          { userId: user.id, activityDate: twoDaysAgo, examsTaken: 1, spEarnedToday: 13 }
        ]
      });

      const authHeader = await createAuthHeader(user);

      const response = await app.inject({
        method: 'GET',
        url: '/api/streaks/calendar?days=7',
        headers: { authorization: authHeader }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual(expect.objectContaining({
        daysRequested: 7,
        currentStreak: 3,
        status: 'AT_RISK',
        activeDaysInRange: 3,
        totalSpEarnedInRange: 32
      }));
      expect(response.json().data.days).toEqual(expect.arrayContaining([
        expect.objectContaining({
          date: getLagosDateKey(fourDaysAgo),
          studied: true,
          isCurrentStreakDay: true
        }),
        expect.objectContaining({
          date: getLagosDateKey(threeDaysAgo),
          studied: true,
          isCurrentStreakDay: true
        }),
        expect.objectContaining({
          date: getLagosDateKey(twoDaysAgo),
          studied: true,
          isCurrentStreakDay: true
        })
      ]));
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('derives a broken streak correctly even before reconciliation updates the stored counter', async () => {
    const fixture: Fixture = { userIds: [] };
    const app = await buildApp();

    try {
      const staleActivityDay = addLagosDateDays(getLagosDateValue(new Date()), -3);
      const user = await createUserFixture(fixture, {
        currentStreak: 5,
        longestStreak: 9,
        lastActivityDate: staleActivityDay,
        isPremium: true
      });
      const authHeader = await createAuthHeader(user);

      const response = await app.inject({
        method: 'GET',
        url: '/api/streaks',
        headers: { authorization: authHeader }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual(expect.objectContaining({
        currentStreak: 0,
        longestStreak: 9,
        status: 'BROKEN',
        studiedToday: false,
        canStillSaveToday: false
      }));
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);
});

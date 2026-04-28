import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import prisma from '../../config/database';
import { generateTokens } from '../../shared/utils/jwt';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeE2E = runIntegration ? describe : describe.skip;

interface LeaderboardFixture {
  userIds: number[];
  sessionIds: string[];
  institutionIds: number[];
}

function uniqueToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

async function createUserFixture(
  fixture: LeaderboardFixture,
  input: Partial<any> = {}
) {
  const user = await prisma.user.create({
    data: {
      email: `${uniqueToken('lb-user')}@example.com`,
      passwordHash: 'hashed-password',
      fullName: `Leaderboard ${uniqueToken('user')}`,
      isVerified: true,
      isPremium: true,
      deviceAccessMode: 'PREMIUM',
      realExamsCompleted: 3,
      ...input
    }
  });

  fixture.userIds.push(user.id);

  const scopedInstitutionId = input.targetInstitutionId
    ?? (await prisma.institution.findUnique({
      where: { code: 'UI' },
      select: { id: true }
    }))?.id;

  if (scopedInstitutionId) {
    await prisma.userInstitutionStats.upsert({
      where: {
        userId_institutionId: {
          userId: user.id,
          institutionId: scopedInstitutionId
        }
      },
      create: {
        userId: user.id,
        institutionId: scopedInstitutionId,
        weeklySp: input.weeklySp ?? 0,
        totalSp: input.totalSp ?? 0,
        realExamsCompleted: input.realExamsCompleted ?? 3
      },
      update: {
        weeklySp: input.weeklySp ?? 0,
        totalSp: input.totalSp ?? 0,
        realExamsCompleted: input.realExamsCompleted ?? 3
      }
    });
  }

  return user;
}

async function createInstitution(fixture: LeaderboardFixture, label: string) {
  const token = uniqueToken(label).replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
  const institution = await prisma.institution.create({
    data: {
      code: `${label}${token}`.slice(0, 12).toUpperCase(),
      name: `${label} ${token}`,
      slug: `${label.toLowerCase()}-${token.toLowerCase()}`
    }
  });

  fixture.institutionIds.push(institution.id);
  return institution;
}

async function createAuthHeader(
  fixture: LeaderboardFixture,
  user: any
): Promise<string> {
  const deviceId = uniqueToken('lb-device');
  const session = await prisma.userSession.create({
    data: {
      userId: user.id,
      deviceId,
      isActive: true,
      expiresAt: new Date(Date.now() + (24 * 60 * 60 * 1000))
    }
  });
  fixture.sessionIds.push(session.id);

  const tokens = generateTokens(
    {
      id: user.id,
      email: user.email,
      role: user.role
    },
    session.id,
    deviceId,
    (session as any).tokenVersion ?? 0
  );

  return `Bearer ${tokens.accessToken}`;
}

async function cleanupFixture(fixture: LeaderboardFixture): Promise<void> {
  if (fixture.sessionIds.length > 0) {
    await prisma.userSession.deleteMany({
      where: {
        id: { in: fixture.sessionIds }
      }
    });
  }

  if (fixture.userIds.length > 0) {
    await prisma.idempotencyRecord.deleteMany({
      where: {
        userId: { in: fixture.userIds }
      }
    });

    await prisma.weeklyLeaderboard.deleteMany({
      where: {
        userId: { in: fixture.userIds }
      }
    });

    await prisma.user.deleteMany({
      where: {
        id: { in: fixture.userIds }
      }
    });
  }

  if (fixture.institutionIds.length > 0) {
    await prisma.institution.deleteMany({
      where: {
        id: { in: fixture.institutionIds }
      }
    });
  }
}

describeE2E('Leaderboard module (HTTP e2e)', () => {
  it('returns deterministic weekly/all-time rankings and my-rank snapshot', async () => {
    const fixture: LeaderboardFixture = {
      userIds: [],
      sessionIds: [],
      institutionIds: []
    };

    const app = await buildApp();

    try {
      // Stay below Postgres INT max while dominating older shared-fixture scores.
      const userA = await createUserFixture(fixture, { fullName: 'Alice', weeklySp: 2147480000, totalSp: 2147481000 });
      const userB = await createUserFixture(fixture, { fullName: 'Bob', weeklySp: 2147480000, totalSp: 2147480000 });
      const userC = await createUserFixture(fixture, { fullName: 'Chidi', weeklySp: 2147479000, totalSp: 2147482000 });
      const authHeader = await createAuthHeader(fixture, userB);

      const weeklyResponse = await app.inject({
        method: 'GET',
        url: '/api/leaderboard/weekly?limit=3',
        headers: {
          authorization: authHeader
        }
      });

      expect(weeklyResponse.statusCode).toBe(200);
      const weeklyBody = weeklyResponse.json() as any;
      expect(weeklyBody.data.type).toBe('WEEKLY');
      expect(weeklyBody.data.entries).toHaveLength(3);
      expect(weeklyBody.data.entries.map((entry: any) => entry.userId)).toEqual([userA.id, userB.id, userC.id]);
      expect(weeklyBody.data.entries[1].isCurrentUser).toBe(true);

      const allTimeResponse = await app.inject({
        method: 'GET',
        url: '/api/leaderboard/all-time?limit=3',
        headers: {
          authorization: authHeader
        }
      });

      expect(allTimeResponse.statusCode).toBe(200);
      const allTimeBody = allTimeResponse.json() as any;
      expect(allTimeBody.data.type).toBe('ALL_TIME');
      expect(allTimeBody.data.entries.map((entry: any) => entry.userId)).toEqual([userC.id, userA.id, userB.id]);

      const myRankResponse = await app.inject({
        method: 'GET',
        url: '/api/leaderboard/my-rank',
        headers: {
          authorization: authHeader
        }
      });

      expect(myRankResponse.statusCode).toBe(200);
      const myRankBody = myRankResponse.json() as any;
      expect(myRankBody.data.user.id).toBe(userB.id);
      expect(myRankBody.data.weekly.rank).toBe(2);
      expect(myRankBody.data.allTime.rank).toBe(3);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  });

  it('scopes leaderboard reads and my-rank to the requested institution', async () => {
    const fixture: LeaderboardFixture = {
      userIds: [],
      sessionIds: [],
      institutionIds: []
    };

    const app = await buildApp();

    try {
      const oau = await createInstitution(fixture, 'OAU');
      const unilag = await createInstitution(fixture, 'UNILAG');

      const user = await createUserFixture(fixture, {
        fullName: 'Scoped User',
        targetInstitutionId: oau.id,
        weeklySp: 180,
        totalSp: 320
      });
      const oauRival = await createUserFixture(fixture, {
        fullName: 'OAU Rival',
        targetInstitutionId: oau.id,
        weeklySp: 220,
        totalSp: 450
      });
      const unilagRival = await createUserFixture(fixture, {
        fullName: 'UNILAG Rival',
        targetInstitutionId: unilag.id,
        weeklySp: 900,
        totalSp: 1400
      });

      await prisma.userInstitutionStats.upsert({
        where: {
          userId_institutionId: {
            userId: user.id,
            institutionId: unilag.id
          }
        },
        create: {
          userId: user.id,
          institutionId: unilag.id,
          weeklySp: 70,
          totalSp: 90,
          realExamsCompleted: 3
        },
        update: {
          weeklySp: 70,
          totalSp: 90
        }
      });

      const authHeader = await createAuthHeader(fixture, user);

      const oauWeeklyResponse = await app.inject({
        method: 'GET',
        url: `/api/leaderboard/weekly?limit=3&institutionCode=${oau.code}`,
        headers: {
          authorization: authHeader
        }
      });

      expect(oauWeeklyResponse.statusCode).toBe(200);
      const oauWeeklyBody = oauWeeklyResponse.json() as any;
      expect(oauWeeklyBody.data.institution.code).toBe(oau.code);
      expect(oauWeeklyBody.data.entries.map((entry: any) => entry.userId)).toEqual([oauRival.id, user.id]);

      const unilagWeeklyResponse = await app.inject({
        method: 'GET',
        url: `/api/leaderboard/weekly?limit=3&institutionCode=${unilag.code}`,
        headers: {
          authorization: authHeader
        }
      });

      expect(unilagWeeklyResponse.statusCode).toBe(200);
      const unilagWeeklyBody = unilagWeeklyResponse.json() as any;
      expect(unilagWeeklyBody.data.institution.code).toBe(unilag.code);
      expect(unilagWeeklyBody.data.entries.map((entry: any) => entry.userId)).toEqual([unilagRival.id, user.id]);

      const myRankResponse = await app.inject({
        method: 'GET',
        url: `/api/leaderboard/my-rank?institutionCode=${unilag.code}`,
        headers: {
          authorization: authHeader
        }
      });

      expect(myRankResponse.statusCode).toBe(200);
      const myRankBody = myRankResponse.json() as any;
      expect(myRankBody.data.institution.code).toBe(unilag.code);
      expect(myRankBody.data.user.weeklySp).toBe(70);
      expect(myRankBody.data.weekly.rank).toBe(2);
      expect(myRankBody.data.allTime.rank).toBe(2);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  });
});

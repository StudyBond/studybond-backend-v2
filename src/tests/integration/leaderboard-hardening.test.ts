import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import prisma from '../../config/database';
import { EXAM_STATUS, EXAM_TYPES } from '../../modules/exams/exams.constants';
import { ExamsService } from '../../modules/exams/exams.service';
import { LeaderboardService } from '../../modules/leaderboard/leaderboard.service';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

interface FixtureState {
  userIds: number[];
  questionIds: number[];
  examIds: number[];
  institutionIds: number[];
}

function createFixtureState(): FixtureState {
  return {
    userIds: [],
    questionIds: [],
    examIds: [],
    institutionIds: []
  };
}

function uniqueToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

async function createUser(fixture: FixtureState, input: Partial<any> = {}) {
  const user = await prisma.user.create({
    data: {
      email: `${uniqueToken('lb-itest-user')}@example.com`,
      passwordHash: 'hashed-password',
      fullName: `Leaderboard Integration ${uniqueToken('user')}`,
      isVerified: true,
      isPremium: true,
      realExamsCompleted: 5,
      ...input
    }
  });
  fixture.userIds.push(user.id);
  return user;
}

async function createRealPastQuestion(fixture: FixtureState, subject: string) {
  const question = await prisma.question.create({
    data: {
      questionText: `${uniqueToken('lb-itest-question')} ${subject}`,
      hasImage: false,
      optionA: 'A',
      optionB: 'B',
      optionC: 'C',
      optionD: 'D',
      correctAnswer: 'A',
      subject,
      topic: 'Integration',
      questionType: 'real_past_question'
    }
  });
  fixture.questionIds.push(question.id);
  return question;
}

async function createInstitution(fixture: FixtureState, label: string) {
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

async function cleanupFixture(fixture: FixtureState): Promise<void> {
  if (fixture.examIds.length > 0) {
    await prisma.examAnswer.deleteMany({
      where: { examId: { in: fixture.examIds } }
    });
    await prisma.exam.deleteMany({
      where: { id: { in: fixture.examIds } }
    });
  }

  if (fixture.userIds.length > 0) {
    await prisma.leaderboardProjectionEvent.deleteMany({
      where: { userId: { in: fixture.userIds } }
    });
    await prisma.leaderboardIntegritySignal.deleteMany({
      where: { userId: { in: fixture.userIds } }
    });
    await prisma.weeklyLeaderboard.deleteMany({
      where: { userId: { in: fixture.userIds } }
    });
    await prisma.user.deleteMany({
      where: { id: { in: fixture.userIds } }
    });
  }

  if (fixture.questionIds.length > 0) {
    await prisma.question.deleteMany({
      where: { id: { in: fixture.questionIds } }
    });
  }

  if (fixture.institutionIds.length > 0) {
    await prisma.institution.deleteMany({
      where: { id: { in: fixture.institutionIds } }
    });
  }
}

describeIntegration('Leaderboard hardening integration', () => {
  it('queues exactly one projection event when concurrent submits race', async () => {
    const fixture = createFixtureState();
    const prevProjectionEnabled = process.env.LEADERBOARD_PROJECTION_ENABLED;
    process.env.LEADERBOARD_PROJECTION_ENABLED = 'true';

    try {
      const user = await createUser(fixture, {
        isPremium: false,
        realExamsCompleted: 0
      });
      const question = await createRealPastQuestion(fixture, 'Biology');

      const exam = await prisma.exam.create({
        data: {
          userId: user.id,
          examType: EXAM_TYPES.REAL_PAST_QUESTION as any,
          nameScopeKey: 'REAL:BIO',
          sessionNumber: 1,
          subjectsIncluded: ['Biology'],
          totalQuestions: 1,
          score: 0,
          percentage: 0,
          spEarned: 0,
          status: EXAM_STATUS.IN_PROGRESS as any,
          startedAt: new Date()
        }
      });
      fixture.examIds.push(exam.id);

      await prisma.examAnswer.create({
        data: {
          examId: exam.id,
          questionId: question.id,
          userAnswer: null,
          isCorrect: false,
          timeSpentSeconds: 0
        }
      });

      const service = new ExamsService();
      const payload = {
        answers: [
          {
            questionId: question.id,
            answer: 'A',
            timeSpentSeconds: 1
          }
        ]
      };

      await Promise.allSettled([
        service.submitExam(user.id, exam.id, payload as any, uniqueToken('lb-submit-a')),
        service.submitExam(user.id, exam.id, payload as any, uniqueToken('lb-submit-b'))
      ]);

      const projectionEvents = await prisma.leaderboardProjectionEvent.findMany({
        where: { userId: user.id }
      });
      expect(projectionEvents).toHaveLength(1);
      expect(projectionEvents[0].source).toBe('EXAM_SUBMIT');
    } finally {
      process.env.LEADERBOARD_PROJECTION_ENABLED = prevProjectionEnabled;
      await cleanupFixture(fixture);
    }
  });

  it('keeps weekly reset idempotent for the same week', async () => {
    const fixture = createFixtureState();
    const prevProjectionEnabled = process.env.LEADERBOARD_PROJECTION_ENABLED;
    process.env.LEADERBOARD_PROJECTION_ENABLED = 'true';

    try {
      const userA = await createUser(fixture, { weeklySp: 190, totalSp: 700 });
      const userB = await createUser(fixture, { weeklySp: 80, totalSp: 200 });
      const oau = await createInstitution(fixture, 'OAU');
      const launchInstitution = await prisma.institution.findUniqueOrThrow({
        where: { code: 'UI' },
        select: { id: true }
      });

      await prisma.userInstitutionStats.createMany({
        data: [
          {
            userId: userA.id,
            institutionId: launchInstitution.id,
            weeklySp: 120,
            totalSp: 500
          },
          {
            userId: userA.id,
            institutionId: oau.id,
            weeklySp: 70,
            totalSp: 200
          },
          {
            userId: userB.id,
            institutionId: launchInstitution.id,
            weeklySp: 80,
            totalSp: 200
          }
        ]
      });

      const service = new LeaderboardService();
      const reference = new Date('2026-03-06T12:00:00.000Z');

      const first = await service.runWeeklyReset(reference);
      const second = await service.runWeeklyReset(reference);

      expect(first.resetUsers).toBeGreaterThanOrEqual(2);
      expect(second.skipped || second.resetUsers === 0).toBe(true);

      const users = await prisma.user.findMany({
        where: { id: { in: [userA.id, userB.id] } },
        select: { weeklySp: true }
      });
      expect(users.every((user: { weeklySp: number }) => user.weeklySp === 0)).toBe(true);

      const scopedStats = await prisma.userInstitutionStats.findMany({
        where: {
          userId: { in: [userA.id, userB.id] },
          institutionId: launchInstitution.id
        },
        select: { weeklySp: true }
      });
      expect(scopedStats).toHaveLength(2);
      expect(scopedStats.every((row: { weeklySp: number }) => row.weeklySp === 0)).toBe(true);

      const archived = await prisma.weeklyLeaderboard.findMany({
        where: { userId: { in: [userA.id, userB.id] } },
        select: {
          userId: true,
          institutionId: true,
          weeklySp: true
        }
      });
      expect(archived).toHaveLength(3);
      expect(
        archived.some((row) => row.userId === userA.id && row.institutionId === oau.id && row.weeklySp === 70)
      ).toBe(true);
    } finally {
      process.env.LEADERBOARD_PROJECTION_ENABLED = prevProjectionEnabled;
      await cleanupFixture(fixture);
    }
  });
});

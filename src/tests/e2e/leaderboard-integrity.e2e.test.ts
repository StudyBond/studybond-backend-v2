import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import prisma from '../../config/database';
import { EXAM_STATUS, EXAM_TYPES } from '../../modules/exams/exams.constants';
import { generateTokens } from '../../shared/utils/jwt';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeE2E = runIntegration ? describe : describe.skip;

interface Fixture {
  userIds: number[];
  sessionIds: string[];
  questionIds: number[];
  examIds: number[];
}

function uniqueToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

async function createUser(fixture: Fixture) {
  const user = await prisma.user.create({
    data: {
      email: `${uniqueToken('integrity-user')}@example.com`,
      passwordHash: 'hashed-password',
      fullName: 'Integrity User',
      isVerified: true,
      isPremium: true,
      deviceAccessMode: 'PREMIUM',
      realExamsCompleted: 5
    }
  });
  fixture.userIds.push(user.id);
  return user;
}

async function createAuthHeader(fixture: Fixture, user: any): Promise<string> {
  const deviceId = uniqueToken('integrity-device');
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

async function cleanupFixture(fixture: Fixture): Promise<void> {
  if (fixture.examIds.length > 0) {
    await prisma.examAnswer.deleteMany({
      where: { examId: { in: fixture.examIds } }
    });
    await prisma.exam.deleteMany({
      where: { id: { in: fixture.examIds } }
    });
  }

  if (fixture.userIds.length > 0) {
    await prisma.leaderboardIntegritySignal.deleteMany({
      where: { userId: { in: fixture.userIds } }
    });
    await prisma.idempotencyRecord.deleteMany({
      where: { userId: { in: fixture.userIds } }
    });
  }

  if (fixture.sessionIds.length > 0) {
    await prisma.userSession.deleteMany({
      where: { id: { in: fixture.sessionIds } }
    });
  }

  if (fixture.userIds.length > 0) {
    await prisma.user.deleteMany({
      where: { id: { in: fixture.userIds } }
    });
  }

  if (fixture.questionIds.length > 0) {
    await prisma.question.deleteMany({
      where: { id: { in: fixture.questionIds } }
    });
  }
}

describeE2E('Leaderboard integrity signals (HTTP e2e)', () => {
  it('emits HIGH_SCORE_LOW_TIME signal after suspiciously fast high score submit', async () => {
    const fixture: Fixture = {
      userIds: [],
      sessionIds: [],
      questionIds: [],
      examIds: []
    };

    const app = await buildApp();
    try {
      const user = await createUser(fixture);
      const auth = await createAuthHeader(fixture, user);

      const question = await prisma.question.create({
        data: {
          questionText: `${uniqueToken('integrity-question')} Biology`,
          hasImage: false,
          optionA: 'A',
          optionB: 'B',
          optionC: 'C',
          optionD: 'D',
          correctAnswer: 'A',
          subject: 'Biology',
          topic: 'Integration',
          questionType: 'real_past_question'
        }
      });
      fixture.questionIds.push(question.id);

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
          startedAt: new Date(Date.now() - 1500)
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

      const submit = await app.inject({
        method: 'POST',
        url: `/api/exams/${exam.id}/submit`,
        headers: {
          authorization: auth,
          'idempotency-key': uniqueToken('integrity-submit')
        },
        payload: {
          answers: [
            {
              questionId: question.id,
              answer: 'A',
              timeSpentSeconds: 1
            }
          ]
        }
      });

      expect(submit.statusCode).toBe(200);

      const signal = await prisma.leaderboardIntegritySignal.findFirst({
        where: {
          userId: user.id,
          signalType: 'HIGH_SCORE_LOW_TIME'
        },
        orderBy: { createdAt: 'desc' }
      });

      expect(signal).not.toBeNull();
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  });
});

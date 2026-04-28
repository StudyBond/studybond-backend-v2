import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import prisma from '../../config/database';
import { QUESTION_POOLS } from '../../modules/questions/questions.constants';
import { generateTokens } from '../../shared/utils/jwt';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeE2E = runIntegration ? describe : describe.skip;

interface Fixture {
  userIds: number[];
  sessionIds: string[];
  questionIds: number[];
}

function uniqueToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

async function createAdminFixture(fixture: Fixture) {
  const user = await prisma.user.create({
    data: {
      email: `${uniqueToken('questions-admin')}@example.com`,
      passwordHash: 'hashed-password',
      fullName: uniqueToken('Questions Admin'),
      isVerified: true,
      role: 'ADMIN'
    }
  });

  fixture.userIds.push(user.id);
  return user;
}

async function createAuthHeader(fixture: Fixture, user: any): Promise<string> {
  const deviceId = uniqueToken('questions-device');
  const session = await prisma.userSession.create({
    data: {
      userId: user.id,
      deviceId,
      isActive: true,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
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

async function seedFreeExamQuestions(
  fixture: Fixture,
  subject: string,
  count: number
): Promise<void> {
  const marker = uniqueToken(`free-pool-${subject}`);
  const rows = Array.from({ length: count }).map((_, index) => ({
    questionText: `${marker} ${subject} #${index}`,
    hasImage: false,
    optionA: 'A',
    optionB: 'B',
    optionC: 'C',
    optionD: 'D',
    correctAnswer: 'A',
    subject,
    topic: 'Free Pool',
    questionType: 'real_past_question',
    questionPool: QUESTION_POOLS.FREE_EXAM
  }));

  await prisma.question.createMany({ data: rows });

  const created = await prisma.question.findMany({
    where: {
      questionText: { contains: marker }
    },
    select: { id: true }
  });

  fixture.questionIds.push(...created.map((row) => row.id));
}

async function createRealUiQuestion(fixture: Fixture, subject: string): Promise<number> {
  const created = await prisma.question.create({
    data: {
      questionText: `${uniqueToken('real-ui-edit')} ${subject}`,
      hasImage: false,
      optionA: 'A',
      optionB: 'B',
      optionC: 'C',
      optionD: 'D',
      correctAnswer: 'A',
      subject,
      topic: 'Real UI',
      questionType: 'real_past_question',
      questionPool: QUESTION_POOLS.REAL_BANK
    },
    select: { id: true }
  });

  fixture.questionIds.push(created.id);
  return created.id;
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
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

describeE2E('Questions free-exam pool (HTTP e2e)', () => {
  it('blocks admins from creating the 26th FREE_EXAM question for a subject', async () => {
    const fixture: Fixture = { userIds: [], sessionIds: [], questionIds: [] };
    const app = await buildApp();

    try {
      const admin = await createAdminFixture(fixture);
      const authHeader = await createAuthHeader(fixture, admin);
      await seedFreeExamQuestions(fixture, 'Physics', 25);

      const response = await app.inject({
        method: 'POST',
        url: '/api/questions',
        headers: {
          authorization: authHeader
        },
        payload: {
          questionText: 'Extra Physics FREE question',
          optionA: 'A',
          optionB: 'B',
          optionC: 'C',
          optionD: 'D',
          correctAnswer: 'A',
          subject: 'Physics',
          topic: 'Pool Guard',
          questionType: 'REAL_PAST_QUESTION',
          questionPool: 'FREE_EXAM'
        }
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual(expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'QUESTION_FREE_POOL_FULL',
          message: 'Physics already has 25 FREE exam questions for this institution. Remove or reclassify one before adding another.'
        })
      }));
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('blocks admins from moving another question into a full FREE_EXAM subject pool', async () => {
    const fixture: Fixture = { userIds: [], sessionIds: [], questionIds: [] };
    const app = await buildApp();

    try {
      const admin = await createAdminFixture(fixture);
      const authHeader = await createAuthHeader(fixture, admin);
      await seedFreeExamQuestions(fixture, 'Chemistry', 25);
      const questionId = await createRealUiQuestion(fixture, 'Chemistry');

      const response = await app.inject({
        method: 'PUT',
        url: `/api/questions/${questionId}`,
        headers: {
          authorization: authHeader
        },
        payload: {
          questionPool: 'FREE_EXAM'
        }
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual(expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'QUESTION_FREE_POOL_FULL'
        })
      }));
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);
});

import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import prisma from '../../config/database';
import { EXAM_CONFIG, EXAM_TYPES } from '../../modules/exams/exams.constants';
import { generateTokens } from '../../shared/utils/jwt';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeE2E = runIntegration ? describe : describe.skip;

interface E2EFixture {
  userIds: number[];
  sessionIds: string[];
  questionIds: number[];
}

function uniqueToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

async function createUserFixture(
  fixture: E2EFixture,
  input: Partial<any> = {},
) {
  const user = await prisma.user.create({
    data: {
      email: `${uniqueToken('e2e-daily-user')}@example.com`,
      passwordHash: 'hashed-password',
      fullName: `E2E Daily Challenge ${uniqueToken('user')}`,
      isVerified: true,
      isPremium: true,
      deviceAccessMode: 'PREMIUM',
      realExamsCompleted: 5,
      ...input,
    },
  });
  fixture.userIds.push(user.id);
  return user;
}

async function createAuthHeader(
  fixture: E2EFixture,
  user: any,
): Promise<string> {
  const deviceId = uniqueToken('device');
  const session = await prisma.userSession.create({
    data: {
      userId: user.id,
      deviceId,
      isActive: true,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  fixture.sessionIds.push(session.id);

  const tokens = generateTokens(
    {
      id: user.id,
      email: user.email,
      role: user.role,
    },
    session.id,
    deviceId,
    (session as any).tokenVersion ?? 0,
  );

  return `Bearer ${tokens.accessToken}`;
}

async function createQuestions(
  fixture: E2EFixture,
  subject: string,
  count: number,
): Promise<void> {
  const marker = uniqueToken(`e2e-daily-${subject}`);
  const rows = Array.from({ length: count }).map((_, index) => ({
    questionText: `${marker} ${subject} #${index}`,
    hasImage: false,
    optionA: 'Option A',
    optionB: 'Option B',
    optionC: 'Option C',
    optionD: 'Option D',
    correctAnswer: 'A',
    subject,
    topic: 'E2E Daily Challenge',
    questionType: 'real_past_question',
  }));

  await prisma.question.createMany({ data: rows });

  const created = await prisma.question.findMany({
    where: {
      questionText: { contains: marker },
      subject,
    },
    select: { id: true },
  });

  for (const row of created) {
    fixture.questionIds.push(row.id);
  }
}

async function cleanupFixture(fixture: E2EFixture): Promise<void> {
  if (fixture.userIds.length > 0) {
    await prisma.exam.deleteMany({
      where: { userId: { in: fixture.userIds } },
    });

    await prisma.idempotencyRecord.deleteMany({
      where: { userId: { in: fixture.userIds } },
    });

    await prisma.examSessionCounter.deleteMany({
      where: { userId: { in: fixture.userIds } },
    });
  }

  if (fixture.sessionIds.length > 0) {
    await prisma.userSession.deleteMany({
      where: { id: { in: fixture.sessionIds } },
    });
  }

  if (fixture.userIds.length > 0) {
    await prisma.user.deleteMany({
      where: { id: { in: fixture.userIds } },
    });
  }

  if (fixture.questionIds.length > 0) {
    await prisma.question.deleteMany({
      where: { id: { in: fixture.questionIds } },
    });
  }
}

describeE2E('Daily challenge start (HTTP e2e)', () => {
  it('starts a daily challenge with four questions and a dedicated daily scope', async () => {
    const separator = '\u2022';
    const fixture: E2EFixture = {
      userIds: [],
      sessionIds: [],
      questionIds: [],
    };

    const app = await buildApp();
    try {
      const user = await createUserFixture(fixture);
      const authHeader = await createAuthHeader(fixture, user);
      const subjects = ['Mathematics', 'English', 'Physics', 'Chemistry'] as const;

      for (const subject of subjects) {
        await createQuestions(fixture, subject, 3);
      }

      const response = await app.inject({
        method: 'POST',
        url: '/api/exams/daily-challenge/start',
        headers: {
          authorization: authHeader,
          'idempotency-key': uniqueToken('daily-challenge-start'),
        },
        payload: {
          subjects,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json() as any;
      expect(body.data.examType).toBe(EXAM_TYPES.DAILY_CHALLENGE);
      expect(body.data.totalQuestions).toBe(4);
      expect(body.data.timeAllowedSeconds).toBe(
        EXAM_CONFIG.DAILY_CHALLENGE_DURATION_SECONDS,
      );
      expect(body.data.displayNameShort).toBe(
        `#Daily ${separator} Full ${separator} S001`,
      );

      const createdExam = await prisma.exam.findUnique({
        where: { id: body.data.examId },
        select: {
          nameScopeKey: true,
          sessionNumber: true,
        },
      });

      expect(createdExam?.nameScopeKey).toBe('DAILY:FULL');
      expect(createdExam?.sessionNumber).toBe(1);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  });
});

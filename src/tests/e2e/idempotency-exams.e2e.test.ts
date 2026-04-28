import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import prisma from '../../config/database';
import { EXAM_TYPES } from '../../modules/exams/exams.constants';
import { buildScopeKeyFromExamType } from '../../shared/utils/examNaming';
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

async function createUserFixture(fixture: E2EFixture, input: Partial<any> = {}) {
  const user = await prisma.user.create({
    data: {
      email: `${uniqueToken('e2e-idem-user')}@example.com`,
      passwordHash: 'hashed-password',
      fullName: `E2E Idempotency ${uniqueToken('user')}`,
      isVerified: true,
      isPremium: true,
      deviceAccessMode: 'PREMIUM',
      realExamsCompleted: 5,
      ...input
    }
  });
  fixture.userIds.push(user.id);
  return user;
}

async function createAuthHeader(fixture: E2EFixture, user: any): Promise<string> {
  const deviceId = uniqueToken('device');
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

async function createPracticeQuestions(fixture: E2EFixture, subject: string, count: number): Promise<void> {
  const marker = uniqueToken('e2e-idem-question');
  const rows = Array.from({ length: count }).map((_, index) => ({
    questionText: `${marker} ${subject} #${index}`,
    hasImage: false,
    optionA: 'Option A',
    optionB: 'Option B',
    optionC: 'Option C',
    optionD: 'Option D',
    correctAnswer: 'A',
    subject,
    topic: 'E2E Idempotency',
    questionType: 'practice'
  }));

  await prisma.question.createMany({ data: rows });

  const created = await prisma.question.findMany({
    where: {
      questionText: { contains: marker },
      subject
    },
    select: { id: true }
  });

  for (const row of created) {
    fixture.questionIds.push(row.id);
  }
}

async function cleanupFixture(fixture: E2EFixture): Promise<void> {
  if (fixture.userIds.length > 0) {
    await prisma.exam.deleteMany({
      where: { userId: { in: fixture.userIds } }
    });
  }

  if (fixture.sessionIds.length > 0) {
    await prisma.userSession.deleteMany({
      where: { id: { in: fixture.sessionIds } }
    });
  }

  if (fixture.userIds.length > 0) {
    await prisma.idempotencyRecord.deleteMany({
      where: { userId: { in: fixture.userIds } }
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

describeE2E('Exam idempotency contract (HTTP e2e)', () => {
  it('replays the completed exam start response for same key and payload', async () => {
    const fixture: E2EFixture = {
      userIds: [],
      sessionIds: [],
      questionIds: []
    };

    const app = await buildApp();
    try {
      const user = await createUserFixture(fixture);
      const authHeader = await createAuthHeader(fixture, user);
      await createPracticeQuestions(fixture, 'Biology', 30);

      const idempotencyKey = uniqueToken('idem-exam-start');
      const payload = {
        examType: EXAM_TYPES.PRACTICE,
        subjects: ['Biology']
      };

      const first = await app.inject({
        method: 'POST',
        url: '/api/exams/start',
        headers: {
          authorization: authHeader,
          'idempotency-key': idempotencyKey
        },
        payload
      });

      const second = await app.inject({
        method: 'POST',
        url: '/api/exams/start',
        headers: {
          authorization: authHeader,
          'idempotency-key': idempotencyKey
        },
        payload
      });

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);

      const firstBody = first.json() as any;
      const secondBody = second.json() as any;
      expect(firstBody.data.examId).toBe(secondBody.data.examId);

      const scopeKey = buildScopeKeyFromExamType(EXAM_TYPES.PRACTICE, ['Biology']);
      const createdExams = await prisma.exam.count({
        where: {
          userId: user.id,
          nameScopeKey: scopeKey
        }
      });
      expect(createdExams).toBe(1);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  });

  it('rejects same key reuse when payload differs', async () => {
    const fixture: E2EFixture = {
      userIds: [],
      sessionIds: [],
      questionIds: []
    };

    const app = await buildApp();
    try {
      const user = await createUserFixture(fixture);
      const authHeader = await createAuthHeader(fixture, user);
      await createPracticeQuestions(fixture, 'Biology', 30);
      await createPracticeQuestions(fixture, 'Chemistry', 30);

      const idempotencyKey = uniqueToken('idem-exam-mismatch');

      const first = await app.inject({
        method: 'POST',
        url: '/api/exams/start',
        headers: {
          authorization: authHeader,
          'idempotency-key': idempotencyKey
        },
        payload: {
          examType: EXAM_TYPES.PRACTICE,
          subjects: ['Biology']
        }
      });

      const second = await app.inject({
        method: 'POST',
        url: '/api/exams/start',
        headers: {
          authorization: authHeader,
          'idempotency-key': idempotencyKey
        },
        payload: {
          examType: EXAM_TYPES.PRACTICE,
          subjects: ['Chemistry']
        }
      });

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(409);

      const secondBody = second.json() as any;
      expect(secondBody.error?.code).toBe('IDEMPOTENCY_KEY_REUSE_MISMATCH');

      const bioScope = buildScopeKeyFromExamType(EXAM_TYPES.PRACTICE, ['Biology']);
      const chemScope = buildScopeKeyFromExamType(EXAM_TYPES.PRACTICE, ['Chemistry']);

      const bioExams = await prisma.exam.count({
        where: {
          userId: user.id,
          nameScopeKey: bioScope
        }
      });

      const chemExams = await prisma.exam.count({
        where: {
          userId: user.id,
          nameScopeKey: chemScope
        }
      });

      expect(bioExams).toBe(1);
      expect(chemExams).toBe(0);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  });
});

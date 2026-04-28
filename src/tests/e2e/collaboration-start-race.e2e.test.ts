import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import prisma from '../../config/database';
import { generateTokens } from '../../shared/utils/jwt';
import { EXAM_TYPES } from '../../modules/exams/exams.constants';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeE2E = runIntegration ? describe : describe.skip;

interface E2EFixture {
  userIds: number[];
  sessionIds: string[];
  questionIds: number[];
  collabSessionIds: number[];
}

function uniqueToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

async function createUserFixture(fixture: E2EFixture, input: Partial<any> = {}) {
  const user = await prisma.user.create({
    data: {
      email: `${uniqueToken('e2e-user')}@example.com`,
      passwordHash: 'hashed-password',
      fullName: `E2E ${uniqueToken('user')}`,
      isVerified: true,
      isPremium: true,
      deviceAccessMode: 'PREMIUM',
      realExamsCompleted: 5,
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
        realExamsCompleted: input.realExamsCompleted ?? 5
      },
      update: {
        realExamsCompleted: input.realExamsCompleted ?? 5
      }
    });
  }

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

async function createQuestions(fixture: E2EFixture, subject: string, count: number): Promise<void> {
  const marker = uniqueToken('e2e-question');
  const rows = Array.from({ length: count }).map((_, index) => ({
    questionText: `${marker} ${subject} #${index}`,
    hasImage: false,
    optionA: 'Option A',
    optionB: 'Option B',
    optionC: 'Option C',
    optionD: 'Option D',
    correctAnswer: 'A',
    subject,
    topic: 'E2E',
    questionType: 'real_past_question'
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

async function createQuestionsBySource(
  fixture: E2EFixture,
  subject: string,
  questionType: 'real_past_question' | 'practice',
  count: number
): Promise<void> {
  const marker = uniqueToken(`e2e-${questionType}-${subject}`);
  const rows = Array.from({ length: count }).map((_, index) => ({
    questionText: `${marker} ${subject} #${index}`,
    hasImage: false,
    optionA: 'Option A',
    optionB: 'Option B',
    optionC: 'Option C',
    optionD: 'Option D',
    correctAnswer: 'A',
    subject,
    topic: 'E2E',
    questionType
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

  if (fixture.collabSessionIds.length > 0 || fixture.userIds.length > 0) {
    const filters: any[] = [];
    if (fixture.collabSessionIds.length > 0) filters.push({ sessionId: { in: fixture.collabSessionIds } });
    if (fixture.userIds.length > 0) filters.push({ userId: { in: fixture.userIds } });

    await prisma.sessionParticipant.deleteMany({
      where: { OR: filters }
    });
  }

  if (fixture.collabSessionIds.length > 0) {
    await prisma.collaborationSession.deleteMany({
      where: { id: { in: fixture.collabSessionIds } }
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

describeE2E('Collaboration start race (HTTP e2e)', () => {
  it('starts a room exactly once when host sends concurrent start requests', async () => {
    const fixture: E2EFixture = {
      userIds: [],
      sessionIds: [],
      questionIds: [],
      collabSessionIds: []
    };

    const app = await buildApp();

    try {
      const host = await createUserFixture(fixture);
      const joiner = await createUserFixture(fixture);
      const hostAuth = await createAuthHeader(fixture, host);
      const joinerAuth = await createAuthHeader(fixture, joiner);
      await createQuestions(fixture, 'Biology', 30);

      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/collaboration/create',
        headers: {
          authorization: hostAuth,
          'idempotency-key': uniqueToken('e2e-create')
        },
        payload: {
          sessionType: 'ONE_V_ONE_DUEL',
          subjects: ['Biology']
        }
      });

      expect(createResponse.statusCode).toBe(201);
      const createdBody = createResponse.json() as any;
      const sessionId = createdBody.data.session.id as number;
      const code = createdBody.data.session.code as string;
      fixture.collabSessionIds.push(sessionId);

      const joinResponse = await app.inject({
        method: 'POST',
        url: `/api/collaboration/code/${code}/join`,
        headers: {
          authorization: joinerAuth,
          'idempotency-key': uniqueToken('e2e-join')
        }
      });
      expect(joinResponse.statusCode).toBe(200);

      const [startOne, startTwo] = await Promise.all([
        app.inject({
          method: 'POST',
          url: `/api/collaboration/sessions/${sessionId}/start`,
          headers: {
            authorization: hostAuth,
            'idempotency-key': uniqueToken('e2e-start-a')
          }
        }),
        app.inject({
          method: 'POST',
          url: `/api/collaboration/sessions/${sessionId}/start`,
          headers: {
            authorization: hostAuth,
            'idempotency-key': uniqueToken('e2e-start-b')
          }
        })
      ]);

      const statusCodes = [startOne.statusCode, startTwo.statusCode].sort((a, b) => a - b);
      expect(statusCodes).toEqual([200, 409]);

      const refreshedSession = await prisma.collaborationSession.findUnique({
        where: { id: sessionId },
        select: { status: true }
      });
      expect(refreshedSession?.status).toBe('IN_PROGRESS');

      const examCount = await prisma.exam.count({
        where: {
          collaborationSessionId: sessionId,
          examType: EXAM_TYPES.ONE_V_ONE_DUEL as any
        }
      });
      expect(examCount).toBe(2);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('supports mixed collaboration question source and uses a fixed 90-minute timer', async () => {
    const fixture: E2EFixture = {
      userIds: [],
      sessionIds: [],
      questionIds: [],
      collabSessionIds: []
    };

    const app = await buildApp();

    try {
      const host = await createUserFixture(fixture);
      const joiner = await createUserFixture(fixture);
      const hostAuth = await createAuthHeader(fixture, host);
      const joinerAuth = await createAuthHeader(fixture, joiner);
      await createQuestionsBySource(fixture, 'Biology', 'real_past_question', 20);
      await createQuestionsBySource(fixture, 'Biology', 'practice', 20);

      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/collaboration/create',
        headers: {
          authorization: hostAuth,
          'idempotency-key': uniqueToken('e2e-create-mixed')
        },
        payload: {
          sessionType: 'ONE_V_ONE_DUEL',
          subjects: ['Biology'],
          questionSource: 'MIXED'
        }
      });

      expect(createResponse.statusCode).toBe(201);
      const createdBody = createResponse.json() as any;
      const sessionId = createdBody.data.session.id as number;
      const code = createdBody.data.session.code as string;
      fixture.collabSessionIds.push(sessionId);
      expect(createdBody.data.session.questionSource).toBe('MIXED');

      const joinResponse = await app.inject({
        method: 'POST',
        url: `/api/collaboration/code/${code}/join`,
        headers: {
          authorization: joinerAuth,
          'idempotency-key': uniqueToken('e2e-join-mixed')
        }
      });
      expect(joinResponse.statusCode).toBe(200);

      const startResponse = await app.inject({
        method: 'POST',
        url: `/api/collaboration/sessions/${sessionId}/start`,
        headers: {
          authorization: hostAuth,
          'idempotency-key': uniqueToken('e2e-start-mixed')
        }
      });

      expect(startResponse.statusCode).toBe(200);
      const startBody = startResponse.json() as any;
      expect(startBody.data.timeAllowedSeconds).toBe(90 * 60);
      expect(startBody.data.session.questionSource).toBe('MIXED');
      expect(startBody.data.questions).toHaveLength(25);

      const questionIds = startBody.data.questions.map((question: { id: number }) => question.id);
      const selectedQuestions = await prisma.question.findMany({
        where: { id: { in: questionIds } },
        select: { questionType: true }
      });

      const realCount = selectedQuestions.filter((question) => question.questionType === 'real_past_question').length;
      const practiceCount = selectedQuestions.filter((question) => question.questionType === 'practice').length;

      expect(realCount).toBe(13);
      expect(practiceCount).toBe(12);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);
});

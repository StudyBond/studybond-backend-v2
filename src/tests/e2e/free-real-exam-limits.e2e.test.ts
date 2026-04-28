import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import prisma from '../../config/database';
import { EXAM_TYPES } from '../../modules/exams/exams.constants';
import { QUESTION_POOLS } from '../../modules/questions/questions.constants';
import { generateTokens } from '../../shared/utils/jwt';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeE2E = runIntegration ? describe : describe.skip;

interface E2EFixture {
  institutionIds: number[];
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
      email: `${uniqueToken('e2e-free-exam-user')}@example.com`,
      passwordHash: 'hashed-password',
      fullName: `E2E Free Exam ${uniqueToken('user')}`,
      isVerified: true,
      isPremium: false,
      deviceAccessMode: 'FREE',
      realExamsCompleted: 0,
      ...input
    }
  });
  fixture.userIds.push(user.id);
  return user;
}

async function createInstitutionFixture(fixture: E2EFixture, label: string) {
  const code = `${label}-${randomUUID().slice(0, 8)}`.replace(/-/g, '').slice(0, 12).toUpperCase();
  const institution = await prisma.institution.create({
    data: {
      code,
      name: `${label} ${code}`,
      slug: `${label.toLowerCase()}-${code.toLowerCase()}`
    }
  });

  await prisma.institutionExamConfig.create({
    data: {
      institutionId: institution.id,
      trackCode: 'POST_UTME',
      trackName: 'Post-UTME',
      questionsPerSubject: 25,
      fullExamQuestions: 100,
      maxSubjects: 4,
      singleSubjectDurationSeconds: 22 * 60,
      twoSubjectDurationSeconds: 44 * 60,
      threeSubjectDurationSeconds: 66 * 60,
      fullExamDurationSeconds: 90 * 60,
      collaborationDurationSeconds: 90 * 60,
      freeRealExamCount: 1,
      freeFullRealTotalAttempts: 3,
      premiumDailyRealExamLimit: 5,
      collaborationGateRealExams: 2,
      defaultFullExamSource: 'REAL_PAST_QUESTION',
      defaultPartialExamSource: 'MIXED',
      defaultCollabSource: 'REAL_PAST_QUESTION',
      allowMixedPartialExams: true,
      allowMixedFullExams: false,
      allowPracticeCollaboration: true,
      allowMixedCollaboration: true
    }
  });

  fixture.institutionIds.push(institution.id);
  return institution;
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

async function createRealQuestions(
  fixture: E2EFixture,
  institutionId: number,
  subject: string,
  count: number,
  questionPool: string = QUESTION_POOLS.REAL_BANK,
  markerPrefix = `e2e-free-real-${subject}`
): Promise<string> {
  const marker = uniqueToken(markerPrefix);
  const rows = Array.from({ length: count }).map((_, index) => ({
    institutionId,
    questionText: `${marker} ${subject} #${index}`,
    hasImage: false,
    optionA: 'Option A',
    optionB: 'Option B',
    optionC: 'Option C',
    optionD: 'Option D',
    correctAnswer: 'A',
    subject,
    topic: 'E2E Free Exam',
    questionType: 'real_past_question',
    questionPool
  }));

  await prisma.question.createMany({ data: rows });

  const created = await prisma.question.findMany({
    where: {
      institutionId,
      questionText: { contains: marker },
      subject
    },
    select: { id: true }
  });

  for (const row of created) {
    fixture.questionIds.push(row.id);
  }

  return marker;
}

async function cleanupFixture(fixture: E2EFixture): Promise<void> {
  if (fixture.userIds.length > 0) {
    await prisma.exam.deleteMany({
      where: { userId: { in: fixture.userIds } }
    });

    await prisma.idempotencyRecord.deleteMany({
      where: { userId: { in: fixture.userIds } }
    });

    await prisma.examSessionCounter.deleteMany({
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

  if (fixture.institutionIds.length > 0) {
    await prisma.institution.deleteMany({
      where: { id: { in: fixture.institutionIds } }
    });
  }
}

function buildCorrectAnswers(questions: Array<{ id: number }>) {
  return questions.map((question) => ({
    questionId: question.id,
    answer: 'A',
    timeSpentSeconds: 1
  }));
}

describeE2E('Free-tier full real exam policy (HTTP e2e)', () => {
  it('blocks free users from starting subject-specific real exams', async () => {
    const fixture: E2EFixture = {
      institutionIds: [],
      userIds: [],
      sessionIds: [],
      questionIds: []
    };

    const app = await buildApp();
    try {
      const user = await createUserFixture(fixture);
      const authHeader = await createAuthHeader(fixture, user);

      const response = await app.inject({
        method: 'POST',
        url: '/api/exams/start',
        headers: {
          authorization: authHeader,
          'idempotency-key': uniqueToken('free-real-partial')
        },
        payload: {
          examType: EXAM_TYPES.REAL_PAST_QUESTION,
          subjects: ['Biology']
        }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual(expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: 'Free users can only take the full UI real exam. Upgrade to premium to unlock subject-specific real exams.'
        })
      }));
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  });

  it('lets a free user use the full real exam exactly 3 total times, then requires upgrade', async () => {
    const fixture: E2EFixture = {
      institutionIds: [],
      userIds: [],
      sessionIds: [],
      questionIds: []
    };

    const app = await buildApp();
    try {
      const institution = await createInstitutionFixture(fixture, 'FREEE2E');
      const user = await createUserFixture(fixture, {
        targetInstitutionId: institution.id
      });
      const authHeader = await createAuthHeader(fixture, user);
      const fullExamSubjects = ['Mathematics', 'English', 'Biology', 'Physics'] as const;
      const freeMarkers: string[] = [];
      const realUiMarkers: string[] = [];

      for (const subject of fullExamSubjects) {
        freeMarkers.push(await createRealQuestions(fixture, institution.id, subject, 25, QUESTION_POOLS.FREE_EXAM, `e2e-free-pool-${subject}`));
        realUiMarkers.push(await createRealQuestions(fixture, institution.id, subject, 25, QUESTION_POOLS.REAL_BANK, `e2e-real-pool-${subject}`));
      }

      const startResponse = await app.inject({
        method: 'POST',
        url: '/api/exams/start',
        headers: {
          authorization: authHeader,
          'idempotency-key': uniqueToken('free-full-start')
        },
        payload: {
          subjects: fullExamSubjects
        }
      });

      expect(startResponse.statusCode).toBe(201);
      const startedExam = startResponse.json() as any;
      expect(startedExam.data.examType).toBe(EXAM_TYPES.REAL_PAST_QUESTION);
      expect(startedExam.data.questions).toHaveLength(100);
      expect(
        startedExam.data.questions.every((question: any) =>
          freeMarkers.some((marker) => question.questionText.includes(marker))
        )
      ).toBe(true);
      expect(
        startedExam.data.questions.some((question: any) =>
          realUiMarkers.some((marker) => question.questionText.includes(marker))
        )
      ).toBe(false);

      const submitOriginal = await app.inject({
        method: 'POST',
        url: `/api/exams/${startedExam.data.examId}/submit`,
        headers: {
          authorization: authHeader,
          'idempotency-key': uniqueToken('free-full-submit-1')
        },
        payload: {
          answers: buildCorrectAnswers(startedExam.data.questions)
        }
      });

      expect(submitOriginal.statusCode).toBe(200);

      const firstRetake = await app.inject({
        method: 'POST',
        url: `/api/exams/${startedExam.data.examId}/retake`,
        headers: {
          authorization: authHeader,
          'idempotency-key': uniqueToken('free-full-retake-1')
        }
      });

      expect(firstRetake.statusCode).toBe(201);
      const firstRetakeBody = firstRetake.json() as any;
      expect(firstRetakeBody.data.attemptNumber).toBeUndefined();

      const submitFirstRetake = await app.inject({
        method: 'POST',
        url: `/api/exams/${firstRetakeBody.data.examId}/submit`,
        headers: {
          authorization: authHeader,
          'idempotency-key': uniqueToken('free-full-submit-2')
        },
        payload: {
          answers: buildCorrectAnswers(firstRetakeBody.data.questions)
        }
      });

      expect(submitFirstRetake.statusCode).toBe(200);

      const secondRetake = await app.inject({
        method: 'POST',
        url: `/api/exams/${firstRetakeBody.data.examId}/retake`,
        headers: {
          authorization: authHeader,
          'idempotency-key': uniqueToken('free-full-retake-2')
        }
      });

      expect(secondRetake.statusCode).toBe(201);
      const secondRetakeBody = secondRetake.json() as any;

      const submitSecondRetake = await app.inject({
        method: 'POST',
        url: `/api/exams/${secondRetakeBody.data.examId}/submit`,
        headers: {
          authorization: authHeader,
          'idempotency-key': uniqueToken('free-full-submit-3')
        },
        payload: {
          answers: buildCorrectAnswers(secondRetakeBody.data.questions)
        }
      });

      expect(submitSecondRetake.statusCode).toBe(200);

      const thirdRetake = await app.inject({
        method: 'POST',
        url: `/api/exams/${secondRetakeBody.data.examId}/retake`,
        headers: {
          authorization: authHeader,
          'idempotency-key': uniqueToken('free-full-retake-3')
        }
      });

      expect(thirdRetake.statusCode).toBe(403);
      expect(thirdRetake.json()).toEqual(expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'EXAM_FREE_LIMIT_REACHED',
          message: 'You have used all 3 attempts on your free full UI exam. Upgrade to premium to continue.'
        })
      }));
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 180000);
});

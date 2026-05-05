import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import prisma from '../../config/database';
import { EXAM_CONFIG, EXAM_TYPES } from '../../modules/exams/exams.constants';
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
      email: `${uniqueToken('e2e-exam-user')}@example.com`,
      passwordHash: 'hashed-password',
      fullName: `E2E Start Defaults ${uniqueToken('user')}`,
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
      freeQuestionsPerSubject: 25,
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

async function createQuestions(
  fixture: E2EFixture,
  institutionId: number,
  subject: string,
  questionType: 'real_past_question' | 'practice',
  count: number
): Promise<void> {
  const marker = uniqueToken(`e2e-${questionType}-${subject}`);
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
    topic: 'E2E Start Defaults',
    questionType,
    questionPool:
      questionType === 'practice'
        ? QUESTION_POOLS.PRACTICE
        : QUESTION_POOLS.REAL_BANK
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

describeE2E('Exam start defaults (HTTP e2e)', () => {
  it('defaults single-subject exams to MIXED with a 13/12 source split and 22-minute timer', async () => {
    const fixture: E2EFixture = {
      institutionIds: [],
      userIds: [],
      sessionIds: [],
      questionIds: []
    };

    const app = await buildApp();
    try {
      const institution = await createInstitutionFixture(fixture, 'STARTDEFAULTS');
      const user = await createUserFixture(fixture, {
        targetInstitutionId: institution.id
      });
      const authHeader = await createAuthHeader(fixture, user);
      await createQuestions(fixture, institution.id, 'Biology', 'real_past_question', 20);
      await createQuestions(fixture, institution.id, 'Biology', 'practice', 20);

      const response = await app.inject({
        method: 'POST',
        url: '/api/exams/start',
        headers: {
          authorization: authHeader,
          'idempotency-key': uniqueToken('start-default-mixed')
        },
        payload: {
          subjects: ['Biology']
        }
      });

      expect(response.statusCode).toBe(201);
      const body = response.json() as any;
      expect(body.data.examType).toBe(EXAM_TYPES.MIXED);
      expect(body.data.totalQuestions).toBe(25);
      expect(body.data.timeAllowedSeconds).toBe(EXAM_CONFIG.SINGLE_SUBJECT_DURATION_SECONDS);
      expect(body.data.displayNameShort).toBe('UI Mix • BIO • S001');

      const questionIds = body.data.questions.map((question: { id: number }) => question.id);
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
  });

  it('defaults full exams to real UI questions only with a 90-minute timer', async () => {
    const fixture: E2EFixture = {
      institutionIds: [],
      userIds: [],
      sessionIds: [],
      questionIds: []
    };

    const app = await buildApp();
    try {
      const institution = await createInstitutionFixture(fixture, 'FULLDEFAULTS');
      const user = await createUserFixture(fixture, {
        targetInstitutionId: institution.id
      });
      const authHeader = await createAuthHeader(fixture, user);
      const fullExamSubjects = ['Mathematics', 'English', 'Biology', 'Physics'] as const;

      for (const subject of fullExamSubjects) {
        await createQuestions(fixture, institution.id, subject, 'real_past_question', 30);
      }

      const response = await app.inject({
        method: 'POST',
        url: '/api/exams/start',
        headers: {
          authorization: authHeader,
          'idempotency-key': uniqueToken('start-default-full')
        },
        payload: {
          subjects: fullExamSubjects
        }
      });

      expect(response.statusCode).toBe(201);
      const body = response.json() as any;
      expect(body.data.examType).toBe(EXAM_TYPES.REAL_PAST_QUESTION);
      expect(body.data.totalQuestions).toBe(100);
      expect(body.data.timeAllowedSeconds).toBe(EXAM_CONFIG.FULL_EXAM_DURATION_SECONDS);
      expect(body.data.displayNameShort).toBe('UI Real • Full • S001');

      const questionIds = body.data.questions.map((question: { id: number }) => question.id);
      const selectedQuestions = await prisma.question.findMany({
        where: { id: { in: questionIds } },
        select: { questionType: true }
      });

      expect(selectedQuestions).toHaveLength(100);
      expect(selectedQuestions.every((question) => question.questionType === 'real_past_question')).toBe(true);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  });
});

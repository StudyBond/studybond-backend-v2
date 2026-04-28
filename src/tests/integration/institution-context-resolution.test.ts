import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import prisma from '../../config/database';
import { QuestionsService } from '../../modules/questions/questions.service';
import { ExamsService } from '../../modules/exams/exams.service';
import { CollaborationService } from '../../modules/collaboration/collaboration.service';
import { SessionManager } from '../../modules/collaboration/session-manager';
import { MetricsRegistry } from '../../shared/metrics/registry';
import { COLLAB_QUESTION_SOURCE, COLLAB_SESSION_TYPE } from '../../modules/collaboration/collaboration.constants';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

interface FixtureState {
  institutionIds: number[];
  userIds: number[];
  questionIds: number[];
  sessionIds: number[];
}

function createFixtureState(): FixtureState {
  return {
    institutionIds: [],
    userIds: [],
    questionIds: [],
    sessionIds: []
  };
}

function uniqueToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function uniqueInstitutionCode(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, '').slice(0, 5)}`.toUpperCase();
}

function createServiceAppStub(): FastifyInstance {
  const metrics = new MetricsRegistry();
  return {
    log: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined
    },
    metrics
  } as unknown as FastifyInstance;
}

async function createInstitution(fixture: FixtureState, label: string) {
  const code = uniqueInstitutionCode(label);
  const institution = await prisma.institution.create({
    data: {
      code,
      name: `${label} Institution ${code}`,
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
      allowMixedCollaboration: true,
      additionalRules: { source: 'integration-test' }
    }
  });

  fixture.institutionIds.push(institution.id);
  return institution;
}

async function createUser(
  fixture: FixtureState,
  input: Partial<{
    targetInstitutionId: number;
    isPremium: boolean;
    realExamsCompleted: number;
  }> = {}
) {
  const user = await prisma.user.create({
    data: {
      email: `${uniqueToken('inst-user')}@example.com`,
      passwordHash: 'hashed-password',
      fullName: `Institution Context ${uniqueToken('user')}`,
      isVerified: true,
      isPremium: input.isPremium ?? true,
      realExamsCompleted: input.realExamsCompleted ?? 5,
      targetInstitutionId: input.targetInstitutionId
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

async function createRealQuestions(
  fixture: FixtureState,
  institutionId: number,
  subject: string,
  count: number,
  marker: string
) {
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
    topic: 'Institution Test',
    questionType: 'real_past_question',
    questionPool: 'REAL_BANK'
  }));

  await prisma.question.createMany({ data: rows });

  const created = await prisma.question.findMany({
    where: {
      institutionId,
      questionText: {
        contains: marker
      }
    },
    select: { id: true }
  });

  fixture.questionIds.push(...created.map((row) => row.id));
}

async function createFreeExamQuestions(
  fixture: FixtureState,
  institutionId: number,
  subject: string,
  count: number,
  marker: string
) {
  const rows = Array.from({ length: count }).map((_, index) => ({
    institutionId,
    questionText: `${marker} ${subject} free #${index}`,
    hasImage: false,
    optionA: 'Option A',
    optionB: 'Option B',
    optionC: 'Option C',
    optionD: 'Option D',
    correctAnswer: 'A',
    subject,
    topic: 'Institution Test',
    questionType: 'real_past_question',
    questionPool: 'FREE_EXAM'
  }));

  await prisma.question.createMany({ data: rows });

  const created = await prisma.question.findMany({
    where: {
      institutionId,
      questionText: {
        contains: marker
      }
    },
    select: { id: true }
  });

  fixture.questionIds.push(...created.map((row) => row.id));
}

async function createPracticeQuestions(
  fixture: FixtureState,
  institutionId: number,
  subject: string,
  count: number,
  marker: string
) {
  const rows = Array.from({ length: count }).map((_, index) => ({
    institutionId,
    questionText: `${marker} ${subject} practice #${index}`,
    hasImage: false,
    optionA: 'Option A',
    optionB: 'Option B',
    optionC: 'Option C',
    optionD: 'Option D',
    correctAnswer: 'A',
    subject,
    topic: 'Institution Test',
    questionType: 'practice',
    questionPool: 'PRACTICE'
  }));

  await prisma.question.createMany({ data: rows });

  const created = await prisma.question.findMany({
    where: {
      institutionId,
      questionText: {
        contains: marker
      }
    },
    select: { id: true }
  });

  fixture.questionIds.push(...created.map((row) => row.id));
}

async function cleanupFixture(fixture: FixtureState): Promise<void> {
  if (fixture.userIds.length > 0 || fixture.sessionIds.length > 0) {
    const exams = await prisma.exam.findMany({
      where: {
        OR: [
          fixture.userIds.length > 0 ? { userId: { in: fixture.userIds } } : undefined,
          fixture.sessionIds.length > 0 ? { collaborationSessionId: { in: fixture.sessionIds } } : undefined
        ].filter(Boolean) as any[]
      },
      select: { id: true }
    });

    if (exams.length > 0) {
      await prisma.examAnswer.deleteMany({
        where: {
          examId: { in: exams.map((exam) => exam.id) }
        }
      });

      await prisma.exam.deleteMany({
        where: {
          id: { in: exams.map((exam) => exam.id) }
        }
      });
    }
  }

  if (fixture.sessionIds.length > 0 || fixture.userIds.length > 0) {
    const filters: any[] = [];
    if (fixture.sessionIds.length > 0) {
      filters.push({ sessionId: { in: fixture.sessionIds } });
    }
    if (fixture.userIds.length > 0) {
      filters.push({ userId: { in: fixture.userIds } });
    }

    if (filters.length > 0) {
      await prisma.sessionParticipant.deleteMany({
        where: {
          OR: filters
        }
      });
    }
  }

  if (fixture.sessionIds.length > 0) {
    await prisma.collaborationSession.deleteMany({
      where: {
        id: { in: fixture.sessionIds }
      }
    });
  }

  if (fixture.userIds.length > 0) {
    await prisma.examSessionCounter.deleteMany({
      where: { userId: { in: fixture.userIds } }
    });
    await prisma.collaborationSessionCounter.deleteMany({
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

describeIntegration('Institution context resolution', () => {
  it('scopes FREE_EXAM question capacity per institution instead of globally', async () => {
    const fixture = createFixtureState();
    const service = new QuestionsService();

    try {
      const oau = await createInstitution(fixture, 'OAU');
      const unilag = await createInstitution(fixture, 'UNILAG');

      await createFreeExamQuestions(fixture, oau.id, 'Physics', 25, uniqueToken('oau-free'));

      await expect(service.createQuestion({
        institutionCode: oau.code,
        questionText: `Overflow ${uniqueToken('oau-overflow')}`,
        optionA: 'A',
        optionB: 'B',
        optionC: 'C',
        optionD: 'D',
        correctAnswer: 'A',
        subject: 'Physics',
        topic: 'Institution Scope',
        questionType: 'REAL_PAST_QUESTION',
        questionPool: 'FREE_EXAM'
      })).rejects.toMatchObject({
        code: 'QUESTION_FREE_POOL_FULL'
      });

      const created = await service.createQuestion({
        institutionCode: unilag.code,
        questionText: `Fresh ${uniqueToken('unilag-free')}`,
        optionA: 'A',
        optionB: 'B',
        optionC: 'C',
        optionD: 'D',
        correctAnswer: 'A',
        subject: 'Physics',
        topic: 'Institution Scope',
        questionType: 'REAL_PAST_QUESTION',
        questionPool: 'FREE_EXAM'
      });

      expect(created.institutionCode).toBe(unilag.code);
    } finally {
      await cleanupFixture(fixture);
    }
  }, 120000);

  it('uses the user target institution when starting an exam without an explicit institution code', async () => {
    const fixture = createFixtureState();
    const service = new ExamsService();

    try {
      const oau = await createInstitution(fixture, 'OAU');
      const unilag = await createInstitution(fixture, 'UNILAG');
      const user = await createUser(fixture, {
        targetInstitutionId: oau.id,
        isPremium: true
      });

      await createRealQuestions(fixture, oau.id, 'Biology', 25, uniqueToken('oau-real'));
      await createRealQuestions(fixture, unilag.id, 'Biology', 25, uniqueToken('unilag-real'));

      const started = await service.startExam(user.id, {
        examType: 'REAL_PAST_QUESTION' as any,
        subjects: ['Biology'] as any
      });

      const createdExam = await prisma.exam.findUniqueOrThrow({
        where: { id: started.examId },
        select: {
          institutionId: true,
          examAnswers: {
            select: {
              question: {
                select: {
                  institutionId: true
                }
              }
            }
          }
        }
      });

      expect(createdExam.institutionId).toBe(oau.id);
      expect(createdExam.examAnswers).toHaveLength(25);
      expect(createdExam.examAnswers.every((row) => row.question.institutionId === oau.id)).toBe(true);
    } finally {
      await cleanupFixture(fixture);
    }
  }, 120000);

  it('uses institution exam config defaults and timing for solo exams', async () => {
    const fixture = createFixtureState();
    const service = new ExamsService();

    try {
      const oau = await createInstitution(fixture, 'OAUCFG');
      const user = await createUser(fixture, {
        targetInstitutionId: oau.id,
        isPremium: true
      });

      await prisma.institutionExamConfig.updateMany({
        where: {
          institutionId: oau.id,
          trackCode: 'POST_UTME'
        },
        data: {
          defaultPartialExamSource: 'PRACTICE',
          singleSubjectDurationSeconds: 30 * 60
        }
      });

      await createPracticeQuestions(fixture, oau.id, 'Biology', 25, uniqueToken('oau-practice'));

      const started = await service.startExam(user.id, {
        subjects: ['Biology']
      });

      const createdExam = await prisma.exam.findUniqueOrThrow({
        where: { id: started.examId },
        select: {
          institutionId: true,
          examType: true,
          examAnswers: {
            select: {
              question: {
                select: {
                  institutionId: true,
                  questionPool: true,
                  questionType: true
                }
              }
            }
          }
        }
      });

      expect(started.timeAllowedSeconds).toBe(30 * 60);
      expect(createdExam.institutionId).toBe(oau.id);
      expect(createdExam.examType).toBe('PRACTICE');
      expect(createdExam.examAnswers).toHaveLength(25);
      expect(
        createdExam.examAnswers.every((row) =>
          row.question.institutionId === oau.id &&
          row.question.questionPool === 'PRACTICE' &&
          row.question.questionType === 'practice'
        )
      ).toBe(true);
    } finally {
      await cleanupFixture(fixture);
    }
  }, 120000);

  it('dual-writes institution-scoped stats when an exam is submitted', async () => {
    const fixture = createFixtureState();
    const service = new ExamsService();

    try {
      const oau = await createInstitution(fixture, 'OAUSTATS');
      const user = await createUser(fixture, {
        targetInstitutionId: oau.id,
        isPremium: true,
        realExamsCompleted: 0
      });

      await createPracticeQuestions(fixture, oau.id, 'Biology', 25, uniqueToken('oau-stats-practice'));

      const started = await service.startExam(user.id, {
        institutionCode: oau.code,
        examType: 'PRACTICE' as any,
        subjects: ['Biology'] as any
      });

      const result = await service.submitExam(user.id, started.examId, {
        answers: started.questions.map((question) => ({
          questionId: question.id,
          answer: 'A',
          timeSpentSeconds: 12
        }))
      });

      const scopedStats = await prisma.userInstitutionStats.findUniqueOrThrow({
        where: {
          userId_institutionId: {
            userId: user.id,
            institutionId: oau.id
          }
        },
        select: {
          institutionId: true,
          weeklySp: true,
          totalSp: true,
          realExamsCompleted: true,
          practiceExamsCompleted: true,
          completedCollaborationExams: true,
          lastExamAt: true
        }
      });

      const refreshedUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          weeklySp: true,
          totalSp: true
        }
      });

      expect(result.stats.weeklySp).toBe(result.spEarned);
      expect(result.stats.totalSp).toBe(result.spEarned);
      expect(scopedStats.institutionId).toBe(oau.id);
      expect(scopedStats.weeklySp).toBe(result.spEarned);
      expect(scopedStats.totalSp).toBe(result.spEarned);
      expect(scopedStats.realExamsCompleted).toBe(0);
      expect(scopedStats.practiceExamsCompleted).toBe(1);
      expect(scopedStats.completedCollaborationExams).toBe(0);
      expect(scopedStats.lastExamAt).not.toBeNull();
      expect(refreshedUser.weeklySp).toBe(result.spEarned);
      expect(refreshedUser.totalSp).toBe(result.spEarned);
    } finally {
      await cleanupFixture(fixture);
    }
  }, 120000);

  it('uses institution exam config defaults and timing for collaboration sessions', async () => {
    const fixture = createFixtureState();
    const app = createServiceAppStub();
    const manager = new SessionManager(app);
    const service = new CollaborationService(app, manager);

    try {
      const unilag = await createInstitution(fixture, 'UNILAGCFG');
      const host = await createUser(fixture, {
        targetInstitutionId: unilag.id,
        isPremium: true,
        realExamsCompleted: 5
      });
      const opponent = await createUser(fixture, {
        targetInstitutionId: unilag.id,
        isPremium: true,
        realExamsCompleted: 5
      });

      await prisma.institutionExamConfig.updateMany({
        where: {
          institutionId: unilag.id,
          trackCode: 'POST_UTME'
        },
        data: {
          defaultCollabSource: 'PRACTICE',
          collaborationDurationSeconds: 45 * 60
        }
      });

      await createPracticeQuestions(fixture, unilag.id, 'Biology', 25, uniqueToken('unilag-practice'));

      const created = await service.createSession(
        host.id,
        {
          sessionType: COLLAB_SESSION_TYPE.ONE_V_ONE_DUEL as any,
          subjects: ['Biology']
        },
        uniqueToken('collab-config-create')
      );
      fixture.sessionIds.push(created.session.id);

      await service.joinSession(opponent.id, created.session.code, uniqueToken('collab-config-join'));
      const started = await service.startSession(host.id, created.session.id, uniqueToken('collab-config-start'));

      const session = await prisma.collaborationSession.findUniqueOrThrow({
        where: { id: created.session.id },
        select: {
          institutionId: true,
          questionSource: true
        }
      });

      const exams = await prisma.exam.findMany({
        where: {
          collaborationSessionId: created.session.id
        },
        select: {
          institutionId: true,
          examAnswers: {
            select: {
              question: {
                select: {
                  institutionId: true,
                  questionPool: true,
                  questionType: true
                }
              }
            }
          }
        }
      });

      expect(session.institutionId).toBe(unilag.id);
      expect(session.questionSource).toBe('PRACTICE');
      expect(started.timeAllowedSeconds).toBe(45 * 60);
      expect(exams).toHaveLength(2);
      expect(
        exams.every((exam) =>
          exam.institutionId === unilag.id &&
          exam.examAnswers.every((answer) =>
            answer.question.institutionId === unilag.id &&
            answer.question.questionPool === 'PRACTICE' &&
            answer.question.questionType === 'practice'
          )
        )
      ).toBe(true);
    } finally {
      await manager.close();
      await cleanupFixture(fixture);
    }
  }, 120000);

  it('uses institution-scoped real exam counts for collaboration eligibility', async () => {
    const fixture = createFixtureState();
    const app = createServiceAppStub();
    const manager = new SessionManager(app);
    const service = new CollaborationService(app, manager);

    try {
      const oau = await createInstitution(fixture, 'OAUELIG');
      const unilag = await createInstitution(fixture, 'UNILAGELIG');
      const host = await createUser(fixture, {
        targetInstitutionId: oau.id,
        isPremium: true,
        realExamsCompleted: 0
      });

      await prisma.userInstitutionStats.upsert({
        where: {
          userId_institutionId: {
            userId: host.id,
            institutionId: oau.id
          }
        },
        create: {
          userId: host.id,
          institutionId: oau.id,
          realExamsCompleted: 2
        },
        update: {
          realExamsCompleted: 2
        }
      });

      const created = await service.createSession(
        host.id,
        {
          sessionType: COLLAB_SESSION_TYPE.ONE_V_ONE_DUEL as any,
          subjects: ['Biology']
        },
        uniqueToken('collab-elig-target')
      );
      fixture.sessionIds.push(created.session.id);
      expect(created.session.id).toBeGreaterThan(0);

      await expect(
        service.createSession(
          host.id,
          {
            sessionType: COLLAB_SESSION_TYPE.ONE_V_ONE_DUEL as any,
            institutionCode: unilag.code,
            subjects: ['Biology']
          },
          uniqueToken('collab-elig-explicit')
        )
      ).rejects.toMatchObject({
        statusCode: 403
      });
    } finally {
      await manager.close();
      await cleanupFixture(fixture);
    }
  }, 120000);

  it('lets collaboration use an explicit institution override and keeps questions and exams inside that institution', async () => {
    const fixture = createFixtureState();
    const app = createServiceAppStub();
    const manager = new SessionManager(app);
    const service = new CollaborationService(app, manager);

    try {
      const oau = await createInstitution(fixture, 'OAU');
      const unilag = await createInstitution(fixture, 'UNILAG');
      const host = await createUser(fixture, {
        targetInstitutionId: oau.id,
        isPremium: true,
        realExamsCompleted: 5
      });
      const opponent = await createUser(fixture, {
        targetInstitutionId: oau.id,
        isPremium: true,
        realExamsCompleted: 5
      });

      await prisma.userInstitutionStats.upsert({
        where: {
          userId_institutionId: {
            userId: host.id,
            institutionId: unilag.id
          }
        },
        create: {
          userId: host.id,
          institutionId: unilag.id,
          realExamsCompleted: 5
        },
        update: {
          realExamsCompleted: 5
        }
      });

      await prisma.userInstitutionStats.upsert({
        where: {
          userId_institutionId: {
            userId: opponent.id,
            institutionId: unilag.id
          }
        },
        create: {
          userId: opponent.id,
          institutionId: unilag.id,
          realExamsCompleted: 5
        },
        update: {
          realExamsCompleted: 5
        }
      });

      await createRealQuestions(fixture, unilag.id, 'Biology', 25, uniqueToken('unilag-collab'));

      const created = await service.createSession(
        host.id,
        {
          sessionType: COLLAB_SESSION_TYPE.ONE_V_ONE_DUEL as any,
          institutionCode: unilag.code,
          subjects: ['Biology'],
          questionSource: COLLAB_QUESTION_SOURCE.REAL_PAST_QUESTION
        },
        uniqueToken('collab-create')
      );
      fixture.sessionIds.push(created.session.id);

      await service.joinSession(opponent.id, created.session.code, uniqueToken('collab-join'));
      const started = await service.startSession(host.id, created.session.id, uniqueToken('collab-start'));

      const session = await prisma.collaborationSession.findUniqueOrThrow({
        where: { id: created.session.id },
        select: { institutionId: true }
      });

      const exams = await prisma.exam.findMany({
        where: {
          collaborationSessionId: created.session.id
        },
        select: {
          institutionId: true,
          examAnswers: {
            select: {
              question: {
                select: {
                  institutionId: true
                }
              }
            }
          }
        }
      });

      expect(session.institutionId).toBe(unilag.id);
      expect(started.questions).toHaveLength(25);
      expect(exams).toHaveLength(2);
      expect(exams.every((exam) => exam.institutionId === unilag.id)).toBe(true);
      expect(
        exams.every((exam) => exam.examAnswers.every((answer) => answer.question.institutionId === unilag.id))
      ).toBe(true);
    } finally {
      await manager.close();
      await cleanupFixture(fixture);
    }
  }, 120000);
});

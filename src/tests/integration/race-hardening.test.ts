import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import prisma from '../../config/database';
import { ExamsService } from '../../modules/exams/exams.service';
import { EXAM_STATUS, EXAM_TYPES } from '../../modules/exams/exams.constants';
import { CollaborationService } from '../../modules/collaboration/collaboration.service';
import { SessionManager } from '../../modules/collaboration/session-manager';
import { COLLAB_QUESTION_SOURCE, COLLAB_SESSION_STATUS, COLLAB_SESSION_TYPE, PARTICIPANT_STATE } from '../../modules/collaboration/collaboration.constants';
import { buildScopeKeyFromExamType } from '../../shared/utils/examNaming';
import { MetricsRegistry } from '../../shared/metrics/registry';
import { addLagosDateDays, getLagosDateValue } from '../../shared/streaks/domain';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

interface FixtureState {
  userIds: number[];
  questionIds: number[];
  sessionIds: number[];
}

function createFixtureState(): FixtureState {
  return {
    userIds: [],
    questionIds: [],
    sessionIds: []
  };
}

function uniqueToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function uniqueSessionCode(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, '').slice(0, 8)}`.toUpperCase();
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

async function createUser(fixture: FixtureState, input: Partial<any> = {}) {
  const user = await prisma.user.create({
    data: {
      email: `${uniqueToken('itest-user')}@example.com`,
      passwordHash: 'hashed-password',
      fullName: `Integration ${uniqueToken('user')}`,
      isVerified: true,
      isPremium: true,
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

async function createRealPastQuestions(
  fixture: FixtureState,
  subject: string,
  count: number
) {
  const marker = uniqueToken('itest-question');
  const rows = Array.from({ length: count }).map((_, index) => ({
    questionText: `${marker} ${subject} #${index}`,
    hasImage: false,
    optionA: 'Option A',
    optionB: 'Option B',
    optionC: 'Option C',
    optionD: 'Option D',
    correctAnswer: 'A',
    subject,
    topic: 'Integration',
    questionType: 'real_past_question'
  }));

  await prisma.question.createMany({
    data: rows
  });

  const created = await prisma.question.findMany({
    where: {
      questionText: {
        contains: marker
      },
      subject
    },
    select: { id: true }
  });

  for (const row of created) {
    fixture.questionIds.push(row.id);
  }

  return created;
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

  if (fixture.questionIds.length > 0) {
    await prisma.examAnswer.deleteMany({
      where: {
        questionId: { in: fixture.questionIds }
      }
    });
  }

  if (fixture.sessionIds.length > 0 || fixture.userIds.length > 0) {
    const filters: any[] = [];
    if (fixture.sessionIds.length > 0) {
      filters.push({ sessionId: { in: fixture.sessionIds } });
    }
    if (fixture.userIds.length > 0) {
      filters.push({ userId: { in: fixture.userIds } });
    }

    await prisma.sessionParticipant.deleteMany({
      where: {
        OR: filters
      }
    });
  }

  if (fixture.sessionIds.length > 0) {
    await prisma.collaborationSession.deleteMany({
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

    await prisma.leaderboardProjectionEvent.deleteMany({
      where: {
        userId: { in: fixture.userIds }
      }
    });

    await prisma.leaderboardIntegritySignal.deleteMany({
      where: {
        userId: { in: fixture.userIds }
      }
    });

    await prisma.weeklyLeaderboard.deleteMany({
      where: {
        userId: { in: fixture.userIds }
      }
    });

    await prisma.examSessionCounter.deleteMany({
      where: {
        userId: { in: fixture.userIds }
      }
    });

    await prisma.collaborationSessionCounter.deleteMany({
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

  if (fixture.questionIds.length > 0) {
    await prisma.question.deleteMany({
      where: {
        id: { in: fixture.questionIds }
      }
    });
  }
}

describeIntegration('DB-backed race hardening', () => {
  it('finalizes exam submission exactly once under concurrent submit race', async () => {
    const fixture = createFixtureState();
    try {
      const user = await createUser(fixture, {
        isPremium: false,
        realExamsCompleted: 0
      });
      const [question] = await createRealPastQuestions(fixture, 'Biology', 1);

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
            timeSpentSeconds: 2
          }
        ]
      };

      const [first, second] = await Promise.allSettled([
        service.submitExam(user.id, exam.id, payload as any, uniqueToken('submit-a')),
        service.submitExam(user.id, exam.id, payload as any, uniqueToken('submit-b'))
      ]);

      const successes = [first, second].filter((item) => item.status === 'fulfilled');
      const failures = [first, second].filter((item) => item.status === 'rejected') as Array<PromiseRejectedResult>;

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect((failures[0].reason as any).code).toBe('EXAM_ALREADY_COMPLETED');

      const refreshedExam = await prisma.exam.findUnique({ where: { id: exam.id } });
      expect(refreshedExam?.status).toBe(EXAM_STATUS.COMPLETED);

      const refreshedUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { totalSp: true, realExamsCompleted: true }
      });
      expect(refreshedUser?.totalSp).toBe(1);
      expect(refreshedUser?.realExamsCompleted).toBe(1);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it('awards and consumes streak freezers correctly during real exam submission', async () => {
    const fixture = createFixtureState();
    try {
      const today = getLagosDateValue(new Date());
      const yesterday = addLagosDateDays(today, -1);
      const twoDaysAgo = addLagosDateDays(today, -2);

      const milestoneUser = await createUser(fixture, {
        isPremium: false,
        realExamsCompleted: 0,
        currentStreak: 6,
        longestStreak: 6,
        lastActivityDate: yesterday,
        streakFreezesAvailable: 0
      });
      const returningUser = await createUser(fixture, {
        isPremium: false,
        realExamsCompleted: 0,
        currentStreak: 8,
        longestStreak: 10,
        lastActivityDate: twoDaysAgo,
        streakFreezesAvailable: 1
      });

      const [milestoneQuestion] = await createRealPastQuestions(fixture, 'Biology', 1);
      const [returnQuestion] = await createRealPastQuestions(fixture, 'Chemistry', 1);

      const milestoneExam = await prisma.exam.create({
        data: {
          userId: milestoneUser.id,
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

      const returnExam = await prisma.exam.create({
        data: {
          userId: returningUser.id,
          examType: EXAM_TYPES.REAL_PAST_QUESTION as any,
          nameScopeKey: 'REAL:CHM',
          sessionNumber: 1,
          subjectsIncluded: ['Chemistry'],
          totalQuestions: 1,
          score: 0,
          percentage: 0,
          spEarned: 0,
          status: EXAM_STATUS.IN_PROGRESS as any,
          startedAt: new Date()
        }
      });

      await prisma.examAnswer.createMany({
        data: [
          {
            examId: milestoneExam.id,
            questionId: milestoneQuestion.id,
            userAnswer: null,
            isCorrect: false,
            timeSpentSeconds: 0
          },
          {
            examId: returnExam.id,
            questionId: returnQuestion.id,
            userAnswer: null,
            isCorrect: false,
            timeSpentSeconds: 0
          }
        ]
      });

      const service = new ExamsService();

      await service.submitExam(milestoneUser.id, milestoneExam.id, {
        answers: [
          {
            questionId: milestoneQuestion.id,
            answer: 'A',
            timeSpentSeconds: 2
          }
        ]
      } as any, uniqueToken('streak-freezer-award'));

      await service.submitExam(returningUser.id, returnExam.id, {
        answers: [
          {
            questionId: returnQuestion.id,
            answer: 'A',
            timeSpentSeconds: 3
          }
        ]
      } as any, uniqueToken('streak-freezer-consume'));

      const [refreshedMilestoneUser, refreshedReturningUser] = await Promise.all([
        prisma.user.findUnique({
          where: { id: milestoneUser.id },
          select: {
            currentStreak: true,
            longestStreak: true,
            streakFreezesAvailable: true,
            lastActivityDate: true
          }
        }),
        prisma.user.findUnique({
          where: { id: returningUser.id },
          select: {
            currentStreak: true,
            longestStreak: true,
            streakFreezesAvailable: true,
            lastActivityDate: true
          }
        })
      ]);

      expect(refreshedMilestoneUser).toEqual(expect.objectContaining({
        currentStreak: 7,
        longestStreak: 7,
        streakFreezesAvailable: 1,
        lastActivityDate: today
      }));

      expect(refreshedReturningUser).toEqual(expect.objectContaining({
        currentStreak: 9,
        longestStreak: 10,
        streakFreezesAvailable: 0,
        lastActivityDate: today
      }));
    } finally {
      await cleanupFixture(fixture);
    }
  }, 120000);

  it('counts a 1v1 duel exam toward the user streak through the shared submit path', async () => {
    const fixture = createFixtureState();
    try {
      const yesterday = addLagosDateDays(getLagosDateValue(new Date()), -1);
      const duelUser = await createUser(fixture, {
        currentStreak: 4,
        longestStreak: 6,
        lastActivityDate: yesterday,
        streakFreezesAvailable: 0
      });

      const [question] = await createRealPastQuestions(fixture, 'Physics', 1);

      const duelExam = await prisma.exam.create({
        data: {
          userId: duelUser.id,
          examType: EXAM_TYPES.ONE_V_ONE_DUEL as any,
          nameScopeKey: 'DUEL:PHY',
          sessionNumber: 1,
          subjectsIncluded: ['Physics'],
          totalQuestions: 1,
          score: 0,
          percentage: 0,
          spEarned: 0,
          isCollaboration: true,
          status: EXAM_STATUS.IN_PROGRESS as any,
          startedAt: new Date()
        }
      });

      await prisma.examAnswer.create({
        data: {
          examId: duelExam.id,
          questionId: question.id,
          userAnswer: null,
          isCorrect: false,
          timeSpentSeconds: 0
        }
      });

      const service = new ExamsService();
      await service.submitExam(duelUser.id, duelExam.id, {
        answers: [
          {
            questionId: question.id,
            answer: 'A',
            timeSpentSeconds: 2
          }
        ]
      } as any, uniqueToken('streak-duel-submit'));

      const refreshedUser = await prisma.user.findUnique({
        where: { id: duelUser.id },
        select: {
          currentStreak: true,
          longestStreak: true,
          lastActivityDate: true
        }
      });

      expect(refreshedUser?.currentStreak).toBe(5);
      expect(refreshedUser?.longestStreak).toBe(6);
      expect(refreshedUser?.lastActivityDate).toEqual(getLagosDateValue(new Date()));
    } finally {
      await cleanupFixture(fixture);
    }
  }, 120000);

  it('allows only one successful join when two users race for final collaboration slot', async () => {
    const fixture = createFixtureState();
    try {
      const host = await createUser(fixture);
      const joinerA = await createUser(fixture);
      const joinerB = await createUser(fixture);

      const scopeKey = buildScopeKeyFromExamType(EXAM_TYPES.ONE_V_ONE_DUEL, ['Biology']);
      const session = await prisma.collaborationSession.create({
        data: {
          sessionType: COLLAB_SESSION_TYPE.ONE_V_ONE_DUEL as any,
          hostUserId: host.id,
          sessionCode: uniqueSessionCode('DUEL'),
          nameScopeKey: scopeKey,
          sessionNumber: 1,
          subjectsIncluded: ['Biology'],
          totalQuestions: 25,
          questionSource: COLLAB_QUESTION_SOURCE.REAL_PAST_QUESTION as any,
          status: COLLAB_SESSION_STATUS.WAITING as any,
          isLocked: false,
          maxParticipants: 2
        }
      });
      fixture.sessionIds.push(session.id);

      await prisma.sessionParticipant.create({
        data: {
          sessionId: session.id,
          userId: host.id,
          participantState: PARTICIPANT_STATE.JOINED as any
        }
      });

      const app = createServiceAppStub();
      const manager = new SessionManager(app);
      const service = new CollaborationService(app, manager);

      const [first, second] = await Promise.allSettled([
        service.joinSession(joinerA.id, session.sessionCode, uniqueToken('join-a')),
        service.joinSession(joinerB.id, session.sessionCode, uniqueToken('join-b'))
      ]);

      const successes = [first, second].filter((item) => item.status === 'fulfilled');
      const failures = [first, second].filter((item) => item.status === 'rejected') as Array<PromiseRejectedResult>;

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(['COLLAB_SESSION_FULL', 'COLLAB_SESSION_NOT_JOINABLE']).toContain((failures[0].reason as any).code);

      const participantCount = await prisma.sessionParticipant.count({
        where: { sessionId: session.id }
      });
      expect(participantCount).toBe(2);

      await manager.close();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it('preserves correctness when redis is unavailable during collaboration start race', async () => {
    const fixture = createFixtureState();
    try {
      const host = await createUser(fixture);
      const opponent = await createUser(fixture);
      await createRealPastQuestions(fixture, 'Biology', 30);

      const scopeKey = buildScopeKeyFromExamType(EXAM_TYPES.ONE_V_ONE_DUEL, ['Biology']);
      const session = await prisma.collaborationSession.create({
        data: {
          sessionType: COLLAB_SESSION_TYPE.ONE_V_ONE_DUEL as any,
          hostUserId: host.id,
          sessionCode: uniqueSessionCode('STRT'),
          nameScopeKey: scopeKey,
          sessionNumber: 1,
          subjectsIncluded: ['Biology'],
          totalQuestions: 25,
          questionSource: COLLAB_QUESTION_SOURCE.REAL_PAST_QUESTION as any,
          status: COLLAB_SESSION_STATUS.WAITING as any,
          isLocked: false,
          maxParticipants: 2
        }
      });
      fixture.sessionIds.push(session.id);

      await prisma.sessionParticipant.createMany({
        data: [
          {
            sessionId: session.id,
            userId: host.id,
            participantState: PARTICIPANT_STATE.JOINED as any
          },
          {
            sessionId: session.id,
            userId: opponent.id,
            participantState: PARTICIPANT_STATE.JOINED as any
          }
        ]
      });

      const app = createServiceAppStub();
      const manager = new SessionManager(app);
      const service = new CollaborationService(app, manager);

      const [first, second] = await Promise.allSettled([
        service.startSession(host.id, session.id, uniqueToken('start-a')),
        service.startSession(host.id, session.id, uniqueToken('start-b'))
      ]);

      const successes = [first, second].filter((item) => item.status === 'fulfilled');
      const failures = [first, second].filter((item) => item.status === 'rejected') as Array<PromiseRejectedResult>;

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect((failures[0].reason as any).code).toBe('COLLAB_SESSION_ALREADY_STARTED');

      const refreshedSession = await prisma.collaborationSession.findUnique({
        where: { id: session.id },
        select: { status: true }
      });
      expect(refreshedSession?.status).toBe(COLLAB_SESSION_STATUS.IN_PROGRESS);

      const examCount = await prisma.exam.count({
        where: {
          collaborationSessionId: session.id,
          examType: EXAM_TYPES.ONE_V_ONE_DUEL as any
        }
      });
      expect(examCount).toBe(2);

      await manager.close();
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

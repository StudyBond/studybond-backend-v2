import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import prisma from '../../config/database';
import { EXAM_STATUS, EXAM_TYPES } from '../../modules/exams/exams.constants';
import { COLLAB_QUESTION_SOURCE, COLLAB_SESSION_STATUS, COLLAB_SESSION_TYPE } from '../../modules/collaboration/collaboration.constants';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

interface FixtureState {
  userId?: number;
  questionId?: number;
  examId?: number;
  collaborationSessionId?: number;
  weeklyLeaderboardId?: number;
  projectionEventId?: bigint;
  integritySignalId?: bigint;
}

function uniqueToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

async function cleanupFixture(fixture: FixtureState): Promise<void> {
  if (fixture.projectionEventId) {
    await prisma.leaderboardProjectionEvent.deleteMany({
      where: { id: fixture.projectionEventId }
    });
  }

  if (fixture.integritySignalId) {
    await prisma.leaderboardIntegritySignal.deleteMany({
      where: { id: fixture.integritySignalId }
    });
  }

  if (fixture.weeklyLeaderboardId) {
    await prisma.weeklyLeaderboard.deleteMany({
      where: { id: fixture.weeklyLeaderboardId }
    });
  }

  if (fixture.examId) {
    await prisma.exam.deleteMany({
      where: { id: fixture.examId }
    });
  }

  if (fixture.collaborationSessionId) {
    await prisma.collaborationSession.deleteMany({
      where: { id: fixture.collaborationSessionId }
    });
  }

  if (fixture.questionId) {
    await prisma.question.deleteMany({
      where: { id: fixture.questionId }
    });
  }

  if (fixture.userId) {
    await prisma.user.deleteMany({
      where: { id: fixture.userId }
    });
  }
}

describeIntegration('Institution scope defaults', () => {
  it('assigns the UI institution to newly inserted scoped rows when institutionId is omitted', async () => {
    const fixture: FixtureState = {};

    try {
      const uiInstitution = await prisma.institution.findUnique({
        where: { code: 'UI' },
        select: { id: true }
      });

      expect(uiInstitution?.id).toBeTruthy();

      const user = await prisma.user.create({
        data: {
          email: `${uniqueToken('inst-scope-user')}@example.com`,
          passwordHash: 'hashed-password',
          fullName: `Institution Scope ${uniqueToken('user')}`,
          isVerified: true,
          isPremium: true
        }
      });
      fixture.userId = user.id;

      const question = await prisma.question.create({
        data: {
          questionText: `${uniqueToken('inst-question')} Biology`,
          hasImage: false,
          optionA: 'A',
          optionB: 'B',
          optionC: 'C',
          optionD: 'D',
          correctAnswer: 'A',
          subject: 'Biology',
          topic: 'Institution Scope',
          questionType: 'real_past_question'
        },
        select: { id: true, institutionId: true }
      });
      fixture.questionId = question.id;

      const exam = await prisma.exam.create({
        data: {
          userId: user.id,
          examType: EXAM_TYPES.REAL_PAST_QUESTION as any,
          nameScopeKey: uniqueToken('inst-exam-scope'),
          sessionNumber: 1,
          subjectsIncluded: ['Biology'],
          totalQuestions: 25,
          score: 0,
          percentage: 0,
          spEarned: 0,
          status: EXAM_STATUS.IN_PROGRESS as any,
          startedAt: new Date()
        },
        select: { id: true, institutionId: true }
      });
      fixture.examId = exam.id;

      const collaborationSession = await prisma.collaborationSession.create({
        data: {
          sessionType: COLLAB_SESSION_TYPE.ONE_V_ONE_DUEL as any,
          hostUserId: user.id,
          sessionCode: uniqueToken('instduel').replace(/-/g, '').slice(0, 12).toUpperCase(),
          nameScopeKey: uniqueToken('inst-collab-scope'),
          sessionNumber: 1,
          subjectsIncluded: ['Biology'],
          totalQuestions: 25,
          questionSource: COLLAB_QUESTION_SOURCE.REAL_PAST_QUESTION as any,
          status: COLLAB_SESSION_STATUS.WAITING as any
        },
        select: { id: true, institutionId: true }
      });
      fixture.collaborationSessionId = collaborationSession.id;

      const weeklyLeaderboard = await prisma.weeklyLeaderboard.create({
        data: {
          userId: user.id,
          weekStartDate: new Date('2026-03-16T00:00:00.000Z'),
          weekEndDate: new Date('2026-03-22T00:00:00.000Z'),
          weeklySp: 42
        },
        select: { id: true, institutionId: true }
      });
      fixture.weeklyLeaderboardId = weeklyLeaderboard.id;

      const projectionEvent = await prisma.leaderboardProjectionEvent.create({
        data: {
          userId: user.id,
          weeklySp: 42,
          totalSp: 420,
          source: 'INSTITUTION_SCOPE_TEST'
        },
        select: { id: true, institutionId: true }
      });
      fixture.projectionEventId = projectionEvent.id;

      const integritySignal = await prisma.leaderboardIntegritySignal.create({
        data: {
          userId: user.id,
          signalType: 'INSTITUTION_SCOPE_TEST',
          severity: 'INFO',
          context: { source: 'integration-test' }
        },
        select: { id: true, institutionId: true }
      });
      fixture.integritySignalId = integritySignal.id;

      const expectedInstitutionId = uiInstitution!.id;
      expect(question.institutionId).toBe(expectedInstitutionId);
      expect(exam.institutionId).toBe(expectedInstitutionId);
      expect(collaborationSession.institutionId).toBe(expectedInstitutionId);
      expect(weeklyLeaderboard.institutionId).toBe(expectedInstitutionId);
      expect(projectionEvent.institutionId).toBe(expectedInstitutionId);
      expect(integritySignal.institutionId).toBe(expectedInstitutionId);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

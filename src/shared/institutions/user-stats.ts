import { EXAM_TYPES } from '../../modules/exams/exams.constants';
import { institutionContextService } from './context';

type InstitutionStatsClient = {
  userInstitutionStats: {
    upsert: (args: Record<string, unknown>) => Promise<{
      institutionId: number;
      weeklySp: number;
      totalSp: number;
    }>;
    updateMany?: (args: Record<string, unknown>) => Promise<unknown>;
  };
};

function getPracticeExamIncrement(examType: string): number {
  return examType === EXAM_TYPES.PRACTICE ? 1 : 0;
}

function getRealExamIncrement(examType: string): number {
  return examType === EXAM_TYPES.REAL_PAST_QUESTION ? 1 : 0;
}

function getCollaborationCompletionIncrement(isCollaboration: boolean): number {
  return isCollaboration ? 1 : 0;
}

export async function resolveInstitutionStatsScopeId(
  db: InstitutionStatsClient,
  userId: number,
  institutionId?: number | null
): Promise<number> {
  if (typeof institutionId === 'number' && Number.isInteger(institutionId) && institutionId > 0) {
    return institutionId;
  }

  const fallbackInstitution = await institutionContextService.resolveForUser(
    userId,
    undefined,
    db as any
  );

  return fallbackInstitution.id;
}

export async function upsertUserInstitutionStatsTx(
  tx: InstitutionStatsClient,
  input: {
    userId: number;
    institutionId?: number | null;
    spEarned: number;
    examType: string;
    isCollaboration: boolean;
    occurredAt?: Date;
  }
): Promise<{ institutionId: number; weeklySp: number; totalSp: number }> {
  const scopedInstitutionId = await resolveInstitutionStatsScopeId(tx, input.userId, input.institutionId);
  const occurredAt = input.occurredAt ?? new Date();

  const stats = await tx.userInstitutionStats.upsert({
    where: {
      userId_institutionId: {
        userId: input.userId,
        institutionId: scopedInstitutionId
      }
    },
    create: {
      userId: input.userId,
      institutionId: scopedInstitutionId,
      weeklySp: input.spEarned,
      totalSp: input.spEarned,
      realExamsCompleted: getRealExamIncrement(input.examType),
      practiceExamsCompleted: getPracticeExamIncrement(input.examType),
      completedCollaborationExams: getCollaborationCompletionIncrement(input.isCollaboration),
      lastExamAt: occurredAt
    },
    update: {
      weeklySp: { increment: input.spEarned },
      totalSp: { increment: input.spEarned },
      realExamsCompleted: { increment: getRealExamIncrement(input.examType) },
      practiceExamsCompleted: { increment: getPracticeExamIncrement(input.examType) },
      completedCollaborationExams: { increment: getCollaborationCompletionIncrement(input.isCollaboration) },
      lastExamAt: occurredAt
    },
    select: {
      institutionId: true,
      weeklySp: true,
      totalSp: true
    }
  });

  return {
    institutionId: stats.institutionId,
    weeklySp: stats.weeklySp,
    totalSp: stats.totalSp
  };
}

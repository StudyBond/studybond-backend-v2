import { prisma } from '../config/database';
import { EXAM_CONFIG } from '../modules/exams/exams.constants';
import { getCacheAdapter } from '../shared/cache/cache';
import { institutionExamConfigService } from '../shared/institutions/exam-config';
import { institutionContextService } from '../shared/institutions/context';

/**
 * Abandons all IN_PROGRESS exams that have exceeded their institution-specific
 * maximum duration (including all grace periods). This prevents phantom
 * in-progress exams from permanently blocking users.
 *
 * Each exam's expiry is calculated per-institution, using:
 *   duration(subjectCount, institution) + SUBMISSION_GRACE + OFFLINE_EXTENDED_GRACE
 */
export async function runStaleExamCleanup(): Promise<{
  abandonedCount: number;
  affectedUserIds: number[];
}> {
  // Fetch all currently in-progress exams
  const inProgressExams = await prisma.exam.findMany({
    where: {
      status: 'IN_PROGRESS' as any,
    },
    select: {
      id: true,
      userId: true,
      institutionId: true,
      examType: true,
      subjectsIncluded: true,
      isCollaboration: true,
      startedAt: true,
    },
  });

  if (inProgressExams.length === 0) {
    return { abandonedCount: 0, affectedUserIds: [] };
  }

  const now = new Date();
  const gracePeriod =
    EXAM_CONFIG.SUBMISSION_GRACE_PERIOD_SECONDS +
    EXAM_CONFIG.OFFLINE_SUBMISSION_EXTENDED_GRACE_SECONDS;

  // Resolve the fallback institution once (used when institutionId is null)
  const fallbackInstitution = await institutionContextService.resolveByCode();

  // Evaluate each exam individually against its institution-specific duration
  const staleExamIds: number[] = [];
  const affectedUserIdSet = new Set<number>();

  for (const exam of inProgressExams) {
    try {
      let durationSeconds: number;

      if (exam.examType === 'DAILY_CHALLENGE') {
        durationSeconds = EXAM_CONFIG.DAILY_CHALLENGE_DURATION_SECONDS;
      } else if (exam.isCollaboration) {
        const config =
          await institutionExamConfigService.getActiveConfigForInstitutionId(
            exam.institutionId ?? fallbackInstitution.id,
          );
        durationSeconds = config.collaborationDurationSeconds;
      } else {
        const config =
          await institutionExamConfigService.getActiveConfigForInstitutionId(
            exam.institutionId ?? fallbackInstitution.id,
          );
        durationSeconds = institutionExamConfigService.calculateDurationSeconds(
          exam.subjectsIncluded.length,
          config,
        );
      }

      const expiresAt = new Date(
        exam.startedAt.getTime() + (durationSeconds + gracePeriod) * 1000,
      );

      if (now > expiresAt) {
        staleExamIds.push(exam.id);
        affectedUserIdSet.add(exam.userId);
      }
    } catch {
      // If we can't resolve the institution config, skip this exam.
      // It will be picked up on the next run or by the inline cleanup.
    }
  }

  if (staleExamIds.length === 0) {
    return { abandonedCount: 0, affectedUserIds: [] };
  }

  // Bulk-abandon all stale exams identified above
  const result = await prisma.exam.updateMany({
    where: {
      id: { in: staleExamIds },
      // Re-assert status in case of concurrent updates
      status: 'IN_PROGRESS' as any,
    },
    data: {
      status: 'ABANDONED' as any,
      completedAt: new Date(),
    },
  });

  // Bust exam-history cache for each affected user
  const affectedUserIds = Array.from(affectedUserIdSet);
  const cache = getCacheAdapter();
  if (cache.available) {
    for (const userId of affectedUserIds) {
      try {
        await cache.incr(`exam:history:version:${userId}`);
      } catch {
        // Cache bust is best-effort; DB is source of truth
      }
    }
  }

  return {
    abandonedCount: result.count,
    affectedUserIds,
  };
}

import { AppError } from '../../shared/errors/AppError';
import { QUESTION_POOL_LIMITS, QUESTION_POOLS } from './questions.constants';
import { getSubjectSearchVariants, normalizeSubjectLabel } from '../../shared/utils/subjects';

interface FreeExamScope {
  institutionId: number;
  subject: string;
}

function buildFreeExamLockKey(scope: FreeExamScope): string {
  return `question_pool_free:${scope.institutionId}:${normalizeSubjectLabel(scope.subject).toLowerCase()}`;
}

export async function lockFreeExamSubjects(tx: any, scopes: FreeExamScope[]): Promise<void> {
  const uniqueSubjects = Array.from(
    new Map(
      scopes
        .map((scope) => ({
          institutionId: scope.institutionId,
          subject: normalizeSubjectLabel(scope.subject)
        }))
        .filter((scope) => scope.subject.length > 0)
        .map((scope) => [`${scope.institutionId}:${scope.subject.toLowerCase()}`, scope])
    ).values()
  ).sort((left, right) => {
    if (left.institutionId !== right.institutionId) {
      return left.institutionId - right.institutionId;
    }
    return left.subject.localeCompare(right.subject);
  });

  for (const scope of uniqueSubjects) {
    await tx.$queryRaw`
      SELECT 1
      FROM pg_advisory_xact_lock(hashtext(${buildFreeExamLockKey(scope)}))
    `;
  }
}

export async function ensureFreeExamPoolCapacity(
  tx: any,
  institutionId: number,
  subject: string,
  incomingCount: number,
  excludeQuestionId?: number,
  maxPerSubject?: number
): Promise<void> {
  const normalizedSubject = normalizeSubjectLabel(subject);
  const cap = maxPerSubject ?? QUESTION_POOL_LIMITS.FREE_EXAM_PER_SUBJECT;

  // Count both legacy FREE_EXAM pool questions and isFeaturedFree questions
  const existingCount = await tx.question.count({
    where: {
      institutionId,
      subject: {
        in: getSubjectSearchVariants(normalizedSubject)
      },
      OR: [
        { questionPool: QUESTION_POOLS.FREE_EXAM },
        { isFeaturedFree: true }
      ],
      ...(excludeQuestionId ? { id: { not: excludeQuestionId } } : {})
    }
  });

  if (existingCount + incomingCount > cap) {
    throw new AppError(
      `${normalizedSubject} already has ${existingCount} FREE exam questions for this institution (cap: ${cap}). Remove or reclassify one before adding another.`,
      409,
      'QUESTION_FREE_POOL_FULL'
    );
  }
}

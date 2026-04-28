import prisma from '../../config/database';
import { AppError } from '../errors/AppError';
import { EXAM_CONFIG, EXAM_TYPES, FREE_TIER_LIMITS, PREMIUM_LIMITS } from '../../modules/exams/exams.constants';
import { COLLAB_QUESTION_SOURCE } from '../../modules/collaboration/collaboration.constants';
import type { TopicBlueprint, TopicBlueprintEntry } from '../../modules/exams/exams.types';

type ExamConfigClient = {
  institutionExamConfig: {
    findFirst: typeof prisma.institutionExamConfig.findFirst;
  };
};

export interface InstitutionExamRuntimeConfig {
  id: number;
  institutionId: number;
  trackCode: string;
  questionsPerSubject: number;
  fullExamQuestions: number;
  maxSubjects: number;
  singleSubjectDurationSeconds: number;
  twoSubjectDurationSeconds: number;
  threeSubjectDurationSeconds: number;
  fullExamDurationSeconds: number;
  collaborationDurationSeconds: number;
  freeRealExamCount: number;
  freeFullRealTotalAttempts: number;
  freeQuestionsPerSubject: number;
  premiumDailyRealExamLimit: number;
  collaborationGateRealExams: number;
  defaultFullExamSource: string;
  defaultPartialExamSource: string;
  defaultCollabSource: string;
  allowMixedPartialExams: boolean;
  allowMixedFullExams: boolean;
  allowPracticeCollaboration: boolean;
  allowMixedCollaboration: boolean;
  additionalRules: Record<string, unknown> | null;
}

function normalizeRecord(record: any): InstitutionExamRuntimeConfig {
  return {
    id: record.id,
    institutionId: record.institutionId,
    trackCode: record.trackCode,
    questionsPerSubject: record.questionsPerSubject,
    fullExamQuestions: record.fullExamQuestions,
    maxSubjects: record.maxSubjects,
    singleSubjectDurationSeconds: record.singleSubjectDurationSeconds,
    twoSubjectDurationSeconds: record.twoSubjectDurationSeconds,
    threeSubjectDurationSeconds: record.threeSubjectDurationSeconds,
    fullExamDurationSeconds: record.fullExamDurationSeconds,
    collaborationDurationSeconds: record.collaborationDurationSeconds,
    freeRealExamCount: record.freeRealExamCount,
    freeFullRealTotalAttempts: record.freeFullRealTotalAttempts,
    freeQuestionsPerSubject: record.freeQuestionsPerSubject ?? EXAM_CONFIG.QUESTIONS_PER_SUBJECT,
    premiumDailyRealExamLimit: record.premiumDailyRealExamLimit,
    collaborationGateRealExams: record.collaborationGateRealExams,
    defaultFullExamSource: record.defaultFullExamSource,
    defaultPartialExamSource: record.defaultPartialExamSource,
    defaultCollabSource: record.defaultCollabSource,
    allowMixedPartialExams: record.allowMixedPartialExams,
    allowMixedFullExams: record.allowMixedFullExams,
    allowPracticeCollaboration: record.allowPracticeCollaboration,
    allowMixedCollaboration: record.allowMixedCollaboration,
    additionalRules: record.additionalRules as Record<string, unknown> | null
  };
}

function buildLegacyDefaultConfig(institutionId: number): InstitutionExamRuntimeConfig {
  return {
    id: 0,
    institutionId,
    trackCode: 'POST_UTME',
    questionsPerSubject: EXAM_CONFIG.QUESTIONS_PER_SUBJECT,
    fullExamQuestions: EXAM_CONFIG.FULL_EXAM_QUESTIONS,
    maxSubjects: 4,
    singleSubjectDurationSeconds: EXAM_CONFIG.SINGLE_SUBJECT_DURATION_SECONDS,
    twoSubjectDurationSeconds: EXAM_CONFIG.TWO_SUBJECT_DURATION_SECONDS,
    threeSubjectDurationSeconds: EXAM_CONFIG.THREE_SUBJECT_DURATION_SECONDS,
    fullExamDurationSeconds: EXAM_CONFIG.FULL_EXAM_DURATION_SECONDS,
    collaborationDurationSeconds: EXAM_CONFIG.COLLAB_EXAM_DURATION_SECONDS,
    // Legacy free access allowed a single full real exam before premium prompts.
    freeRealExamCount: 1,
    freeFullRealTotalAttempts: FREE_TIER_LIMITS.FREE_FULL_REAL_TOTAL_ATTEMPTS,
    freeQuestionsPerSubject: EXAM_CONFIG.QUESTIONS_PER_SUBJECT,
    // Keep the legacy fallback aligned to the old "5 real exams/day" meaning.
    premiumDailyRealExamLimit: Math.floor(PREMIUM_LIMITS.DAILY_REAL_SUBJECT_CREDITS / 4),
    collaborationGateRealExams: FREE_TIER_LIMITS.COLLAB_GATE_EXAMS,
    defaultFullExamSource: EXAM_TYPES.REAL_PAST_QUESTION,
    defaultPartialExamSource: EXAM_TYPES.MIXED,
    defaultCollabSource: COLLAB_QUESTION_SOURCE.REAL_PAST_QUESTION,
    allowMixedPartialExams: true,
    allowMixedFullExams: false,
    allowPracticeCollaboration: true,
    allowMixedCollaboration: true,
    additionalRules: {
      source: 'legacy-default-fallback'
    }
  };
}

export class InstitutionExamConfigService {
  private readonly defaultTrackCode = 'POST_UTME';

  async getActiveConfigForInstitutionId(
    institutionId: number,
    db: ExamConfigClient = prisma as unknown as ExamConfigClient
  ): Promise<InstitutionExamRuntimeConfig> {
    const record = await db.institutionExamConfig.findFirst({
      where: {
        institutionId,
        trackCode: this.defaultTrackCode,
        isActive: true
      },
      orderBy: { id: 'asc' }
    });

    if (!record) {
      return buildLegacyDefaultConfig(institutionId);
    }

    return normalizeRecord(record);
  }

  calculateTotalQuestions(subjectCount: number, config: InstitutionExamRuntimeConfig): number {
    if (subjectCount >= config.maxSubjects) {
      return config.fullExamQuestions;
    }

    return subjectCount * config.questionsPerSubject;
  }

  calculateDurationSeconds(subjectCount: number, config: InstitutionExamRuntimeConfig): number {
    if (subjectCount <= 1) {
      return config.singleSubjectDurationSeconds;
    }

    if (subjectCount === 2) {
      return config.twoSubjectDurationSeconds;
    }

    if (subjectCount === 3) {
      return config.threeSubjectDurationSeconds;
    }

    return config.fullExamDurationSeconds;
  }

  resolveSoloExamType(
    requestedExamType: string | undefined,
    subjectCount: number,
    config: InstitutionExamRuntimeConfig
  ): string {
    const isFullExam = subjectCount >= config.maxSubjects;
    const resolved = requestedExamType ?? (isFullExam ? config.defaultFullExamSource : config.defaultPartialExamSource);

    if (resolved === EXAM_TYPES.MIXED) {
      if (isFullExam && !config.allowMixedFullExams) {
        throw new AppError(
          'Full exams must be either real-only or practice-only. Mixed mode is available only when the institution allows it.',
          400,
          'EXAM_INVALID_SOURCE_SELECTION'
        );
      }

      if (!isFullExam && !config.allowMixedPartialExams) {
        throw new AppError(
          'Mixed mode is not enabled for this institution in partial exam mode.',
          400,
          'EXAM_INVALID_SOURCE_SELECTION'
        );
      }
    }

    return resolved;
  }

  resolveCollaborationQuestionSource(
    requestedSource: string | undefined,
    config: InstitutionExamRuntimeConfig
  ): string {
    const resolved = requestedSource ?? config.defaultCollabSource;

    if (resolved === COLLAB_QUESTION_SOURCE.PRACTICE && !config.allowPracticeCollaboration) {
      throw new AppError(
        'Practice collaboration is not enabled for this institution.',
        400,
        'COLLAB_INVALID_SOURCE_SELECTION'
      );
    }

    if (resolved === COLLAB_QUESTION_SOURCE.MIXED && !config.allowMixedCollaboration) {
      throw new AppError(
        'Mixed collaboration is not enabled for this institution.',
        400,
        'COLLAB_INVALID_SOURCE_SELECTION'
      );
    }

    return resolved;
  }

  /**
   * Extract topic blueprints from the institution exam config additionalRules.
   *
   * Expected JSON shape inside additionalRules:
   * ```json
   * {
   *   "topicBlueprints": {
   *     "English": {
   *       "Comprehension": { "quota": 5, "requirePassageGroup": true },
   *       "Concord": { "quota": 3 },
   *       "__other__": { "quota": 5 }
   *     }
   *   }
   * }
   * ```
   *
   * Returns null when no blueprints are configured.
   */
  getTopicBlueprints(config: InstitutionExamRuntimeConfig): TopicBlueprint | null {
    if (!config.additionalRules) return null;

    const raw = (config.additionalRules as Record<string, unknown>).topicBlueprints;
    if (!raw || typeof raw !== 'object') return null;

    // Validate and normalize the structure
    const blueprints: TopicBlueprint = {};
    const subjects = raw as Record<string, unknown>;

    for (const [subject, topicMap] of Object.entries(subjects)) {
      if (!topicMap || typeof topicMap !== 'object') continue;

      const entries: Record<string, TopicBlueprintEntry> = {};
      for (const [topic, entry] of Object.entries(topicMap as Record<string, unknown>)) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        const quota = typeof e.quota === 'number' ? e.quota : 0;
        if (quota <= 0) continue;

        entries[topic] = {
          quota,
          requirePassageGroup: e.requirePassageGroup === true
        };
      }

      if (Object.keys(entries).length > 0) {
        blueprints[subject] = entries;
      }
    }

    return Object.keys(blueprints).length > 0 ? blueprints : null;
  }
}

export const institutionExamConfigService = new InstitutionExamConfigService();

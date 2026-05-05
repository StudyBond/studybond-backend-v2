// All database operations use atomic transactions to avoid race conditions

import { prisma } from "../../config/database";
import { AppError } from "../../shared/errors/AppError";
import { getCacheAdapter, getJson, setJson } from "../../shared/cache/cache";
import {
  EXAM_CONFIG,
  EXAM_STATUS,
  EXAM_TYPES,
  EXAM_ERROR_CODES,
  FREE_TIER_LIMITS,
  PREMIUM_LIMITS,
  SUBJECTS,
} from "./exams.constants";
import {
  StartExamInput,
  StartDailyChallengeInput,
  SubmitExamInput,
  ExamHistoryQuery,
  ExamSessionResponse,
  ExamResultResponse,
  ExamHistoryResponse,
  QuestionForClient,
  QuestionWithAnswer,
  EligibilityCheck,
  QuestionWithMeta,
} from "./exams.types";
import {
  selectQuestionsForExam,
  selectQuestionsForRetake,
  shuffleQuestionOptions,
} from "./question-selector";
import {
  calculateExamScore,
  gradeAnswers,
  updateUserStats,
  updateQuestionStats,
} from "./scoring-engine";
import { checkRetakeEligibility, getOriginalExamId } from "./retake-handler";
import {
  buildExamDisplayNames,
  buildScopeKeyFromExamType,
} from "../../shared/utils/examNaming";
import { normalizeSubjectLabel, getSubjectSearchVariants } from "../../shared/utils/subjects";
import {
  buildRouteKey,
  idempotencyService,
} from "../../shared/idempotency/idempotency";
import { runLeaderboardIntegrityChecks } from "../../shared/leaderboard/integrity";
import { deriveStreakSnapshot } from "../../shared/streaks/domain";
import { LeaderboardService } from "../leaderboard/leaderboard.service";
import { QUESTION_POOLS } from "../questions/questions.constants";
import { institutionContextService } from "../../shared/institutions/context";
import {
  institutionExamConfigService,
  type InstitutionExamRuntimeConfig,
} from "../../shared/institutions/exam-config";

export class ExamsService {
  private static readonly EXAM_HISTORY_CACHE_TTL_SECONDS = Number.parseInt(
    process.env.EXAM_HISTORY_CACHE_TTL_SECONDS || "45",
    10,
  );
  private static readonly EXAM_START_RATE_LIMIT_MAX = Number.parseInt(
    process.env.EXAM_START_RATE_LIMIT_MAX || "5",
    10,
  );
  private static readonly EXAM_START_RATE_LIMIT_WINDOW_SECONDS =
    Number.parseInt(
      process.env.EXAM_START_RATE_LIMIT_WINDOW_SECONDS || "60",
      10,
    );
  private static readonly EXAM_SUBMIT_LOCK_TTL_SECONDS = Number.parseInt(
    process.env.EXAM_SUBMIT_LOCK_TTL_SECONDS || "30",
    10,
  );

  private readonly leaderboardService: LeaderboardService;

  constructor() {
    this.leaderboardService = new LeaderboardService();
  }

  private examHistoryVersionKey(userId: number): string {
    return `exam:history:version:${userId}`;
  }

  private examHistoryCacheKey(
    userId: number,
    query: ExamHistoryQuery,
    version: string,
  ): string {
    const normalizedQuery = JSON.stringify({
      page: query.page ?? 1,
      limit: query.limit ?? 10,
      institutionCode: query.institutionCode ?? null,
      examType: query.examType ?? null,
      status: query.status ?? null,
    });
    return `exam:history:${userId}:${version}:${normalizedQuery}`;
  }

  private async bumpExamHistoryVersion(userId: number): Promise<void> {
    const cache = getCacheAdapter();
    if (!cache.available) return;

    try {
      await cache.incr(this.examHistoryVersionKey(userId));
    } catch {
      // Cache invalidation improves freshness, but exam start/submit flows must
      // still succeed if Redis is temporarily unavailable.
    }
  }

  private calculateExamExpiresAt(
    startedAt: Date,
    durationSeconds: number,
  ): Date {
    return new Date(
      startedAt.getTime() +
        durationSeconds * 1000 +
        EXAM_CONFIG.SUBMISSION_GRACE_PERIOD_SECONDS * 1000,
    );
  }

  private async reuseOrExpireInProgressExam(
    userId: number,
    institutionId: number | null,
    scopeKey: string,
  ): Promise<ExamSessionResponse | null> {
    const existingExam = await prisma.exam.findFirst({
      where: {
        userId,
        institutionId,
        nameScopeKey: scopeKey,
        status: EXAM_STATUS.IN_PROGRESS as any,
        isRetake: false,
        isCollaboration: false,
      },
      select: {
        id: true,
        institutionId: true,
        subjectsIncluded: true,
        isCollaboration: true,
        examType: true,
        startedAt: true,
      },
    });

    if (!existingExam) {
      return null;
    }

    const durationSeconds =
      await this.getConfiguredExamDurationSeconds(existingExam);
    const expiresAt = this.calculateExamExpiresAt(
      existingExam.startedAt,
      durationSeconds,
    );

    if (new Date() > expiresAt) {
      await prisma.exam.update({
        where: { id: existingExam.id },
        data: {
          status: EXAM_STATUS.ABANDONED as any,
          completedAt: new Date(),
        },
      });
      await this.bumpExamHistoryVersion(userId);
      return null;
    }

    return this.getExamQuestions(userId, existingExam.id);
  }

  private async enforceStartRateLimit(userId: number): Promise<void> {
    const cache = getCacheAdapter();
    if (!cache.available) return;

    const key = `exam:start:rate:user:${userId}`;
    try {
      const count = await cache.incr(key);
      if (count === 1) {
        await cache.expire(
          key,
          ExamsService.EXAM_START_RATE_LIMIT_WINDOW_SECONDS,
        );
      }

      if (count > ExamsService.EXAM_START_RATE_LIMIT_MAX) {
        throw new AppError(
          "You are starting exams too quickly. Please wait a little and try again.",
          429,
          "EXAM_START_RATE_LIMIT",
        );
      }
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      // Redis failure must not block exam start. DB remains source of truth.
    }
  }

  private async acquireSubmitLock(
    userId: number,
    examId: number,
  ): Promise<string | null> {
    const cache = getCacheAdapter();
    if (!cache.available) return null;

    const key = `exam:submit:lock:${examId}`;
    const owner = `${userId}:${examId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    try {
      const acquired = await cache.acquireLock(
        key,
        owner,
        ExamsService.EXAM_SUBMIT_LOCK_TTL_SECONDS,
      );
      if (!acquired) {
        throw new AppError(
          "Another submission for this exam is in progress. Please wait a few seconds and try again.",
          409,
          "EXAM_SUBMIT_IN_PROGRESS",
        );
      }
      return owner;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      // If Redis has transient issues, rely on DB atomic checks.
      return null;
    }
  }

  private async releaseSubmitLock(
    examId: number,
    owner: string | null,
  ): Promise<void> {
    if (!owner) return;
    const cache = getCacheAdapter();
    if (!cache.available) return;

    try {
      await cache.releaseLock(`exam:submit:lock:${examId}`, owner);
    } catch {
      // Lock TTL guarantees eventual cleanup even if release fails.
    }
  }

  private async nextExamSessionNumber(
    tx: any,
    userId: number,
    scopeKey: string,
  ): Promise<number> {
    const counter = await tx.examSessionCounter.upsert({
      where: {
        userId_scopeKey: {
          userId,
          scopeKey,
        },
      },
      create: {
        userId,
        scopeKey,
        currentValue: 1,
      },
      update: {
        currentValue: { increment: 1 },
      },
      select: {
        currentValue: true,
      },
    });

    return counter.currentValue;
  }



  private resolveSoloExamType(
    input: StartExamInput,
    config: InstitutionExamRuntimeConfig,
  ): string {
    return institutionExamConfigService.resolveSoloExamType(
      input.examType,
      input.subjects.length,
      config,
    );
  }

  private isFullSoloExam(subjects: string[]): boolean {
    return subjects.length === 4;
  }

  private getMaxRetakesForExam(
    isPremium: boolean,
    examType: string,
    subjects: string[],
    config?: InstitutionExamRuntimeConfig,
  ): number {
    if (
      !isPremium &&
      examType === EXAM_TYPES.REAL_PAST_QUESTION &&
      this.isFullSoloExam(subjects)
    ) {
      return (
        (config?.freeFullRealTotalAttempts ??
          FREE_TIER_LIMITS.FREE_FULL_REAL_TOTAL_ATTEMPTS) - 1
      );
    }

    return EXAM_CONFIG.MAX_RETAKES;
  }

  private async getConfiguredExamDurationSeconds(exam: {
    institutionId: number | null;
    subjectsIncluded: string[];
    isCollaboration: boolean;
    examType?: string;
  }): Promise<number> {
    if (exam.examType === EXAM_TYPES.DAILY_CHALLENGE) {
      return EXAM_CONFIG.DAILY_CHALLENGE_DURATION_SECONDS;
    }

    const fallbackInstitution = await institutionContextService.resolveByCode();
    const config =
      await institutionExamConfigService.getActiveConfigForInstitutionId(
        exam.institutionId ?? fallbackInstitution.id,
      );

    if (exam.isCollaboration) {
      return config.collaborationDurationSeconds;
    }

    return institutionExamConfigService.calculateDurationSeconds(
      exam.subjectsIncluded.length,
      config,
    );
  }

  // ELIGIBILITY CHECKS

  /* Check if user can start a new exam*/
  async checkExamEligibility(
    userId: number,
    examType: string,
    subjects: string[],
    config?: InstitutionExamRuntimeConfig,
  ): Promise<EligibilityCheck> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        isPremium: true,
        freeSubjectCreditsUsed: true,
        freeSubjectsTaken: true,
      },
    });

    if (!user) {
      return {
        canTakeExam: false,
        reason: "User not found",
        errorCode: "USER_NOT_FOUND" as any,
      };
    }

    // 1. Enforce free tier restrictions (no practice/mixed exams)
    if (
      !user.isPremium &&
      (examType === EXAM_TYPES.PRACTICE || examType === EXAM_TYPES.MIXED)
    ) {
      return {
        canTakeExam: false,
        reason:
          examType === EXAM_TYPES.MIXED
            ? "Mixed-source exams require premium subscription. Free users can still choose real UI questions only."
            : "Practice exams require premium subscription.",
        errorCode: EXAM_ERROR_CODES.PREMIUM_REQUIRED,
      };
    }

    // 2. Enforce Subject Credits
    if (examType === EXAM_TYPES.REAL_PAST_QUESTION) {
      if (user.isPremium) {
        // Premium users: daily credit limit (existing behavior)
        const now = new Date();
        const gmt1Offset = 60 * 60 * 1000;
        const nowGmt1 = new Date(now.getTime() + gmt1Offset);
        nowGmt1.setUTCHours(0, 0, 0, 0);
        const startOfDayGmt1 = new Date(nowGmt1.getTime() - gmt1Offset);

        const examsToday: Array<{ subjectsIncluded: string[] }> =
          await prisma.exam.findMany({
            where: {
              userId,
              examType: EXAM_TYPES.REAL_PAST_QUESTION,
              isRetake: false,
              startedAt: { gte: startOfDayGmt1 },
            },
            select: { subjectsIncluded: true },
          });

        const creditsUsed = examsToday.reduce(
          (sum, exam) => sum + exam.subjectsIncluded.length,
          0,
        );
        const requestedCredits = subjects.length;

        let maxCredits =
          config?.premiumDailyRealExamLimit ??
          PREMIUM_LIMITS.DAILY_REAL_SUBJECT_CREDITS;

        // Handle legacy configs that might assume exam count instead of credits
        if (
          config?.premiumDailyRealExamLimit &&
          config.premiumDailyRealExamLimit < 10
        ) {
          maxCredits = config.premiumDailyRealExamLimit * 4;
        }

        const creditsRemaining = maxCredits - creditsUsed;

        if (creditsRemaining < requestedCredits) {
          const limitReachedStr = creditsRemaining <= 0;
          const reason = limitReachedStr
            ? "You've completed your daily optimal study limit (20 subject credits). Review time 😌"
            : `You only have ${creditsRemaining} subject credit(s) remaining today, but you selected ${requestedCredits} subjects.`;

          return {
            canTakeExam: false,
            reason,
            errorCode: EXAM_ERROR_CODES.DAILY_LIMIT_REACHED,
            creditsUsed,
            creditsRemaining,
            requestedCredits,
          };
        }

        return {
          canTakeExam: true,
          creditsUsed,
          creditsRemaining,
          requestedCredits,
          freeSubjectsTaken: user.freeSubjectsTaken as string[],
        };
      }

      // Free users: lifetime credits (SUPERADMIN reset only)
      const creditsUsed = user.freeSubjectCreditsUsed;
      const maxCredits = FREE_TIER_LIMITS.FREE_TOTAL_SUBJECT_CREDITS;
      const requestedCredits = subjects.length;
      const creditsRemaining = maxCredits - creditsUsed;

      // Check if user has enough credits
      if (creditsRemaining < requestedCredits) {
        const limitReached = creditsRemaining <= 0;
        const reason = limitReached
          ? "You've used all your free subject credits. Upgrade to Premium for unlimited daily access!"
          : `You only have ${creditsRemaining} free subject credit(s) remaining, but you selected ${requestedCredits} subjects.`;

        return {
          canTakeExam: false,
          reason,
          errorCode: EXAM_ERROR_CODES.FREE_LIMIT_REACHED,
          creditsUsed,
          creditsRemaining,
          requestedCredits,
        };
      }

      // Check subject uniqueness: cannot take the same subject twice with credits
      const alreadyTaken = (user.freeSubjectsTaken ?? []).map((s: string) =>
        normalizeSubjectLabel(s).toLowerCase(),
      );
      const requestedNormalized = subjects.map((s: string) =>
        normalizeSubjectLabel(s).toLowerCase(),
      );
      const duplicateSubjects = requestedNormalized.filter((s: string) =>
        alreadyTaken.includes(s),
      );

      if (duplicateSubjects.length > 0) {
        return {
          canTakeExam: false,
          reason: `You've already used a free credit for: ${duplicateSubjects.join(", ")}. Choose different subjects or upgrade to Premium.`,
          errorCode: EXAM_ERROR_CODES.FREE_SUBJECT_ALREADY_TAKEN,
          creditsUsed,
          creditsRemaining,
          requestedCredits,
        };
      }

      return {
        canTakeExam: true,
        creditsUsed,
        creditsRemaining,
        requestedCredits,
        freeSubjectsTaken: user.freeSubjectsTaken as string[],
      };
    }

    return { canTakeExam: true };
  }

  // START EXAM

  async startExam(
    userId: number,
    input: StartExamInput,
    idempotencyKey?: string,
  ): Promise<ExamSessionResponse> {
    if (idempotencyKey) {
      const routeKey = buildRouteKey("POST", "/api/exams/start");
      return idempotencyService.execute(
        {
          userId,
          routeKey,
          idempotencyKey,
          payload: input,
        },
        () => this.startExam(userId, input),
      );
    }

    const institution = await institutionContextService.resolveForUser(
      userId,
      input.institutionCode,
    );
    const config =
      await institutionExamConfigService.getActiveConfigForInstitutionId(
        institution.id,
      );
    const resolvedExamType = this.resolveSoloExamType(input, config);
    const scopeKey = buildScopeKeyFromExamType(
      resolvedExamType,
      input.subjects,
    );

    const resumedSession = await this.reuseOrExpireInProgressExam(
      userId,
      institution.id,
      scopeKey,
    );
    if (resumedSession) {
      return resumedSession;
    }

    await this.enforceStartRateLimit(userId);

    const eligibility = await this.checkExamEligibility(
      userId,
      resolvedExamType,
      input.subjects,
      config,
    ); //check eligibility
    if (!eligibility.canTakeExam) {
      throw new AppError(eligibility.reason!, 403);
    }
    // Load user to determine free tier status
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isPremium: true },
    });
    const isFreeUser = !user?.isPremium;

    // Free users get questions from the admin-curated isFeaturedFree pool
    // and may have a different questions-per-subject limit per institution
    const questionsPerSubject =
      isFreeUser && resolvedExamType === EXAM_TYPES.REAL_PAST_QUESTION
        ? config.freeQuestionsPerSubject
        : config.questionsPerSubject;
    const totalQuestions = institutionExamConfigService.calculateTotalQuestions(
      input.subjects.length,
      {
        ...config,
        questionsPerSubject,
      },
    );
    const durationSeconds =
      institutionExamConfigService.calculateDurationSeconds(
        input.subjects.length,
        config,
      );
    const useFeaturedFree =
      resolvedExamType === EXAM_TYPES.REAL_PAST_QUESTION && isFreeUser;
    const maxRetakes = this.getMaxRetakesForExam(
      Boolean(user?.isPremium),
      resolvedExamType,
      input.subjects,
      config,
    );
    const topicBlueprints =
      institutionExamConfigService.getTopicBlueprints(config);

    const questions = await selectQuestionsForExam(
      input.subjects,
      resolvedExamType,
      questionsPerSubject,
      [],
      {
        deterministic: false,
        institutionId: institution.id,
        realQuestionPool: QUESTION_POOLS.REAL_BANK,
        topicBlueprints,
        isFeaturedFree: useFeaturedFree,
      },
    );

    const startedAt = new Date();
    const expiresAt = this.calculateExamExpiresAt(
      startedAt,
      durationSeconds,
    );

    // Create exam in transaction (atomically track free credits)
    let exam;
    try {
      exam = await prisma.$transaction(async (tx: any) => {
        const sessionNumber = await this.nextExamSessionNumber(
          tx,
          userId,
          scopeKey,
        );
        const newExam = await tx.exam.create({
          data: {
            userId,
            institutionId: institution.id,
            examType: resolvedExamType as any,
            nameScopeKey: scopeKey,
            sessionNumber,
            subjectsIncluded: input.subjects,
            totalQuestions,
            score: 0,
            percentage: 0,
            spEarned: 0,
            status: EXAM_STATUS.IN_PROGRESS as any,
            startedAt,
            isRetake: false,
            attemptNumber: 1,
            maxRetakes,
          },
        });

        // Create placeholder exam answers (for tracking in-progress state)
        const answerRecords = questions.map((q) => ({
          examId: newExam.id,
          questionId: q.id,
          userAnswer: null,
          isCorrect: false,
          timeSpentSeconds: 0,
        }));

        await tx.examAnswer.createMany({
          data: answerRecords,
        });

        // Atomically consume free credits for non-premium users on real exams
        if (isFreeUser && resolvedExamType === EXAM_TYPES.REAL_PAST_QUESTION) {
          const normalizedSubjects = input.subjects.map((s: string) =>
            normalizeSubjectLabel(s),
          );
          await tx.user.update({
            where: { id: userId },
            data: {
              freeSubjectCreditsUsed: { increment: input.subjects.length },
              freeSubjectsTaken: { push: normalizedSubjects },
              hasTakenFreeExam: true,
            },
          });
        }

        return newExam;
      });
    } catch (error: any) {
      if (error?.code === "P2002") {
        const resumedAfterConflict = await this.reuseOrExpireInProgressExam(
          userId,
          institution.id,
          scopeKey,
        );
        if (resumedAfterConflict) {
          return resumedAfterConflict;
        }
      }
      throw error;
    }

    const naming = buildExamDisplayNames(
      resolvedExamType,
      input.subjects,
      exam.sessionNumber,
    );

    // Prepare response (without correct answers)
    const questionsForClient: QuestionForClient[] = questions.map((q) => ({
      id: q.id,
      questionText: q.questionText,
      hasImage: q.hasImage,
      imageUrl: q.imageUrl,
      optionA: q.optionA,
      optionB: q.optionB,
      optionC: q.optionC,
      optionD: q.optionD,
      optionE: q.optionE,
      optionAImageUrl: q.optionAImageUrl,
      optionBImageUrl: q.optionBImageUrl,
      optionCImageUrl: q.optionCImageUrl,
      optionDImageUrl: q.optionDImageUrl,
      optionEImageUrl: q.optionEImageUrl,
      parentQuestionText: q.parentQuestionText ?? null,
      parentQuestionImageUrl: q.parentQuestionImageUrl ?? null,
      subject: normalizeSubjectLabel(q.subject),
      topic: q.topic,
    }));

    await this.bumpExamHistoryVersion(userId);

    return {
      examId: exam.id,
      examType: resolvedExamType as any,
      subjects: input.subjects,
      sessionNumber: exam.sessionNumber,
      displayNameLong: naming.displayNameLong,
      displayNameShort: naming.displayNameShort,
      totalQuestions,
      timeAllowedSeconds: durationSeconds,
      startedAt: startedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      questions: questionsForClient,
    };
  }

  // START DAILY CHALLENGE
  async startDailyChallenge(
    userId: number,
    input: StartDailyChallengeInput,
    idempotencyKey?: string,
  ): Promise<ExamSessionResponse> {
    if (idempotencyKey) {
      const routeKey = buildRouteKey(
        "POST",
        "/api/exams/daily-challenge/start",
      );
      return idempotencyService.execute(
        {
          userId,
          routeKey,
          idempotencyKey,
          payload: input,
        },
        () => this.startDailyChallenge(userId, input),
      );
    }

    await this.enforceStartRateLimit(userId);
    const scopeKey = buildScopeKeyFromExamType(
      EXAM_TYPES.DAILY_CHALLENGE as any,
      input.subjects,
    );

    // Calculate start of today in GMT+1 (Nigerian Time)
    const now = new Date();
    const gmt1Offset = 60 * 60 * 1000;
    const nowGmt1 = new Date(now.getTime() + gmt1Offset);
    nowGmt1.setUTCHours(0, 0, 0, 0);
    const startOfDayGmt1 = new Date(nowGmt1.getTime() - gmt1Offset);

    const existingChallenge = await prisma.exam.findFirst({
      where: {
        userId,
        examType: EXAM_TYPES.DAILY_CHALLENGE as any,
        startedAt: { gte: startOfDayGmt1 },
      },
    });

    if (existingChallenge) {
      if (existingChallenge.status === EXAM_STATUS.IN_PROGRESS) {
        const resumedSession = await this.reuseOrExpireInProgressExam(
          userId,
          null, // Daily challenges do not have an institution context
          existingChallenge.nameScopeKey,
        );
        if (resumedSession) {
          return resumedSession;
        }
        // If it returns null, the session expired and was abandoned. Fall through to block.
      }

      throw new AppError(
        "You have already attempted today's Global Daily Challenge. Come back tomorrow!",
        403,
      );
    }

    const dateString = nowGmt1.toISOString().split("T")[0]; // YYYY-MM-DD
    const cacheKey = `daily_challenge_pool:${dateString}`;

    let globalPool = await getJson<Record<string, number>>(cacheKey);

    const hasAllSubjects = globalPool && SUBJECTS.every(s => globalPool![s] !== undefined);

    if (!globalPool || !hasAllSubjects) {
      globalPool = globalPool || {};
      // We use the available subjects constant
      for (const subject of SUBJECTS) {
        if (!globalPool[subject]) {
          const variants = getSubjectSearchVariants(subject);
          const questions = await prisma.question.findMany({
            where: {
              subject: { in: variants },
              questionType: { in: ['real_past_question', 'practice'] }
            },
            select: { id: true }
          });
          
          if (questions.length > 0) {
            const randomIndex = Math.floor(Math.random() * questions.length);
            globalPool[subject] = questions[randomIndex].id;
          }
        }
      }
      await setJson(cacheKey, globalPool, 24 * 60 * 60);
    }

    const selectedQuestionIds: Array<{ subject: string; questionId: number }> =
      [];
    const missingSubjects: string[] = [];
    for (const subject of input.subjects) {
      const questionId = globalPool[subject];
      if (typeof questionId === "number") {
        selectedQuestionIds.push({ subject, questionId });
      } else {
        missingSubjects.push(subject);
      }
    }

    if (missingSubjects.length > 0) {
      throw new AppError(
        `Daily challenge questions are not available for: ${missingSubjects.join(", ")}.`,
        422,
        EXAM_ERROR_CODES.INSUFFICIENT_QUESTIONS,
      );
    }

    const rawQuestions = await prisma.question.findMany({
      where: {
        id: { in: selectedQuestionIds.map((entry) => entry.questionId) },
      },
      include: {
        parentQuestion: {
          select: { questionText: true, imageUrl: true },
        },
      },
    });

    const foundQuestionIds = new Set(rawQuestions.map((question: any) => question.id));
    const staleSubjects = selectedQuestionIds
      .filter((entry) => !foundQuestionIds.has(entry.questionId))
      .map((entry) => entry.subject);

    if (staleSubjects.length > 0) {
      throw new AppError(
        `Daily challenge questions need to be refreshed for: ${staleSubjects.join(", ")}.`,
        422,
        EXAM_ERROR_CODES.INSUFFICIENT_QUESTIONS,
      );
    }

    // Map to QuestionWithMeta and shuffle options
    const questions: QuestionWithMeta[] = rawQuestions.map((q: any) => {
      const formatted = {
        ...q,
        parentQuestionText: q.parentQuestion?.questionText ?? null,
        parentQuestionImageUrl: q.parentQuestion?.imageUrl ?? null,
      };
      return shuffleQuestionOptions(formatted);
    });

    const startedAt = new Date();
    const durationSeconds = EXAM_CONFIG.DAILY_CHALLENGE_DURATION_SECONDS;
    const expiresAt = this.calculateExamExpiresAt(startedAt, durationSeconds);

    let exam;
    try {
      // Transaction to save Exam and ExamAnswer rows
      exam = await prisma.$transaction(async (tx: any) => {
        const sessionNumber = await this.nextExamSessionNumber(
          tx,
          userId,
          scopeKey,
        );

        const newExam = await tx.exam.create({
          data: {
            userId,
            institutionId: null,
            examType: EXAM_TYPES.DAILY_CHALLENGE as any,
            nameScopeKey: scopeKey,
            sessionNumber,
            subjectsIncluded: input.subjects,
            totalQuestions: questions.length,
            score: 0,
            percentage: 0,
            spEarned: 0,
            status: EXAM_STATUS.IN_PROGRESS as any,
            startedAt,
            isRetake: false,
            attemptNumber: 1,
            maxRetakes: 0, // No retakes for daily challenges
          },
        });

        const answerRecords = questions.map((q) => ({
          examId: newExam.id,
          questionId: q.id,
          userAnswer: null,
          isCorrect: false,
          timeSpentSeconds: 0,
        }));

        await tx.examAnswer.createMany({ data: answerRecords });
        return newExam;
      });
    } catch (error: any) {
      if (error?.code === "P2002") {
        const resumedAfterConflict = await this.reuseOrExpireInProgressExam(
          userId,
          null,
          scopeKey,
        );
        if (resumedAfterConflict) {
          return resumedAfterConflict;
        }
      }
      throw error;
    }

    const naming = buildExamDisplayNames(
      EXAM_TYPES.DAILY_CHALLENGE as any,
      input.subjects,
      exam.sessionNumber,
    );

    const questionsForClient: QuestionForClient[] = questions.map((q) => ({
      id: q.id,
      questionText: q.questionText,
      hasImage: q.hasImage,
      imageUrl: q.imageUrl,
      optionA: q.optionA,
      optionB: q.optionB,
      optionC: q.optionC,
      optionD: q.optionD,
      optionE: q.optionE,
      optionAImageUrl: q.optionAImageUrl,
      optionBImageUrl: q.optionBImageUrl,
      optionCImageUrl: q.optionCImageUrl,
      optionDImageUrl: q.optionDImageUrl,
      optionEImageUrl: q.optionEImageUrl,
      parentQuestionText: q.parentQuestionText ?? null,
      parentQuestionImageUrl: q.parentQuestionImageUrl ?? null,
      subject: normalizeSubjectLabel(q.subject),
      topic: q.topic,
    }));

    await this.bumpExamHistoryVersion(userId);

    return {
      examId: exam.id,
      examType: EXAM_TYPES.DAILY_CHALLENGE as any,
      subjects: input.subjects,
      sessionNumber: exam.sessionNumber,
      displayNameLong: naming.displayNameLong,
      displayNameShort: naming.displayNameShort,
      totalQuestions: questions.length,
      timeAllowedSeconds: durationSeconds,
      startedAt: exam.startedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      questions: questionsForClient,
    };
  }

  /* Submit exam answers and calculate score */
  async submitExam(
    userId: number,
    examId: number,
    input: SubmitExamInput,
    idempotencyKey?: string,
  ): Promise<ExamResultResponse> {
    if (idempotencyKey) {
      const routeKey = buildRouteKey("POST", "/api/exams/:examId/submit", {
        examId,
      });
      return idempotencyService.execute(
        {
          userId,
          routeKey,
          idempotencyKey,
          payload: input,
        },
        () => this.submitExam(userId, examId, input),
      );
    }

    const submitLockOwner = await this.acquireSubmitLock(userId, examId);
    try {
      const exam = await prisma.exam.findFirst({
        where: {
          id: examId,
          userId: userId,
        },
        include: {
          examAnswers: {
            include: {
              question: {
                include: {
                  explanation: true,
                  parentQuestion: true,
                },
              },
            },
          },
        },
      });

      if (!exam) {
        throw new AppError("Exam not found", 404);
      }

      if (exam.status !== EXAM_STATUS.IN_PROGRESS) {
        throw new AppError(
          exam.status === EXAM_STATUS.COMPLETED
            ? "Exam has already been submitted"
            : "Exam has been abandoned",
          400,
        );
      }

      //We need to check for server-side timeout
      const now = new Date();
      const examDuration = await this.getConfiguredExamDurationSeconds(exam);
      const expiresAt = new Date(
        exam.startedAt.getTime() +
          examDuration * 1000 +
          EXAM_CONFIG.SUBMISSION_GRACE_PERIOD_SECONDS * 1000,
      );

      if (now > expiresAt) {
        throw new AppError("Exam time has expired", 400);
      }

      // Map submitted answers to question IDs
      const answerMap = new Map(input.answers.map((a) => [a.questionId, a]));

      // And check if all questions belong to this exam
      const examQuestionIds = new Set(
        exam.examAnswers.map((ea: any) => ea.questionId),
      );
      for (const answer of input.answers) {
        if (!examQuestionIds.has(answer.questionId)) {
          throw new AppError(
            `Question ${answer.questionId} does not belong to this exam`,
            400,
          );
        }
      }

      // Get questions with correct answers
      const questions = exam.examAnswers.map((ea: any) => ({
        id: ea.question.id,
        correctAnswer: ea.question.correctAnswer,
        questionType: ea.question.questionType,
      }));

      // Prepare user answers (include unanswered questions)
      const userAnswers = exam.examAnswers.map((ea: any) => {
        const submitted = answerMap.get(ea.questionId);
        return {
          questionId: ea.questionId,
          answer: submitted?.answer ?? null,
          timeSpentSeconds: submitted?.timeSpentSeconds ?? 0,
        };
      });

      const gradedAnswers = gradeAnswers(userAnswers, questions);

      // Calculate score
      const timeTaken = Math.floor(
        (now.getTime() - exam.startedAt.getTime()) / 1000,
      );
      const scoring = calculateExamScore(
        gradedAnswers,
        exam.totalQuestions,
        exam.examType,
        exam.isRetake,
        exam.isCollaboration,
      );

      // Finalize exam and score updates in a single transaction to avoid double-submit races.
      const result = await prisma.$transaction(async (tx: any) => {
        const finalizeExam = await tx.exam.updateMany({
          where: {
            id: examId,
            userId,
            status: EXAM_STATUS.IN_PROGRESS as any,
          },
          data: {
            score: scoring.rawScore,
            percentage: scoring.percentage,
            spEarned: scoring.spEarned,
            timeTakenSeconds: timeTaken,
            status: EXAM_STATUS.COMPLETED as any,
            completedAt: now,
          },
        });

        if (finalizeExam.count !== 1) {
          throw new AppError(
            "Exam has already been submitted or is no longer active.",
            409,
            EXAM_ERROR_CODES.EXAM_ALREADY_COMPLETED,
          );
        }

        const valuesClause = gradedAnswers
          .map((_, index) => {
            const base = index * 6;
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
          })
          .join(", ");

        const params: Array<number | string | boolean | null | Date> = [];
        for (const answer of gradedAnswers) {
          params.push(
            examId,
            answer.questionId,
            answer.userAnswer,
            answer.isCorrect,
            answer.timeSpentSeconds,
            now,
          );
        }

        await tx.$executeRawUnsafe(
          `
                UPDATE "ExamAnswer" AS ea
                SET
                    "userAnswer" = v."userAnswer"::text,
                    "isCorrect" = v."isCorrect"::boolean,
                    "timeSpentSeconds" = v."timeSpentSeconds"::integer,
                    "answeredAt" = v."answeredAt"::timestamp
                FROM (VALUES ${valuesClause}) AS v("examId", "questionId", "userAnswer", "isCorrect", "timeSpentSeconds", "answeredAt")
                WHERE ea."examId" = v."examId"::integer AND ea."questionId" = v."questionId"::integer
                `,
          ...params,
        );

        // Update user stats
        const userStats = await updateUserStats(
          tx,
          userId,
          scoring.spEarned,
          exam.examType,
          exam.isCollaboration,
          exam.institutionId,
        );

        // Update question statistics
        await updateQuestionStats(tx, gradedAnswers);

        return { userStats };
      });

      // Build response with full question details
      const questionsWithAnswers: QuestionWithAnswer[] = exam.examAnswers.map(
        (ea: any) => {
          const graded = gradedAnswers.find(
            (g) => g.questionId === ea.questionId,
          )!;
          return {
            id: ea.question.id,
            questionText: ea.question.questionText,
            hasImage: ea.question.hasImage,
            imageUrl: ea.question.imageUrl,
            optionA: ea.question.optionA,
            optionB: ea.question.optionB,
            optionC: ea.question.optionC,
            optionD: ea.question.optionD,
            optionAImageUrl: ea.question.optionAImageUrl,
            optionBImageUrl: ea.question.optionBImageUrl,
            optionCImageUrl: ea.question.optionCImageUrl,
            optionDImageUrl: ea.question.optionDImageUrl,
            optionE: (ea.question as any).optionE,
            optionEImageUrl: (ea.question as any).optionEImageUrl,
            parentQuestionText:
              (ea.question as any).parentQuestion?.questionText ?? null,
            parentQuestionImageUrl:
              (ea.question as any).parentQuestion?.imageUrl ?? null,
            subject: normalizeSubjectLabel(ea.question.subject),
            topic: ea.question.topic,
            correctAnswer: ea.question.correctAnswer,
            userAnswer: graded.userAnswer,
            isCorrect: graded.isCorrect,
            timeSpentSeconds: graded.timeSpentSeconds,
            explanation: ea.question.explanation
              ? {
                  text: ea.question.explanation.explanationText,
                  imageUrl: ea.question.explanation.explanationImageUrl,
                  additionalNotes: ea.question.explanation.additionalNotes,
                }
              : undefined,
          };
        },
      );

      const naming = buildExamDisplayNames(
        exam.examType as any,
        exam.subjectsIncluded,
        exam.sessionNumber,
      );

      await this.bumpExamHistoryVersion(userId);

      try {
        await runLeaderboardIntegrityChecks({
          userId,
          examId,
          examType: exam.examType as any,
          totalQuestions: exam.totalQuestions,
          spEarned: scoring.spEarned,
          percentage: scoring.percentage,
          timeTakenSeconds: timeTaken,
          isCollaboration: exam.isCollaboration,
          isRetake: exam.isRetake,
        });
      } catch {
        // Non-blocking by design: leaderboard integrity checks must never fail exam submission.
      }

      // Invalidate leaderboard cache if SP was earned to ensure immediate visibility
      if (scoring.spEarned > 0 && exam.institutionId) {
        try {
          await this.leaderboardService.deleteCache(exam.institutionId, "WEEKLY");
          await this.leaderboardService.deleteCache(exam.institutionId, "ALL_TIME");
        } catch {
          // Non-blocking
        }
      }

      return {
        examId: exam.id,
        examType: exam.examType as any,
        subjects: exam.subjectsIncluded,
        sessionNumber: exam.sessionNumber,
        displayNameLong: naming.displayNameLong,
        displayNameShort: naming.displayNameShort,
        totalQuestions: exam.totalQuestions,
        score: scoring.rawScore,
        percentage: scoring.percentage,
        spEarned: scoring.spEarned,
        spMultiplier: scoring.multiplier,
        timeTakenSeconds: timeTaken,
        isRetake: exam.isRetake,
        attemptNumber: exam.attemptNumber,
        startedAt: exam.startedAt.toISOString(),
        completedAt: now.toISOString(),
        questions: questionsWithAnswers,
        stats: result.userStats,
      };
    } finally {
      await this.releaseSubmitLock(examId, submitLockOwner);
    }
  }

  /* Get questions for an in-progress exam */
  async getExamQuestions(
    userId: number,
    examId: number,
  ): Promise<ExamSessionResponse> {
    const exam = await prisma.exam.findFirst({
      where: {
        id: examId,
        userId: userId,
      },
      include: {
        examAnswers: {
          include: {
            question: {
              include: {
                parentQuestion: true,
              },
            },
          },
        },
      },
    });

    if (!exam) {
      throw new AppError("Exam not found", 404);
    }

    if (exam.status !== EXAM_STATUS.IN_PROGRESS) {
      throw new AppError("Exam is not in progress", 400);
    }

    const durationSeconds = await this.getConfiguredExamDurationSeconds(exam);
    const expiresAt = new Date(
      exam.startedAt.getTime() +
        durationSeconds * 1000 +
        EXAM_CONFIG.SUBMISSION_GRACE_PERIOD_SECONDS * 1000,
    );

    // Check if expired
    if (new Date() > expiresAt) {
      // Auto-abandon expired exam
      await prisma.exam.update({
        where: { id: examId },
        data: { status: EXAM_STATUS.ABANDONED as any },
      });
      throw new AppError("Exam time has expired", 400);
    }

    const questionsForClient: QuestionForClient[] = exam.examAnswers.map(
      (ea: any) => ({
        id: ea.question.id,
        questionText: ea.question.questionText,
        hasImage: ea.question.hasImage,
        imageUrl: ea.question.imageUrl,
        optionA: ea.question.optionA,
        optionB: ea.question.optionB,
        optionC: ea.question.optionC,
        optionD: ea.question.optionD,
        optionAImageUrl: ea.question.optionAImageUrl,
        optionBImageUrl: ea.question.optionBImageUrl,
        optionCImageUrl: ea.question.optionCImageUrl,
        optionDImageUrl: ea.question.optionDImageUrl,
        optionE: (ea.question as any).optionE,
        optionEImageUrl: (ea.question as any).optionEImageUrl,
        parentQuestionText:
          (ea.question as any).parentQuestion?.questionText ?? null,
        parentQuestionImageUrl:
          (ea.question as any).parentQuestion?.imageUrl ?? null,
        subject: normalizeSubjectLabel(ea.question.subject),
        topic: ea.question.topic,
      }),
    );

    const naming = buildExamDisplayNames(
      exam.examType as any,
      exam.subjectsIncluded,
      exam.sessionNumber,
    );

    return {
      examId: exam.id,
      examType: exam.examType as any,
      subjects: exam.subjectsIncluded,
      sessionNumber: exam.sessionNumber,
      displayNameLong: naming.displayNameLong,
      displayNameShort: naming.displayNameShort,
      totalQuestions: exam.totalQuestions,
      timeAllowedSeconds: durationSeconds,
      startedAt: exam.startedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      questions: questionsForClient,
    };
  }

  /* Get user's exam history with pagination */
  async getExamHistory(
    userId: number,
    query: ExamHistoryQuery,
  ): Promise<ExamHistoryResponse> {
    const institution = await institutionContextService.resolveForUser(
      userId,
      query.institutionCode,
    );
    const cache = getCacheAdapter();
    const version =
      (await cache.get(this.examHistoryVersionKey(userId))) ?? "0";
    const cacheKey = this.examHistoryCacheKey(userId, query, version);

    const cached = await getJson<ExamHistoryResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    // Build filter
    const where: any = { userId, institutionId: institution.id };
    if (query.examType) where.examType = query.examType;
    if (query.status) where.status = query.status;

    // Get exams with count
    const [exams, total] = await Promise.all([
      prisma.exam.findMany({
        where,
        orderBy: { startedAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          examType: true,
          nameScopeKey: true,
          sessionNumber: true,
          subjectsIncluded: true,
          totalQuestions: true,
          score: true,
          percentage: true,
          spEarned: true,
          status: true,
          isRetake: true,
          attemptNumber: true,
          maxRetakes: true,
          originalExamId: true,
          startedAt: true,
          completedAt: true,
          timeTakenSeconds: true,
        },
      }),
      prisma.exam.count({ where }),
    ]);

    const completedOriginalIds = Array.from(
      new Set(
        exams
          .filter((exam: any) => exam.status === EXAM_STATUS.COMPLETED)
          .map((exam: any) =>
            exam.isRetake && exam.originalExamId
              ? exam.originalExamId
              : exam.id,
          ),
      ),
    );

    const retakeCountsByOriginalId = new Map<number, number>();
    if (completedOriginalIds.length > 0) {
      const groupedRetakes = await prisma.exam.groupBy({
        by: ["originalExamId"],
        where: {
          userId,
          originalExamId: { in: completedOriginalIds },
        },
        _count: { _all: true },
      });

      for (const row of groupedRetakes) {
        if (row.originalExamId) {
          retakeCountsByOriginalId.set(row.originalExamId, row._count._all);
        }
      }
    }

    const examsWithRetakes = exams.map((exam: any) => {
      let retakesRemaining = 0;

      if (exam.status === EXAM_STATUS.COMPLETED) {
        const originalId =
          exam.isRetake && exam.originalExamId ? exam.originalExamId : exam.id;
        const retakeCount = retakeCountsByOriginalId.get(originalId) ?? 0;
        retakesRemaining =
          (exam.maxRetakes ?? EXAM_CONFIG.MAX_RETAKES) - retakeCount;
        if (retakesRemaining < 0) retakesRemaining = 0;
      }

      const naming = buildExamDisplayNames(
        exam.examType as any,
        exam.subjectsIncluded,
        exam.sessionNumber,
      );

      return {
        id: exam.id,
        examType: exam.examType as any,
        subjects: exam.subjectsIncluded,
        sessionNumber: exam.sessionNumber,
        displayNameLong: naming.displayNameLong,
        displayNameShort: naming.displayNameShort,
        totalQuestions: exam.totalQuestions,
        score: exam.score,
        percentage: exam.percentage ?? 0,
        spEarned: exam.spEarned,
        status: exam.status as any,
        isRetake: exam.isRetake,
        attemptNumber: exam.attemptNumber,
        retakesRemaining,
        startedAt: exam.startedAt.toISOString(),
        completedAt: exam.completedAt?.toISOString() ?? null,
        timeTakenSeconds: exam.timeTakenSeconds,
      };
    });

    const aggregate = await prisma.exam.aggregate({
      where: {
        userId,
        status: EXAM_STATUS.COMPLETED as any,
      },
      _count: { _all: true },
      _sum: { spEarned: true },
      _avg: { percentage: true },
      _max: { percentage: true },
    });

    const totalExams = aggregate._count._all ?? 0;
    const totalSpEarned = aggregate._sum.spEarned ?? 0;
    const averageScore = aggregate._avg.percentage
      ? Math.round(aggregate._avg.percentage * 10) / 10
      : 0;
    const bestScore = aggregate._max.percentage
      ? Math.round(aggregate._max.percentage)
      : 0;

    const response: ExamHistoryResponse = {
      exams: examsWithRetakes,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      stats: {
        totalExams,
        averageScore,
        totalSpEarned,
        bestScore,
      },
    };

    await setJson(
      cacheKey,
      response,
      ExamsService.EXAM_HISTORY_CACHE_TTL_SECONDS,
    );
    return response;
  }

  /* Get full exam details with answers (for completed exams) */
  async getExamDetails(
    userId: number,
    examId: number,
  ): Promise<ExamResultResponse> {
    const exam = await prisma.exam.findFirst({
      where: {
        id: examId,
        userId: userId,
      },
      include: {
        examAnswers: {
          include: {
            question: {
              include: {
                explanation: true,
                parentQuestion: true,
              },
            },
          },
        },
      },
    });

    if (!exam) {
      throw new AppError("Exam not found", 404);
    }

    if (exam.status !== EXAM_STATUS.COMPLETED) {
      throw new AppError("Exam is not completed yet", 400);
    }

    // Get user stats
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        totalSp: true,
        weeklySp: true,
        currentStreak: true,
        longestStreak: true,
        lastActivityDate: true,
        streakFreezesAvailable: true,
      },
    });

    const effectiveCurrentStreak = user
      ? deriveStreakSnapshot(
          user.currentStreak,
          user.longestStreak,
          user.lastActivityDate ? new Date(user.lastActivityDate) : null,
          new Date(),
          user.streakFreezesAvailable,
        ).currentStreak
      : 0;

    const questionsWithAnswers: QuestionWithAnswer[] = exam.examAnswers.map(
      (ea: any) => ({
        id: ea.question.id,
        questionText: ea.question.questionText,
        hasImage: ea.question.hasImage,
        imageUrl: ea.question.imageUrl,
        optionA: ea.question.optionA,
        optionB: ea.question.optionB,
        optionC: ea.question.optionC,
        optionD: ea.question.optionD,
        optionAImageUrl: ea.question.optionAImageUrl,
        optionBImageUrl: ea.question.optionBImageUrl,
        optionCImageUrl: ea.question.optionCImageUrl,
        optionDImageUrl: ea.question.optionDImageUrl,
        optionE: (ea.question as any).optionE,
        optionEImageUrl: (ea.question as any).optionEImageUrl,
        parentQuestionText:
          (ea.question as any).parentQuestion?.questionText ?? null,
        parentQuestionImageUrl:
          (ea.question as any).parentQuestion?.imageUrl ?? null,
        subject: normalizeSubjectLabel(ea.question.subject),
        topic: ea.question.topic,
        correctAnswer: ea.question.correctAnswer,
        userAnswer: ea.userAnswer,
        isCorrect: ea.isCorrect,
        timeSpentSeconds: ea.timeSpentSeconds,
        explanation: ea.question.explanation
          ? {
              text: ea.question.explanation.explanationText,
              imageUrl: ea.question.explanation.explanationImageUrl,
              additionalNotes: ea.question.explanation.additionalNotes,
            }
          : undefined,
      }),
    );

    // Expose the effective SP multiplier used for the saved result.
    const multiplier =
      exam.score > 0
        ? Math.round((exam.spEarned / exam.score) * 100) / 100
        : exam.isRetake
          ? 0.5
          : exam.examType === EXAM_TYPES.PRACTICE
            ? 0.5
            : exam.examType === EXAM_TYPES.MIXED
              ? 0.75
              : exam.isCollaboration
                ? 1.5
                : 1.0;

    const naming = buildExamDisplayNames(
      exam.examType as any,
      exam.subjectsIncluded,
      exam.sessionNumber,
    );

    return {
      examId: exam.id,
      examType: exam.examType as any,
      subjects: exam.subjectsIncluded,
      sessionNumber: exam.sessionNumber,
      displayNameLong: naming.displayNameLong,
      displayNameShort: naming.displayNameShort,
      totalQuestions: exam.totalQuestions,
      score: exam.score,
      percentage: exam.percentage ?? 0,
      spEarned: exam.spEarned,
      spMultiplier: multiplier,
      timeTakenSeconds: exam.timeTakenSeconds ?? 0,
      isRetake: exam.isRetake,
      attemptNumber: exam.attemptNumber,
      startedAt: exam.startedAt.toISOString(),
      completedAt: exam.completedAt?.toISOString() ?? "",
      questions: questionsWithAnswers,
      stats: {
        totalSp: user?.totalSp ?? 0,
        weeklySp: user?.weeklySp ?? 0,
        currentStreak: effectiveCurrentStreak,
      },
    };
  }

  /* Create a retake of an existing exam */
  async retakeExam(
    userId: number,
    examId: number,
    idempotencyKey?: string,
  ): Promise<ExamSessionResponse> {
    if (idempotencyKey) {
      const routeKey = buildRouteKey("POST", "/api/exams/:examId/retake", {
        examId,
      });
      return idempotencyService.execute(
        {
          userId,
          routeKey,
          idempotencyKey,
          payload: { examId },
        },
        () => this.retakeExam(userId, examId),
      );
    }

    await this.enforceStartRateLimit(userId);

    // Get original exam details
    const originalId = await getOriginalExamId(examId);
    const originalExam = await prisma.exam.findUnique({
      where: { id: originalId },
      select: {
        examType: true,
        subjectsIncluded: true,
        totalQuestions: true,
        maxRetakes: true,
        institutionId: true,
      },
    });

    if (!originalExam) {
      throw new AppError("Original exam not found", 404);
    }

    // Allow retakes for non-premium users only for the free full real UI exam.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isPremium: true },
    });
    if (!user?.isPremium) {
      const isEligibleFreeRetake =
        originalExam.examType === EXAM_TYPES.REAL_PAST_QUESTION &&
        this.isFullSoloExam(originalExam.subjectsIncluded);

      if (!isEligibleFreeRetake) {
        throw new AppError(
          "Free users can only retake the full UI real exam. Upgrade to premium to unlock other retakes.",
          403,
        );
      }
    }

    const config =
      await institutionExamConfigService.getActiveConfigForInstitutionId(
        originalExam.institutionId ??
          (await institutionContextService.resolveByCode()).id,
      );

    const effectiveMaxRetakes = user?.isPremium
      ? (originalExam.maxRetakes ?? EXAM_CONFIG.MAX_RETAKES)
      : this.getMaxRetakesForExam(
          false,
          originalExam.examType,
          originalExam.subjectsIncluded,
          config,
        );

    const eligibility = await checkRetakeEligibility(
      userId,
      examId,
      effectiveMaxRetakes,
    );
    if (!eligibility.canRetake) {
      if (
        !user?.isPremium &&
        eligibility.errorCode === EXAM_ERROR_CODES.MAX_RETAKES_REACHED
      ) {
        throw new AppError(
          `You have used all ${config.freeFullRealTotalAttempts} attempts on your free full UI exam. Upgrade to premium to continue.`,
          403,
          EXAM_ERROR_CODES.FREE_LIMIT_REACHED,
        );
      }

      throw new AppError(eligibility.reason!, 400);
    }

    // Get shuffled questions for retake
    const questions = await selectQuestionsForRetake(originalId);
    const durationSeconds =
      institutionExamConfigService.calculateDurationSeconds(
        originalExam.subjectsIncluded.length,
        config,
      );
    const startedAt = new Date();
    const scopeKey = buildScopeKeyFromExamType(
      originalExam.examType as any,
      originalExam.subjectsIncluded as any,
    );
    const expiresAt = new Date(
      startedAt.getTime() +
        durationSeconds * 1000 +
        EXAM_CONFIG.SUBMISSION_GRACE_PERIOD_SECONDS * 1000,
    );

    // Create retake exam in transaction
    const exam = await prisma.$transaction(async (tx: any) => {
      const sessionNumber = await this.nextExamSessionNumber(
        tx,
        userId,
        scopeKey,
      );
      const newExam = await tx.exam.create({
        data: {
          userId,
          institutionId: originalExam.institutionId,
          examType: originalExam.examType,
          nameScopeKey: scopeKey,
          sessionNumber,
          subjectsIncluded: originalExam.subjectsIncluded,
          totalQuestions: originalExam.totalQuestions,
          score: 0,
          percentage: 0,
          spEarned: 0,
          status: EXAM_STATUS.IN_PROGRESS as any,
          startedAt,
          isRetake: true,
          attemptNumber: eligibility.attemptNumber,
          originalExamId: originalId,
          maxRetakes: effectiveMaxRetakes,
        },
      });

      // Create placeholder answers
      const answerRecords = questions.map((q) => ({
        examId: newExam.id,
        questionId: q.id,
        userAnswer: null,
        isCorrect: false,
        timeSpentSeconds: 0,
      }));

      await tx.examAnswer.createMany({ data: answerRecords });

      return newExam;
    });

    const naming = buildExamDisplayNames(
      originalExam.examType as any,
      originalExam.subjectsIncluded as any,
      exam.sessionNumber,
    );

    // Prepare response
    const questionsForClient: QuestionForClient[] = questions.map((q) => ({
      id: q.id,
      questionText: q.questionText,
      hasImage: q.hasImage,
      imageUrl: q.imageUrl,
      optionA: q.optionA,
      optionB: q.optionB,
      optionC: q.optionC,
      optionD: q.optionD,
      optionE: q.optionE,
      optionAImageUrl: q.optionAImageUrl,
      optionBImageUrl: q.optionBImageUrl,
      optionCImageUrl: q.optionCImageUrl,
      optionDImageUrl: q.optionDImageUrl,
      optionEImageUrl: q.optionEImageUrl,
      parentQuestionText: q.parentQuestionText ?? null,
      parentQuestionImageUrl: q.parentQuestionImageUrl ?? null,
      subject: normalizeSubjectLabel(q.subject),
      topic: q.topic,
    }));

    await this.bumpExamHistoryVersion(userId);

    return {
      examId: exam.id,
      examType: originalExam.examType as any,
      subjects: originalExam.subjectsIncluded,
      sessionNumber: exam.sessionNumber,
      displayNameLong: naming.displayNameLong,
      displayNameShort: naming.displayNameShort,
      totalQuestions: originalExam.totalQuestions,
      timeAllowedSeconds: durationSeconds,
      startedAt: startedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      questions: questionsForClient,
    };
  }

  /* Abandon an in-progress exam */
  async abandonExam(
    userId: number,
    examId: number,
  ): Promise<{ examId: number; status: string; message: string }> {
    const exam = await prisma.exam.findFirst({
      where: {
        id: examId,
        userId: userId,
      },
    });

    if (!exam) {
      throw new AppError("Exam not found", 404);
    }

    if (exam.status !== EXAM_STATUS.IN_PROGRESS) {
      throw new AppError("Can only abandon in-progress exams", 400);
    }

    const updatedExam = await prisma.exam.update({
      where: { id: examId },
      data: {
        status: EXAM_STATUS.ABANDONED as any,
        completedAt: new Date(),
      },
    });

    await this.bumpExamHistoryVersion(userId);

    return {
      examId: updatedExam.id,
      status: updatedExam.status,
      message: "Exam abandoned successfully",
    };
  }
  /* Report an anti-cheat violation.
   *
   * Designed for zero-latency: no blocking DB calls on the hot path.
   *
   * 1. Redis rate-limit (1 per exam per 10s) prevents DB spam.
   * 2. No exam ownership check — route is already authenticated via
   *    `preValidation: [app.authenticate]`, and the userId is embedded
   *    in the audit log so there is no integrity risk.
   * 3. Audit log write is fire-and-forget (non-blocking).
   */
  async reportViolation(
    userId: number,
    examId: number,
    payload: { violationType: string; metadata?: any },
  ) {
    // ── Rate-limit: max 1 violation per exam per 10 seconds ──
    const cache = getCacheAdapter();
    if (cache.available) {
      const rateKey = `exam:violation:rate:${examId}:${userId}`;
      try {
        const count = await cache.incr(rateKey);
        if (count === 1) {
          await cache.expire(rateKey, 10);
        }
        if (count > 1) {
          // Duplicate within window — silently acknowledge without DB write
          return { recorded: true };
        }
      } catch {
        // Redis failure must not block violation recording
      }
    }

    // ── Fire-and-forget audit log write ──
    prisma.auditLog
      .create({
        data: {
          userId,
          action: "EXAM_CHEAT_VIOLATION" as any,
          metadata: {
            examId,
            violationType: payload.violationType,
            violationCount: payload.metadata?.count ?? 1,
            timestamp: new Date().toISOString(),
            ...payload.metadata,
          },
        },
      })
      .catch((err: unknown) => {
        console.warn(
          "[ExamViolation] Failed to write audit log:",
          (err as Error).message,
        );
      });

    return { recorded: true };
  }
}

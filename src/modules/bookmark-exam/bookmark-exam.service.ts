import { prisma } from '../../config/database';
import { AppError } from '../../shared/errors/AppError';
import {
  evaluateBookmarkExamGate,
  BOOKMARK_EXAM_MIN_QUESTIONS
} from '../../shared/gates/bookmark-exam-gate';
import { EXAM_TYPES, EXAM_STATUS, EXAM_CONFIG } from '../exams/exams.constants';
import {
  shuffleArray,
  shuffleQuestionOptions
} from '../exams/question-selector';
import {
  buildScopeKeyFromExamType,
  buildExamDisplayNames,
  canonicalizeSubjects
} from '../../shared/utils/examNaming';
import { normalizeSubjectLabel } from '../../shared/utils/subjects';
import type { ExamSessionResponse, QuestionForClient, QuestionWithMeta } from '../exams/exams.types';

/** Seconds per question for bookmark exams (22 min ÷ 25 questions ≈ 52.8s) */
const SECONDS_PER_QUESTION = 53;
/** Maximum exam duration cap (same as full exam) */
const MAX_DURATION_SECONDS = 90 * 60;

export class BookmarkExamService {
  /**
   * Start a bookmark exam for the authenticated user.
   *
   * 1. Evaluate gate (premium + minimum bookmarks)
   * 2. Fetch bookmarked question IDs (active, non-expired)
   * 3. Shuffle server-side (Fisher-Yates)
   * 4. Create exam session via existing schema (Exam + ExamAnswer rows)
   * 5. Return ExamSessionResponse — frontend navigates to /exams/[examId]
   */
  async startBookmarkExam(
    userId: number,
    subjectFilter?: string
  ): Promise<ExamSessionResponse> {
    // 1. Fetch user premium status
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isPremium: true }
    });

    if (!user) {
      throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
    }

    // 2. Count active (non-expired) bookmarks
    const now = new Date();
    const activeBookmarkWhere = {
      userId,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } }
      ],
      ...(subjectFilter ? { question: { subject: subjectFilter } } : {})
    };

    const bookmarkCount = await prisma.bookmarkedQuestion.count({
      where: activeBookmarkWhere
    });

    // 3. Evaluate gate
    const gate = evaluateBookmarkExamGate(bookmarkCount, user.isPremium);

    if (gate.status === 'LOCKED_PREMIUM') {
      throw new AppError(
        'Bookmark Exam is a premium feature. Upgrade to unlock it.',
        403,
        'BOOKMARK_EXAM_PREMIUM_REQUIRED',
        { bookmarkCount: gate.bookmarkCount }
      );
    }

    if (gate.status === 'LOCKED_INSUFFICIENT') {
      throw new AppError(
        `You need at least ${BOOKMARK_EXAM_MIN_QUESTIONS} bookmarks to start a Bookmark Exam. You have ${gate.bookmarkCount}.`,
        403,
        'BOOKMARK_EXAM_INSUFFICIENT_BOOKMARKS',
        {
          bookmarkCount: gate.bookmarkCount,
          required: gate.required
        }
      );
    }

    // 4. Fetch bookmarked question IDs
    const bookmarks = await prisma.bookmarkedQuestion.findMany({
      where: activeBookmarkWhere,
      select: { questionId: true, question: { select: { subject: true } } },
      take: 50 // Natural ceiling = premium bookmark limit
    });

    const questionIds = bookmarks.map((b: any) => b.questionId);

    // 5. Shuffle question IDs server-side (exam integrity)
    const shuffledIds = shuffleArray(questionIds);

    // 6. Hydrate full question data
    const rawQuestions = await prisma.question.findMany({
      where: { id: { in: shuffledIds } },
      include: {
        parentQuestion: {
          select: { questionText: true, imageUrl: true }
        }
      }
    });

    // Map to QuestionWithMeta and shuffle options
    const questionMap = new Map(rawQuestions.map((q: any) => [q.id, q]));
    const questions: QuestionWithMeta[] = shuffledIds
      .map(id => questionMap.get(id))
      .filter((q): q is NonNullable<typeof q> => q !== undefined)
      .map(q => {
        const formatted = {
          ...q,
          parentQuestionText: (q as any).parentQuestion?.questionText ?? null,
          parentQuestionImageUrl: (q as any).parentQuestion?.imageUrl ?? null,
        } as QuestionWithMeta;
        return shuffleQuestionOptions(formatted);
      });

    if (questions.length < BOOKMARK_EXAM_MIN_QUESTIONS) {
      throw new AppError(
        'Not enough valid bookmarked questions to start the exam.',
        422,
        'BOOKMARK_EXAM_INSUFFICIENT_QUESTIONS'
      );
    }

    // 7. Derive subjects from the actual questions
    const subjectsSet = new Set(questions.map(q => normalizeSubjectLabel(q.subject)));
    const subjects = canonicalizeSubjects(Array.from(subjectsSet));

    // 8. Calculate duration
    const totalQuestions = questions.length;
    const durationSeconds = Math.min(
      totalQuestions * SECONDS_PER_QUESTION,
      MAX_DURATION_SECONDS
    );

    // 9. Build naming
    const scopeKey = buildScopeKeyFromExamType(EXAM_TYPES.BOOKMARK_EXAM, subjects);
    const startedAt = new Date();
    const expiresAt = new Date(
      startedAt.getTime() +
      durationSeconds * 1000 +
      EXAM_CONFIG.SUBMISSION_GRACE_PERIOD_SECONDS * 1000
    );

    // 10. Create exam in transaction
    const exam = await prisma.$transaction(async (tx: any) => {
      // Get next session number
      const counter = await tx.examSessionCounter.upsert({
        where: {
          userId_scopeKey: { userId, scopeKey }
        },
        create: { userId, scopeKey, currentValue: 1 },
        update: { currentValue: { increment: 1 } },
        select: { currentValue: true }
      });

      const newExam = await tx.exam.create({
        data: {
          userId,
          institutionId: null,
          examType: EXAM_TYPES.BOOKMARK_EXAM as any,
          nameScopeKey: scopeKey,
          sessionNumber: counter.currentValue,
          subjectsIncluded: subjects,
          totalQuestions,
          score: 0,
          percentage: 0,
          spEarned: 0,
          status: EXAM_STATUS.IN_PROGRESS as any,
          startedAt,
          isRetake: false,
          attemptNumber: 1,
          maxRetakes: 0,
        }
      });

      // Create placeholder exam answers
      const answerRecords = questions.map(q => ({
        examId: newExam.id,
        questionId: q.id,
        userAnswer: null,
        isCorrect: false,
        timeSpentSeconds: 0,
      }));

      await tx.examAnswer.createMany({ data: answerRecords });

      return newExam;
    });

    // 11. Build response
    const naming = buildExamDisplayNames(
      EXAM_TYPES.BOOKMARK_EXAM,
      subjects,
      exam.sessionNumber
    );

    const questionsForClient: QuestionForClient[] = questions.map(q => ({
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

    return {
      examId: exam.id,
      examType: EXAM_TYPES.BOOKMARK_EXAM as any,
      subjects,
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
}

export const bookmarkExamService = new BookmarkExamService();

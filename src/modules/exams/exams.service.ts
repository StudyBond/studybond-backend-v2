// ============================================
// EXAMS SERVICE
// ============================================
// Core business logic for exam operations
// All database operations use atomic transactions

import { prisma } from '../../config/database';
import { AppError } from '../../shared/errors/AppError';
import {
    EXAM_CONFIG,
    EXAM_STATUS,
    EXAM_TYPES,
    EXAM_ERROR_CODES,
    PREMIUM_LIMITS
} from './exams.constants';
import {
    StartExamInput,
    SubmitExamInput,
    ExamHistoryQuery,
    ExamSessionResponse,
    ExamResultResponse,
    ExamHistoryResponse,
    QuestionForClient,
    QuestionWithAnswer,
    EligibilityCheck
} from './exams.types';
import {
    selectQuestionsForExam,
    selectQuestionsForRetake,
    calculateTotalQuestions,
    calculateExamDuration
} from './question-selector';
import {
    calculateExamScore,
    gradeAnswers,
    updateUserStats,
    updateQuestionStats
} from './scoring-engine';
import {
    checkRetakeEligibility,
    getOriginalExamId
} from './retake-handler';

export class ExamsService {
    // ============================================
    // ELIGIBILITY CHECKS
    // ============================================

    /**
     * Check if user can start a new exam
     */
    async checkExamEligibility(
        userId: number,
        examType: string
    ): Promise<EligibilityCheck> {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                isPremium: true,
                hasTakenFreeExam: true,
                realExamsCompleted: true
            }
        });

        if (!user) {
            return {
                canTakeExam: false,
                reason: 'User not found',
                errorCode: 'USER_NOT_FOUND'
            };
        }

        // Premium users: Check daily limit for real exams
        if (user.isPremium) {
            if (examType === EXAM_TYPES.REAL_PAST_QUESTION) {
                // Calculate start of today in GMT+1 (Nigerian Time)
                const now = new Date();
                // Get offset for GMT+1 in milliseconds (1 hour * 60 min * 60 sec * 1000)
                const gmt1Offset = 60 * 60 * 1000;

                // UTC time + 1 hour gives us the time in GMT+1
                const nowGmt1 = new Date(now.getTime() + gmt1Offset);

                // Reset to start of day (00:00:00)
                nowGmt1.setUTCHours(0, 0, 0, 0);

                // Subtract the offset to get the UTC timestamp for 00:00:00 GMT+1
                const startOfDayGmt1 = new Date(nowGmt1.getTime() - gmt1Offset);

                const examsToday = await prisma.exam.count({
                    where: {
                        userId: userId,
                        examType: EXAM_TYPES.REAL_PAST_QUESTION,
                        startedAt: {
                            gte: startOfDayGmt1
                        }
                    }
                });

                if (examsToday >= PREMIUM_LIMITS.DAILY_REAL_EXAMS) {
                    return {
                        canTakeExam: false,
                        reason: "You've completed today's optimal number of full exams. Review time 😌",
                        errorCode: EXAM_ERROR_CODES.DAILY_LIMIT_REACHED
                    };
                }
            }
            return { canTakeExam: true };
        }

        // Free users: Check if they've used their free real exam
        if (examType === EXAM_TYPES.REAL_PAST_QUESTION) {
            if (user.hasTakenFreeExam) {
                return {
                    canTakeExam: false,
                    reason: 'Free exam limit reached. Upgrade to premium for unlimited exams.',
                    errorCode: EXAM_ERROR_CODES.FREE_LIMIT_REACHED
                };
            }
        }

        // Free users cannot take practice exams
        if (examType === EXAM_TYPES.PRACTICE) {
            return {
                canTakeExam: false,
                reason: 'Practice exams require premium subscription.',
                errorCode: EXAM_ERROR_CODES.PREMIUM_REQUIRED
            };
        }

        return { canTakeExam: true };
    }

    // ============================================
    // START EXAM
    // ============================================

    /**
     * Start a new exam session
     */
    async startExam(
        userId: number,
        input: StartExamInput
    ): Promise<ExamSessionResponse> {
        // Check eligibility
        const eligibility = await this.checkExamEligibility(userId, input.examType);
        if (!eligibility.canTakeExam) {
            throw new AppError(eligibility.reason!, 403);
        }

        // Calculate exam parameters
        const totalQuestions = calculateTotalQuestions(input.subjects.length);
        const durationSeconds = calculateExamDuration(totalQuestions);

        // Select questions
        const questions = await selectQuestionsForExam(
            input.subjects,
            input.examType,
            EXAM_CONFIG.QUESTIONS_PER_SUBJECT
        );

        const startedAt = new Date();
        const expiresAt = new Date(startedAt.getTime() + (durationSeconds * 1000) + (EXAM_CONFIG.SUBMISSION_GRACE_PERIOD_SECONDS * 1000));

        // Create exam in transaction
        const exam = await prisma.$transaction(async (tx) => {
            // Create exam record
            const newExam = await tx.exam.create({
                data: {
                    userId,
                    examType: input.examType as any,
                    subjectsIncluded: input.subjects,
                    totalQuestions,
                    score: 0,
                    percentage: 0,
                    spEarned: 0,
                    status: EXAM_STATUS.IN_PROGRESS as any,
                    startedAt,
                    isRetake: false,
                    attemptNumber: 1
                }
            });

            // Create placeholder exam answers (for tracking in-progress state)
            const answerRecords = questions.map((q) => ({
                examId: newExam.id,
                questionId: q.id,
                userAnswer: null,
                isCorrect: false,
                timeSpentSeconds: 0
            }));

            await tx.examAnswer.createMany({
                data: answerRecords
            });

            return newExam;
        });

        // Prepare response (without correct answers)
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
            subject: q.subject,
            topic: q.topic
        }));

        return {
            examId: exam.id,
            examType: input.examType,
            subjects: input.subjects,
            totalQuestions,
            timeAllowedSeconds: durationSeconds,
            startedAt: startedAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
            questions: questionsForClient
        };
    }

    // ============================================
    // SUBMIT EXAM
    // ============================================

    /**
     * Submit exam answers and calculate score
     */
    async submitExam(
        userId: number,
        examId: number,
        input: SubmitExamInput
    ): Promise<ExamResultResponse> {
        // Get exam with validation
        const exam = await prisma.exam.findFirst({
            where: {
                id: examId,
                userId: userId
            },
            include: {
                examAnswers: {
                    include: {
                        question: {
                            include: {
                                explanation: true,
                                parentQuestion: true
                            }
                        }
                    }
                }
            }
        });

        if (!exam) {
            throw new AppError('Exam not found', 404);
        }

        if (exam.status !== EXAM_STATUS.IN_PROGRESS) {
            throw new AppError(
                exam.status === EXAM_STATUS.COMPLETED
                    ? 'Exam has already been submitted'
                    : 'Exam has been abandoned',
                400
            );
        }

        // Check for server-side timeout
        const now = new Date();
        const examDuration = calculateExamDuration(exam.totalQuestions);
        const expiresAt = new Date(
            exam.startedAt.getTime() +
            (examDuration * 1000) +
            (EXAM_CONFIG.SUBMISSION_GRACE_PERIOD_SECONDS * 1000)
        );

        if (now > expiresAt) {
            throw new AppError('Exam time has expired', 400);
        }

        // Map submitted answers to question IDs
        const answerMap = new Map(
            input.answers.map(a => [a.questionId, a])
        );

        // Validate all questions belong to this exam
        const examQuestionIds = new Set(exam.examAnswers.map(ea => ea.questionId));
        for (const answer of input.answers) {
            if (!examQuestionIds.has(answer.questionId)) {
                throw new AppError(
                    `Question ${answer.questionId} does not belong to this exam`,
                    400
                );
            }
        }

        // Get questions with correct answers
        const questions = exam.examAnswers.map(ea => ({
            id: ea.question.id,
            correctAnswer: ea.question.correctAnswer
        }));

        // Prepare user answers (include unanswered questions)
        const userAnswers = exam.examAnswers.map(ea => {
            const submitted = answerMap.get(ea.questionId);
            return {
                questionId: ea.questionId,
                answer: submitted?.answer ?? null,
                timeSpentSeconds: submitted?.timeSpentSeconds ?? 0
            };
        });

        // Grade answers
        const gradedAnswers = gradeAnswers(userAnswers, questions);

        // Calculate score
        const timeTaken = Math.floor((now.getTime() - exam.startedAt.getTime()) / 1000);
        const scoring = calculateExamScore(
            gradedAnswers,
            exam.totalQuestions,
            exam.examType,
            exam.isRetake,
            exam.isCollaboration
        );

        // Update everything in a transaction
        const result = await prisma.$transaction(async (tx) => {
            // Update exam record
            const updatedExam = await tx.exam.update({
                where: { id: examId },
                data: {
                    score: scoring.rawScore,
                    percentage: scoring.percentage,
                    spEarned: scoring.spEarned,
                    timeTakenSeconds: timeTaken,
                    status: EXAM_STATUS.COMPLETED as any,
                    completedAt: now
                }
            });

            // Update individual answers
            for (const answer of gradedAnswers) {
                await tx.examAnswer.updateMany({
                    where: {
                        examId: examId,
                        questionId: answer.questionId
                    },
                    data: {
                        userAnswer: answer.userAnswer,
                        isCorrect: answer.isCorrect,
                        timeSpentSeconds: answer.timeSpentSeconds,
                        answeredAt: now
                    }
                });
            }

            // Update user stats
            const userStats = await updateUserStats(
                tx,
                userId,
                scoring.spEarned,
                exam.examType
            );

            // Update question statistics
            await updateQuestionStats(tx, gradedAnswers);

            return { updatedExam, userStats };
        });

        // Build response with full question details
        const questionsWithAnswers: QuestionWithAnswer[] = exam.examAnswers.map(ea => {
            const graded = gradedAnswers.find(g => g.questionId === ea.questionId)!;
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
                parentQuestionText: (ea.question as any).parentQuestion?.questionText ?? null,
                parentQuestionImageUrl: (ea.question as any).parentQuestion?.imageUrl ?? null,
                subject: ea.question.subject,
                topic: ea.question.topic,
                correctAnswer: ea.question.correctAnswer,
                userAnswer: graded.userAnswer,
                isCorrect: graded.isCorrect,
                timeSpentSeconds: graded.timeSpentSeconds,
                explanation: ea.question.explanation ? {
                    text: ea.question.explanation.explanationText,
                    imageUrl: ea.question.explanation.explanationImageUrl,
                    additionalNotes: ea.question.explanation.additionalNotes
                } : undefined
            };
        });

        return {
            examId: exam.id,
            examType: exam.examType as any,
            subjects: exam.subjectsIncluded,
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
            stats: result.userStats
        };
    }

    // ============================================
    // GET EXAM QUESTIONS (In-Progress)
    // ============================================

    /**
     * Get questions for an in-progress exam
     */
    async getExamQuestions(
        userId: number,
        examId: number
    ): Promise<ExamSessionResponse> {
        const exam = await prisma.exam.findFirst({
            where: {
                id: examId,
                userId: userId
            },
            include: {
                examAnswers: {
                    include: {
                        question: {
                            include: {
                                parentQuestion: true
                            }
                        }
                    }
                }
            }
        });

        if (!exam) {
            throw new AppError('Exam not found', 404);
        }

        if (exam.status !== EXAM_STATUS.IN_PROGRESS) {
            throw new AppError('Exam is not in progress', 400);
        }

        const durationSeconds = calculateExamDuration(exam.totalQuestions);
        const expiresAt = new Date(
            exam.startedAt.getTime() +
            (durationSeconds * 1000) +
            (EXAM_CONFIG.SUBMISSION_GRACE_PERIOD_SECONDS * 1000)
        );

        // Check if expired
        if (new Date() > expiresAt) {
            // Auto-abandon expired exam
            await prisma.exam.update({
                where: { id: examId },
                data: { status: EXAM_STATUS.ABANDONED as any }
            });
            throw new AppError('Exam time has expired', 400);
        }

        const questionsForClient: QuestionForClient[] = exam.examAnswers.map(ea => ({
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
            parentQuestionText: (ea.question as any).parentQuestion?.questionText ?? null,
            parentQuestionImageUrl: (ea.question as any).parentQuestion?.imageUrl ?? null,
            subject: ea.question.subject,
            topic: ea.question.topic
        }));

        return {
            examId: exam.id,
            examType: exam.examType as any,
            subjects: exam.subjectsIncluded,
            totalQuestions: exam.totalQuestions,
            timeAllowedSeconds: durationSeconds,
            startedAt: exam.startedAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
            questions: questionsForClient
        };
    }

    // ============================================
    // GET EXAM HISTORY
    // ============================================

    /**
     * Get user's exam history with pagination
     */
    async getExamHistory(
        userId: number,
        query: ExamHistoryQuery
    ): Promise<ExamHistoryResponse> {
        const page = query.page || 1;
        const limit = query.limit || 10;
        const skip = (page - 1) * limit;

        // Build filter
        const where: any = { userId };
        if (query.examType) where.examType = query.examType;
        if (query.status) where.status = query.status;

        // Get exams with count
        const [exams, total] = await Promise.all([
            prisma.exam.findMany({
                where,
                orderBy: { startedAt: 'desc' },
                skip,
                take: limit,
                select: {
                    id: true,
                    examType: true,
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
                    timeTakenSeconds: true
                }
            }),
            prisma.exam.count({ where })
        ]);

        // Calculate retakes remaining for each exam
        const examsWithRetakes = await Promise.all(
            exams.map(async (exam) => {
                let retakesRemaining = 0;

                if (exam.status === EXAM_STATUS.COMPLETED) {
                    const originalId = exam.isRetake && exam.originalExamId
                        ? exam.originalExamId
                        : exam.id;

                    const retakeCount = await prisma.exam.count({
                        where: { originalExamId: originalId, userId }
                    });

                    retakesRemaining = (exam.maxRetakes ?? EXAM_CONFIG.MAX_RETAKES) - retakeCount;
                    if (retakesRemaining < 0) retakesRemaining = 0;
                }

                return {
                    id: exam.id,
                    examType: exam.examType as any,
                    subjects: exam.subjectsIncluded,
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
                    timeTakenSeconds: exam.timeTakenSeconds
                };
            })
        );

        // Calculate aggregate stats
        const completedExams = await prisma.exam.findMany({
            where: {
                userId,
                status: EXAM_STATUS.COMPLETED
            },
            select: {
                score: true,
                totalQuestions: true,
                spEarned: true
            }
        });

        const totalExams = completedExams.length;
        const totalSpEarned = completedExams.reduce((sum, e) => sum + e.spEarned, 0);
        const averageScore = totalExams > 0
            ? Math.round(
                (completedExams.reduce((sum, e) => sum + (e.score / e.totalQuestions * 100), 0) / totalExams) * 10
            ) / 10
            : 0;
        const bestScore = totalExams > 0
            ? Math.max(...completedExams.map(e => Math.round(e.score / e.totalQuestions * 100)))
            : 0;

        return {
            exams: examsWithRetakes,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            },
            stats: {
                totalExams,
                averageScore,
                totalSpEarned,
                bestScore
            }
        };
    }

    // ============================================
    // GET EXAM DETAILS
    // ============================================

    /**
     * Get full exam details with answers (for completed exams)
     */
    async getExamDetails(
        userId: number,
        examId: number
    ): Promise<ExamResultResponse> {
        const exam = await prisma.exam.findFirst({
            where: {
                id: examId,
                userId: userId
            },
            include: {
                examAnswers: {
                    include: {
                        question: {
                            include: {
                                explanation: true,
                                parentQuestion: true
                            }
                        }
                    }
                }
            }
        });

        if (!exam) {
            throw new AppError('Exam not found', 404);
        }

        if (exam.status !== EXAM_STATUS.COMPLETED) {
            throw new AppError('Exam is not completed yet', 400);
        }

        // Get user stats
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                totalSp: true,
                weeklySp: true,
                currentStreak: true
            }
        });

        const questionsWithAnswers: QuestionWithAnswer[] = exam.examAnswers.map(ea => ({
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
            parentQuestionText: (ea.question as any).parentQuestion?.questionText ?? null,
            parentQuestionImageUrl: (ea.question as any).parentQuestion?.imageUrl ?? null,
            subject: ea.question.subject,
            topic: ea.question.topic,
            correctAnswer: ea.question.correctAnswer,
            userAnswer: ea.userAnswer,
            isCorrect: ea.isCorrect,
            timeSpentSeconds: ea.timeSpentSeconds,
            explanation: ea.question.explanation ? {
                text: ea.question.explanation.explanationText,
                imageUrl: ea.question.explanation.explanationImageUrl,
                additionalNotes: ea.question.explanation.additionalNotes
            } : undefined
        }));

        // Get SP multiplier for display
        const multiplier = exam.isRetake
            ? 0.5
            : exam.examType === EXAM_TYPES.PRACTICE
                ? 0.5
                : exam.isCollaboration
                    ? 1.5
                    : 1.0;

        return {
            examId: exam.id,
            examType: exam.examType as any,
            subjects: exam.subjectsIncluded,
            totalQuestions: exam.totalQuestions,
            score: exam.score,
            percentage: exam.percentage ?? 0,
            spEarned: exam.spEarned,
            spMultiplier: multiplier,
            timeTakenSeconds: exam.timeTakenSeconds ?? 0,
            isRetake: exam.isRetake,
            attemptNumber: exam.attemptNumber,
            startedAt: exam.startedAt.toISOString(),
            completedAt: exam.completedAt?.toISOString() ?? '',
            questions: questionsWithAnswers,
            stats: {
                totalSp: user?.totalSp ?? 0,
                weeklySp: user?.weeklySp ?? 0,
                currentStreak: user?.currentStreak ?? 0
            }
        };
    }

    // ============================================
    // RETAKE EXAM
    // ============================================

    /**
     * Create a retake of an existing exam
     */
    async retakeExam(
        userId: number,
        examId: number
    ): Promise<ExamSessionResponse> {
        // Check premium status
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { isPremium: true }
        });

        if (!user?.isPremium) {
            throw new AppError('Retakes require premium subscription', 403);
        }

        // Check eligibility
        const eligibility = await checkRetakeEligibility(userId, examId);
        if (!eligibility.canRetake) {
            throw new AppError(eligibility.reason!, 400);
        }

        // Get original exam details
        const originalId = await getOriginalExamId(examId);
        const originalExam = await prisma.exam.findUnique({
            where: { id: originalId },
            select: {
                examType: true,
                subjectsIncluded: true,
                totalQuestions: true
            }
        });

        if (!originalExam) {
            throw new AppError('Original exam not found', 404);
        }

        // Get shuffled questions for retake
        const questions = await selectQuestionsForRetake(originalId);
        const durationSeconds = calculateExamDuration(originalExam.totalQuestions);
        const startedAt = new Date();
        const expiresAt = new Date(
            startedAt.getTime() + (durationSeconds * 1000) + (EXAM_CONFIG.SUBMISSION_GRACE_PERIOD_SECONDS * 1000)
        );

        // Create retake exam in transaction
        const exam = await prisma.$transaction(async (tx) => {
            const newExam = await tx.exam.create({
                data: {
                    userId,
                    examType: originalExam.examType,
                    subjectsIncluded: originalExam.subjectsIncluded,
                    totalQuestions: originalExam.totalQuestions,
                    score: 0,
                    percentage: 0,
                    spEarned: 0,
                    status: EXAM_STATUS.IN_PROGRESS as any,
                    startedAt,
                    isRetake: true,
                    attemptNumber: eligibility.attemptNumber,
                    originalExamId: originalId
                }
            });

            // Create placeholder answers
            const answerRecords = questions.map(q => ({
                examId: newExam.id,
                questionId: q.id,
                userAnswer: null,
                isCorrect: false,
                timeSpentSeconds: 0
            }));

            await tx.examAnswer.createMany({ data: answerRecords });

            return newExam;
        });

        // Prepare response
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
            subject: q.subject,
            topic: q.topic
        }));

        return {
            examId: exam.id,
            examType: originalExam.examType as any,
            subjects: originalExam.subjectsIncluded,
            totalQuestions: originalExam.totalQuestions,
            timeAllowedSeconds: durationSeconds,
            startedAt: startedAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
            questions: questionsForClient
        };
    }

    // ============================================
    // ABANDON EXAM
    // ============================================

    /**
     * Abandon an in-progress exam
     */
    async abandonExam(
        userId: number,
        examId: number
    ): Promise<{ success: boolean; message: string }> {
        const exam = await prisma.exam.findFirst({
            where: {
                id: examId,
                userId: userId
            }
        });

        if (!exam) {
            throw new AppError('Exam not found', 404);
        }

        if (exam.status !== EXAM_STATUS.IN_PROGRESS) {
            throw new AppError('Can only abandon in-progress exams', 400);
        }

        await prisma.exam.update({
            where: { id: examId },
            data: {
                status: EXAM_STATUS.ABANDONED as any,
                completedAt: new Date()
            }
        });

        return {
            success: true,
            message: 'Exam abandoned successfully'
        };
    }
}

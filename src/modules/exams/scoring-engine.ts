// ============================================
// SCORING ENGINE
// ============================================
// Atomic score and SP calculation
// Handles all multiplier rules and user stat updates

import { SP_MULTIPLIERS, EXAM_TYPES } from './exams.constants';
import { SPCalculation } from './exams.types';
import type { Prisma } from '@prisma/client';

/**
 * Determine SP multiplier based on exam type and attempt
 */
export function getSPMultiplier(
    examType: string,
    isRetake: boolean,
    isCollaboration: boolean
): number {
    // Retakes always get 0.5x regardless of exam type
    if (isRetake) {
        return SP_MULTIPLIERS.RETAKE;
    }

    // Collaboration bonus (1v1 or group)
    if (isCollaboration) {
        return SP_MULTIPLIERS.COLLABORATION;
    }

    // Practice questions get 0.5x
    if (examType === EXAM_TYPES.PRACTICE) {
        return SP_MULTIPLIERS.PRACTICE;
    }

    // Real past questions (first attempt, solo) get 1x
    return SP_MULTIPLIERS.REAL_SOLO;
}

/**
 * Calculate score from answers
 */
export function calculateRawScore(
    answers: Array<{ isCorrect: boolean }>
): number {
    return answers.filter(a => a.isCorrect).length;
}

/**
 * Calculate percentage (0-100)
 */
export function calculatePercentage(
    score: number,
    totalQuestions: number
): number {
    if (totalQuestions === 0) return 0;
    return Math.round((score / totalQuestions) * 100 * 10) / 10; // 1 decimal place
}

/**
 * Calculate SP earned
 */
export function calculateSP(
    score: number,
    multiplier: number
): number {
    return Math.round(score * multiplier);
}

/**
 * Full scoring calculation
 */
export function calculateExamScore(
    answers: Array<{ isCorrect: boolean }>,
    totalQuestions: number,
    examType: string,
    isRetake: boolean,
    isCollaboration: boolean
): SPCalculation {
    const rawScore = calculateRawScore(answers);
    const percentage = calculatePercentage(rawScore, totalQuestions);
    const multiplier = getSPMultiplier(examType, isRetake, isCollaboration);
    const spEarned = calculateSP(rawScore, multiplier);

    return {
        rawScore,
        percentage,
        multiplier,
        spEarned
    };
}

/**
 * Grade answers against correct answers
 */
export function gradeAnswers(
    userAnswers: Array<{ questionId: number; answer: string | null; timeSpentSeconds?: number }>,
    questions: Array<{ id: number; correctAnswer: string }>
): Array<{
    questionId: number;
    userAnswer: string | null;
    isCorrect: boolean;
    timeSpentSeconds: number;
}> {
    const questionMap = new Map(questions.map(q => [q.id, q.correctAnswer]));

    return userAnswers.map(answer => {
        const correctAnswer = questionMap.get(answer.questionId);
        const isCorrect = answer.answer !== null && answer.answer === correctAnswer;

        return {
            questionId: answer.questionId,
            userAnswer: answer.answer,
            isCorrect,
            timeSpentSeconds: answer.timeSpentSeconds || 0
        };
    });
}

/**
 * Update user's SP stats atomically
 * 
 * This is called within a transaction to ensure consistency
 */
export async function updateUserStats(
    tx: Prisma.TransactionClient,
    userId: number,
    spEarned: number,
    examType: string
): Promise<{ totalSp: number; weeklySp: number; currentStreak: number }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get current user data
    const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
            totalSp: true,
            weeklySp: true,
            currentStreak: true,
            longestStreak: true,
            lastActivityDate: true,
            realExamsCompleted: true,
            hasTakenFreeExam: true
        }
    });

    if (!user) {
        throw new Error('User not found');
    }

    // Calculate streak
    let newStreak = user.currentStreak;
    let newLongestStreak = user.longestStreak;

    const lastActivity = user.lastActivityDate ? new Date(user.lastActivityDate) : null;
    if (lastActivity) {
        lastActivity.setHours(0, 0, 0, 0);
        const daysSinceActivity = Math.floor((today.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));

        if (daysSinceActivity === 0) {
            // Same day, streak unchanged
        } else if (daysSinceActivity === 1) {
            // Consecutive day, increment streak
            newStreak++;
            if (newStreak > newLongestStreak) {
                newLongestStreak = newStreak;
            }
        } else {
            // Streak broken, reset to 1
            newStreak = 1;
        }
    } else {
        // First activity ever
        newStreak = 1;
    }

    // Update realExamsCompleted if this is a real past question exam
    const realExamsIncrement = examType === EXAM_TYPES.REAL_PAST_QUESTION ? 1 : 0;

    // Update user stats
    const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
            totalSp: { increment: spEarned },
            weeklySp: { increment: spEarned },
            currentStreak: newStreak,
            longestStreak: newLongestStreak,
            lastActivityDate: today,
            realExamsCompleted: { increment: realExamsIncrement },
            hasTakenFreeExam: examType === EXAM_TYPES.REAL_PAST_QUESTION ? true : user.hasTakenFreeExam
        },
        select: {
            totalSp: true,
            weeklySp: true,
            currentStreak: true
        }
    });

    // Update or create study activity for today
    await tx.studyActivity.upsert({
        where: {
            userId_activityDate: {
                userId,
                activityDate: today
            }
        },
        create: {
            userId,
            activityDate: today,
            examsTaken: 1,
            spEarnedToday: spEarned
        },
        update: {
            examsTaken: { increment: 1 },
            spEarnedToday: { increment: spEarned }
        }
    });

    return updatedUser;
}

/**
 * Update question statistics (times attempted, times correct)
 */
export async function updateQuestionStats(
    tx: Prisma.TransactionClient,
    gradedAnswers: Array<{ questionId: number; isCorrect: boolean }>
): Promise<void> {
    // Batch update for performance
    const updates = gradedAnswers.map(answer =>
        tx.question.update({
            where: { id: answer.questionId },
            data: {
                timesAttempted: { increment: 1 },
                timesCorrect: { increment: answer.isCorrect ? 1 : 0 }
            }
        })
    );

    await Promise.all(updates);
}

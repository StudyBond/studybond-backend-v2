// ============================================
// RETAKE HANDLER
// ============================================
// Manages exam retake eligibility and creation
// Enforces maximum retake limits

import { prisma } from '../../config/database';
import { EXAM_CONFIG, EXAM_STATUS, EXAM_ERROR_CODES } from './exams.constants';
import { RetakeEligibility } from './exams.types';
import { AppError } from '../../shared/errors/AppError';

/**
 * Check if a user can retake a specific exam
 */
export async function checkRetakeEligibility(
    userId: number,
    examId: number
): Promise<RetakeEligibility> {
    // Find the original exam
    const exam = await prisma.exam.findFirst({
        where: {
            id: examId,
            userId: userId
        },
        select: {
            id: true,
            status: true,
            isRetake: true,
            originalExamId: true,
            attemptNumber: true,
            maxRetakes: true
        }
    });

    if (!exam) {
        return {
            canRetake: false,
            attemptNumber: 0,
            retakesRemaining: 0,
            reason: 'Exam not found',
            errorCode: EXAM_ERROR_CODES.EXAM_NOT_FOUND
        };
    }

    // Must be completed to retake
    if (exam.status !== EXAM_STATUS.COMPLETED) {
        return {
            canRetake: false,
            attemptNumber: exam.attemptNumber,
            retakesRemaining: 0,
            reason: 'Can only retake completed exams',
            errorCode: EXAM_ERROR_CODES.ORIGINAL_EXAM_NOT_COMPLETED
        };
    }

    // Find the root original exam (for tracking all attempts)
    const originalExamId = exam.isRetake && exam.originalExamId
        ? exam.originalExamId
        : exam.id;

    // Count existing retakes of this exam
    const retakeCount = await prisma.exam.count({
        where: {
            originalExamId: originalExamId,
            userId: userId
        }
    });

    const maxRetakes = exam.maxRetakes ?? EXAM_CONFIG.MAX_RETAKES;
    const retakesRemaining = maxRetakes - retakeCount;
    const nextAttemptNumber = retakeCount + 2; // +1 for original, +1 for next

    if (retakesRemaining <= 0) {
        return {
            canRetake: false,
            attemptNumber: nextAttemptNumber - 1,
            retakesRemaining: 0,
            reason: `Maximum ${maxRetakes} retakes reached for this exam`,
            errorCode: EXAM_ERROR_CODES.MAX_RETAKES_REACHED
        };
    }

    return {
        canRetake: true,
        attemptNumber: nextAttemptNumber,
        retakesRemaining: retakesRemaining
    };
}

/**
 * Get the original exam ID from any retake chain
 */
export async function getOriginalExamId(examId: number): Promise<number> {
    const exam = await prisma.exam.findUnique({
        where: { id: examId },
        select: {
            id: true,
            isRetake: true,
            originalExamId: true
        }
    });

    if (!exam) {
        throw new AppError('Exam not found', 404);
    }

    // If this is a retake, return the original exam ID
    // If this is the original, return its own ID
    return exam.isRetake && exam.originalExamId
        ? exam.originalExamId
        : exam.id;
}

/**
 * Get retake history for an original exam
 */
export async function getRetakeHistory(
    originalExamId: number,
    userId: number
): Promise<Array<{
    id: number;
    attemptNumber: number;
    score: number;
    percentage: number | null;
    spEarned: number;
    completedAt: Date | null;
}>> {
    // Get original exam
    const originalExam = await prisma.exam.findFirst({
        where: {
            id: originalExamId,
            userId: userId
        },
        select: {
            id: true,
            score: true,
            percentage: true,
            spEarned: true,
            completedAt: true
        }
    });

    if (!originalExam) {
        return [];
    }

    // Get all retakes
    const retakes = await prisma.exam.findMany({
        where: {
            originalExamId: originalExamId,
            userId: userId
        },
        select: {
            id: true,
            attemptNumber: true,
            score: true,
            percentage: true,
            spEarned: true,
            completedAt: true
        },
        orderBy: {
            attemptNumber: 'asc'
        }
    });

    // Combine original + retakes
    return [
        {
            id: originalExam.id,
            attemptNumber: 1,
            score: originalExam.score,
            percentage: originalExam.percentage,
            spEarned: originalExam.spEarned,
            completedAt: originalExam.completedAt
        },
        ...retakes
    ];
}

/**
 * Get improvement stats for retake history
 */
export function calculateRetakeStats(
    history: Array<{ attemptNumber: number; score: number; spEarned: number }>
): {
    firstScore: number;
    bestScore: number;
    latestScore: number;
    totalSpEarned: number;
    improvement: number;
} {
    if (history.length === 0) {
        return {
            firstScore: 0,
            bestScore: 0,
            latestScore: 0,
            totalSpEarned: 0,
            improvement: 0
        };
    }

    const firstScore = history[0].score;
    const bestScore = Math.max(...history.map(h => h.score));
    const latestScore = history[history.length - 1].score;
    const totalSpEarned = history.reduce((sum, h) => sum + h.spEarned, 0);
    const improvement = latestScore - firstScore;

    return {
        firstScore,
        bestScore,
        latestScore,
        totalSpEarned,
        improvement
    };
}

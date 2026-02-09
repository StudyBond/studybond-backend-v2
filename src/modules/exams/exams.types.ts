// ============================================
// EXAMS MODULE TYPES
// ============================================
// TypeScript interfaces for type safety across the module

import { Subject, ExamType, ExamStatus } from './exams.constants';

// ============================================
// REQUEST TYPES
// ============================================

/**
 * Configuration for starting a new exam
 */
export interface StartExamInput {
    /** Type of exam (REAL_PAST_QUESTION, PRACTICE, etc.) */
    examType: ExamType;

    /** Selected subjects (1-5 subjects) */
    subjects: Subject[];
}

/**
 * Single answer in a submission
 */
export interface AnswerInput {
    /** Question ID being answered */
    questionId: number;

    /** User's selected answer (A, B, C, or D) */
    answer: string | null;

    /** Time spent on this question in seconds */
    timeSpentSeconds?: number;
}

/**
 * Full exam submission payload
 */
export interface SubmitExamInput {
    /** Array of answers for all questions */
    answers: AnswerInput[];
}

/**
 * Query parameters for exam history
 */
export interface ExamHistoryQuery {
    page?: number;
    limit?: number;
    examType?: ExamType;
    status?: ExamStatus;
}

// ============================================
// RESPONSE TYPES
// ============================================

/**
 * Question as sent to client (without correct answer)
 */
export interface QuestionForClient {
    id: number;
    questionText: string;
    hasImage: boolean;
    imageUrl: string | null;
    optionA: string;
    optionB: string;
    optionC: string;
    optionD: string;
    optionE: string | null;
    optionAImageUrl: string | null;
    optionBImageUrl: string | null;
    optionCImageUrl: string | null;
    optionDImageUrl: string | null;
    optionEImageUrl: string | null;
    parentQuestionText: string | null;
    parentQuestionImageUrl: string | null;
    subject: string;
    topic: string | null;
}

/**
 * Active exam session response
 */
export interface ExamSessionResponse {
    examId: number;
    examType: ExamType;
    subjects: string[];
    totalQuestions: number;
    timeAllowedSeconds: number;
    startedAt: string;
    expiresAt: string;
    questions: QuestionForClient[];
}

/**
 * Question with answer details (for completed exam review)
 */
export interface QuestionWithAnswer extends QuestionForClient {
    correctAnswer: string;
    userAnswer: string | null;
    isCorrect: boolean;
    timeSpentSeconds: number | null;
    explanation?: {
        text: string;
        imageUrl: string | null;
        additionalNotes: string | null;
    };
}

/**
 * Exam result after submission
 */
export interface ExamResultResponse {
    examId: number;
    examType: ExamType;
    subjects: string[];
    totalQuestions: number;
    score: number;
    percentage: number;
    spEarned: number;
    spMultiplier: number;
    timeTakenSeconds: number;
    isRetake: boolean;
    attemptNumber: number;
    startedAt: string;
    completedAt: string;
    questions: QuestionWithAnswer[];
    stats: {
        totalSp: number;
        weeklySp: number;
        currentStreak: number;
    };
}

/**
 * Exam summary for history list
 */
export interface ExamSummary {
    id: number;
    examType: ExamType;
    subjects: string[];
    totalQuestions: number;
    score: number;
    percentage: number;
    spEarned: number;
    status: ExamStatus;
    isRetake: boolean;
    attemptNumber: number;
    retakesRemaining: number;
    startedAt: string;
    completedAt: string | null;
    timeTakenSeconds: number | null;
}

/**
 * Paginated exam history response
 */
export interface ExamHistoryResponse {
    exams: ExamSummary[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
    stats: {
        totalExams: number;
        averageScore: number;
        totalSpEarned: number;
        bestScore: number;
    };
}

// ============================================
// INTERNAL TYPES (Service Layer)
// ============================================

/**
 * Question as stored in database with additional metadata
 */
export interface QuestionWithMeta {
    id: number;
    questionText: string;
    hasImage: boolean;
    imageUrl: string | null;
    optionA: string;
    optionB: string;
    optionC: string;
    optionD: string;
    optionE: string | null;
    optionAImageUrl: string | null;
    optionBImageUrl: string | null;
    optionCImageUrl: string | null;
    optionDImageUrl: string | null;
    optionEImageUrl: string | null;
    correctAnswer: string;
    subject: string;
    topic: string | null;
    questionType: string;
    parentQuestionText?: string | null;
    parentQuestionImageUrl?: string | null;
}

/**
 * SP calculation result
 */
export interface SPCalculation {
    rawScore: number;
    percentage: number;
    multiplier: number;
    spEarned: number;
}

/**
 * User eligibility check result
 */
export interface EligibilityCheck {
    canTakeExam: boolean;
    reason?: string;
    errorCode?: string;
}

/**
 * Retake eligibility result
 */
export interface RetakeEligibility {
    canRetake: boolean;
    attemptNumber: number;
    retakesRemaining: number;
    reason?: string;
    errorCode?: string;
}

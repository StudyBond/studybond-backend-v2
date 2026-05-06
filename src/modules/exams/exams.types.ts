import type { ExamErrorCode } from './exams.constants';
import { Subject, ExamType, ExamStatus } from './exams.constants';
export interface StartExamInput {
    examType?: ExamType;
    institutionCode?: string;
    subjects: Subject[];
}

export interface StartDailyChallengeInput {
    subjects: Subject[];
}

export interface AnswerInput {
    questionId: number;
    answer: string | null;
    timeSpentSeconds?: number;
    isFlagged?: boolean;
}

export interface SubmitExamInput {
    answers: AnswerInput[];
}

export interface ExamHistoryQuery {
    page?: number;
    limit?: number;
    institutionCode?: string;
    examType?: ExamType;
    status?: ExamStatus;
}
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

export interface ExamSessionResponse {
    examId: number;
    examType: ExamType;
    subjects: string[];
    sessionNumber: number;
    displayNameLong: string;
    displayNameShort: string;
    totalQuestions: number;
    timeAllowedSeconds: number;
    startedAt: string;
    expiresAt: string;
    questions: QuestionForClient[];
}

/* Question with answer details (for completed exam review) */
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

/* Exam result after submission */
export interface ExamResultResponse {
    examId: number;
    examType: ExamType;
    subjects: string[];
    sessionNumber: number;
    displayNameLong: string;
    displayNameShort: string;
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

/* Exam summary for history list */
export interface ExamSummary {
    id: number;
    examType: ExamType;
    subjects: string[];
    sessionNumber: number;
    displayNameLong: string;
    displayNameShort: string;
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

/* Paginated exam history response */
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


// INTERNAL TYPES (Service Layer)

/* Question as stored in database with additional metadata */
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
    difficultyLevel: string | null;
    parentQuestionId: number | null;
    questionType: string;
    parentQuestionText?: string | null;
    parentQuestionImageUrl?: string | null;
}

export interface SPCalculation {
    rawScore: number;
    percentage: number;
    multiplier: number;
    spEarned: number;
}

/* ---- Topic Blueprint Types ---- */

/**
 * Single entry in a topic blueprint defining how many questions
 * from a specific topic should appear in an exam for a given subject.
 *
 * The special key `__other__` captures questions whose topic does not
 * match any named entry in the blueprint (including null topics).
 */
export interface TopicBlueprintEntry {
    /** Target number of questions from this topic */
    quota: number;
    /** When true, pick passage groups (parentQuestionId) as atomic units */
    requirePassageGroup?: boolean;
}

/**
 * Per-subject mapping of topic names to their blueprint entries.
 * Example:
 * ```json
 * {
 *   "English": {
 *     "Comprehension": { "quota": 5, "requirePassageGroup": true },
 *     "Concord": { "quota": 3 },
 *     "__other__": { "quota": 5 }
 *   }
 * }
 * ```
 */
export type TopicBlueprint = Record<string, Record<string, TopicBlueprintEntry>>;

export interface EligibilityCheck {
    canTakeExam: boolean;
    reason?: string;
    errorCode?: ExamErrorCode;
    creditsUsed?: number;
    creditsRemaining?: number;
    requestedCredits?: number;
    freeSubjectsTaken?: string[];
}

export interface RetakeEligibility {
    canRetake: boolean;
    attemptNumber: number;
    retakesRemaining: number;
    reason?: string;
    errorCode?: string;
}

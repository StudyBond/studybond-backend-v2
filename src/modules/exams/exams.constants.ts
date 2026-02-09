// This contains the EXAMS MODULE CONSTANTS
// Business rules and configuration constants
// Single source of truth for exam-related values

/**
 * Currently, these are the available subjects for UI Post-UTME (StudyBond)
 */
export const SUBJECTS = [
    'Mathematics',
    'English',
    'Physics',
    'Chemistry',
    'Biology'
] as const;

export type Subject = typeof SUBJECTS[number];

/**
 * Exam type identifiers matching Prisma enum (refer to Prisma schema for details)
 */
export const EXAM_TYPES = {
    REAL_PAST_QUESTION: 'REAL_PAST_QUESTION',
    PRACTICE: 'PRACTICE',
    ONE_V_ONE_DUEL: 'ONE_V_ONE_DUEL',
    GROUP_COLLAB: 'GROUP_COLLAB'
} as const;

export type ExamType = keyof typeof EXAM_TYPES;

/**
 * Exam status identifiers matching Prisma enum (refer to Prisma schema for details)
 */
export const EXAM_STATUS = {
    IN_PROGRESS: 'IN_PROGRESS',
    COMPLETED: 'COMPLETED',
    ABANDONED: 'ABANDONED'
} as const;

export type ExamStatus = keyof typeof EXAM_STATUS;

/**
 * Core exam configuration (refer to Prisma schema for details)
 */
export const EXAM_CONFIG = {
    /** Questions per subject in a full exam */
    QUESTIONS_PER_SUBJECT: 25,

    /** Total questions in a full 4-subject exam */
    FULL_EXAM_QUESTIONS: 100,

    /** Maximum retakes allowed per exam */
    MAX_RETAKES: 3,

    /** Full exam duration in seconds (2 hours) */
    FULL_EXAM_DURATION_SECONDS: 7200,

    /** Time buffer for network latency in seconds */
    SUBMISSION_GRACE_PERIOD_SECONDS: 90
} as const;

/**
 * SP (Score Points) multipliers for different exam types
 */
export const SP_MULTIPLIERS = {
    /** Real past questions, first attempt */
    REAL_SOLO: 1.0,

    /** Practice/AI-generated questions */
    PRACTICE: 0.5,

    /** Any retake attempt */
    RETAKE: 0.5,

    /** 1v1 Duel or Group Collaboration */
    COLLABORATION: 1.5
} as const;

/**
 * Free tier limitations
 */
export const FREE_TIER_LIMITS = {
    /** Number of free real exams allowed */
    FREE_REAL_EXAMS: 1,

    /** Real exams needed to unlock collaboration */
    COLLAB_GATE_EXAMS: 2,

    /** AI explanations per day for free users */
    AI_EXPLANATIONS_PER_DAY: 0
} as const;

/**
 * Premium tier settings
 */
export const PREMIUM_LIMITS = {
    /** AI explanations per day for premium users */
    AI_EXPLANATIONS_PER_DAY: 5,

    /** Maximum real exams per day (GMT+1) for premium users */
    DAILY_REAL_EXAMS: 5
} as const;

/**
 * Pagination defaults
 */
export const PAGINATION = {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 10,
    MAX_LIMIT: 50
} as const;

/**
 * Error codes for exam operations
 * Used for consistent error handling across the module
 */
export const EXAM_ERROR_CODES = {
    // Eligibility errors
    FREE_LIMIT_REACHED: 'EXAM_FREE_LIMIT_REACHED',
    PREMIUM_REQUIRED: 'EXAM_PREMIUM_REQUIRED',
    DAILY_LIMIT_REACHED: 'EXAM_DAILY_LIMIT_REACHED',
    COLLAB_GATE_NOT_MET: 'EXAM_COLLAB_GATE_NOT_MET',

    // Exam state errors
    EXAM_NOT_FOUND: 'EXAM_NOT_FOUND',
    EXAM_NOT_IN_PROGRESS: 'EXAM_NOT_IN_PROGRESS',
    EXAM_ALREADY_COMPLETED: 'EXAM_ALREADY_COMPLETED',
    EXAM_EXPIRED: 'EXAM_EXPIRED',

    // Retake errors
    MAX_RETAKES_REACHED: 'EXAM_MAX_RETAKES_REACHED',
    ORIGINAL_EXAM_NOT_COMPLETED: 'EXAM_ORIGINAL_NOT_COMPLETED',

    // Question errors
    INSUFFICIENT_QUESTIONS: 'EXAM_INSUFFICIENT_QUESTIONS',
    INVALID_SUBJECT: 'EXAM_INVALID_SUBJECT',

    // Answer errors
    INVALID_ANSWER_FORMAT: 'EXAM_INVALID_ANSWER_FORMAT',
    DUPLICATE_ANSWERS: 'EXAM_DUPLICATE_ANSWERS',
    QUESTION_NOT_IN_EXAM: 'EXAM_QUESTION_NOT_IN_EXAM'
} as const;

export type ExamErrorCode = typeof EXAM_ERROR_CODES[keyof typeof EXAM_ERROR_CODES];


// Single source of truth for exam-related values

/* Currently, these are the available subjects for UI Post-UTME at StudyBond */
export const SUBJECTS = [
    'Mathematics',
    'English',
    'Physics',
    'Chemistry',
    'Biology'
] as const;

export type Subject = typeof SUBJECTS[number];

//Exam type identifiers matching Prisma enum (refer to Prisma schema for details)

export const EXAM_TYPES = {
    REAL_PAST_QUESTION: 'REAL_PAST_QUESTION',
    PRACTICE: 'PRACTICE',
    MIXED: 'MIXED',
    ONE_V_ONE_DUEL: 'ONE_V_ONE_DUEL',
    GROUP_COLLAB: 'GROUP_COLLAB',
    DAILY_CHALLENGE: 'DAILY_CHALLENGE'
} as const;

export type ExamType = keyof typeof EXAM_TYPES;

/* Exam status identifiers matching Prisma enum (refer to Prisma schema for details) */
export const EXAM_STATUS = {
    IN_PROGRESS: 'IN_PROGRESS',
    COMPLETED: 'COMPLETED',
    ABANDONED: 'ABANDONED'
} as const;

export type ExamStatus = keyof typeof EXAM_STATUS;

/* Core exam configuration (refer to Prisma schema for details) */
export const EXAM_CONFIG = {
    QUESTIONS_PER_SUBJECT: 25,
    FULL_EXAM_QUESTIONS: 100,
    MAX_RETAKES: 3,
    SINGLE_SUBJECT_DURATION_SECONDS: 22 * 60,
    TWO_SUBJECT_DURATION_SECONDS: 44 * 60,
    THREE_SUBJECT_DURATION_SECONDS: 66 * 60,
    FULL_EXAM_DURATION_SECONDS: 90 * 60,
    COLLAB_EXAM_DURATION_SECONDS: 90 * 60,
    DAILY_CHALLENGE_DURATION_SECONDS: 3 * 60,
    SUBMISSION_GRACE_PERIOD_SECONDS: 90 /* Time buffer for network latency in seconds */
} as const;


export const SP_MULTIPLIERS = {
    REAL_SOLO: 1.0, /* first attempt */
    PRACTICE: 0.5,
    RETAKE: 0.5,
    COLLABORATION: 1.5,
    DAILY_CHALLENGE_FIXED_SP: 40
} as const;


export const FREE_TIER_LIMITS = {
    FREE_TOTAL_SUBJECT_CREDITS: 4, // Lifetime credits, reset only by SUPERADMIN
    FREE_FULL_REAL_TOTAL_ATTEMPTS: 3,
    COLLAB_GATE_EXAMS: 2,  // Real exams needed to unlock collaboration
    AI_EXPLANATIONS_PER_DAY: 0
} as const;

/* PREMIUM TIER SETTINGS */
export const PREMIUM_LIMITS = {
    AI_EXPLANATIONS_PER_DAY: 5,
    DAILY_REAL_SUBJECT_CREDITS: 20 // 20 subjects = 5 full 4-subject exam mocks
} as const;

/* Pagination defaults */
export const PAGINATION = {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 10,
    MAX_LIMIT: 50
} as const;

/* Below are the error codes for exam operations */
export const EXAM_ERROR_CODES = {
    // Eligibility errors
    FREE_LIMIT_REACHED: 'EXAM_FREE_LIMIT_REACHED',
    FREE_SUBJECT_ALREADY_TAKEN: 'EXAM_FREE_SUBJECT_ALREADY_TAKEN',
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

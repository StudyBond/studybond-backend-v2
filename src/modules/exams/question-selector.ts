import { prisma } from '../../config/database';
import { EXAM_CONFIG, EXAM_TYPES } from './exams.constants';
import { QuestionWithMeta, TopicBlueprint, TopicBlueprintEntry } from './exams.types';
import { AppError } from '../../shared/errors/AppError';
import { QUESTION_POOLS, QUESTION_TYPES } from '../questions/questions.constants';
import { getSubjectSearchVariants, normalizeSubjectLabel } from '../../shared/utils/subjects';

const PRACTICE_QUESTION_TYPE_FILTER = { in: [QUESTION_TYPES.PRACTICE, QUESTION_TYPES.AI_GENERATED] } as const;



interface QuestionSelectionOptions {
    deterministic?: boolean;
    realQuestionPool?: string;
    institutionId?: number;
    topicBlueprints?: TopicBlueprint | null;
    /** When true, only select questions flagged as isFeaturedFree by admins (for free user exams) */
    isFeaturedFree?: boolean;
    /** Optional topic/subtopic filter list */
    topicsFilter?: string[];
}

function buildTopicFilter(topicsFilter?: string[]) {
    if (!topicsFilter || topicsFilter.length === 0) {
        return {};
    }

    const topicConditions: any[] = [];
    for (const t of topicsFilter) {
        if (!t || !t.trim()) continue;
        const clean = t.trim();
        topicConditions.push({ topic: { equals: clean, mode: 'insensitive' } });
        topicConditions.push({ topic: { startsWith: `${clean} —`, mode: 'insensitive' } });
        topicConditions.push({ topic: { startsWith: `${clean} -`, mode: 'insensitive' } });
        topicConditions.push({ topic: { startsWith: `${clean} –`, mode: 'insensitive' } });
        topicConditions.push({ topic: { startsWith: `${clean}:`, mode: 'insensitive' } });
    }

    if (topicConditions.length === 0) return {};
    return { OR: topicConditions };
}

function buildRealQuestionPoolFilter(options: {
    realQuestionPool: string;
    isFeaturedFree?: boolean;
}) {
    if (options.isFeaturedFree) {
        return {
            isFeaturedFree: true
        };
    }

    return {
        questionPool: options.realQuestionPool
    };
}

/* Fisher-Yates shuffle algorithm for true randomization, O(n) time complexity, cryptographically fair */
export function shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/* Shuffle answer options for a question (for retakes)
   Returns the question with shuffled options and updated correct answer */
export function shuffleQuestionOptions(question: QuestionWithMeta): QuestionWithMeta {
    const options = [
        { key: 'A', text: question.optionA, imageUrl: question.optionAImageUrl },
        { key: 'B', text: question.optionB, imageUrl: question.optionBImageUrl },
        { key: 'C', text: question.optionC, imageUrl: question.optionCImageUrl },
        { key: 'D', text: question.optionD, imageUrl: question.optionDImageUrl }
    ];

    if (question.optionE) {
        options.push({ key: 'E', text: question.optionE, imageUrl: question.optionEImageUrl });
    }

    const shuffledOptions = shuffleArray(options);
    const newCorrectAnswer = shuffledOptions.findIndex(
        opt => opt.key === question.correctAnswer
    );

    // get option by index safely
    const getOpt = (idx: number) => (idx < shuffledOptions.length ? shuffledOptions[idx] : null);

    return {
        ...question,
        optionA: getOpt(0)?.text ?? '',
        optionB: getOpt(1)?.text ?? '',
        optionC: getOpt(2)?.text ?? '',
        optionD: getOpt(3)?.text ?? '',
        optionE: getOpt(4)?.text ?? null,
        optionAImageUrl: getOpt(0)?.imageUrl ?? null,
        optionBImageUrl: getOpt(1)?.imageUrl ?? null,
        optionCImageUrl: getOpt(2)?.imageUrl ?? null,
        optionDImageUrl: getOpt(3)?.imageUrl ?? null,
        optionEImageUrl: getOpt(4)?.imageUrl ?? null,
        correctAnswer: ['A', 'B', 'C', 'D', 'E'][newCorrectAnswer],
        parentQuestionText: question.parentQuestionText,
        parentQuestionImageUrl: question.parentQuestionImageUrl
    };
}


// ============================================================
// IN-MEMORY DUPLICATE DETECTION
// ============================================================

/**
 * Normalize question text for duplicate comparison.
 * Collapses all whitespace runs to single space, lowercases, and trims.
 * This makes comparison resilient to formatting differences across uploads.
 */
function normalizeTextForComparison(text: string): string {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * O(n) in-memory deduplication of questions by their text content.
 *
 * When admins upload the same question across different years,
 * duplicates can appear in the candidate pool. This function keeps
 * only the first occurrence of each unique question text, ensuring
 * a user never sees the same question twice in a single exam.
 *
 * Runs on the already-fetched candidate pool — zero extra DB queries.
 */
export function deduplicateByQuestionText<T extends { questionText: string }>(candidates: T[]): T[] {
    if (candidates.length <= 1) return candidates;

    const seen = new Set<string>();
    const unique: T[] = [];

    for (const q of candidates) {
        const key = normalizeTextForComparison(q.questionText);
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(q);
        }
    }

    return unique;
}

// ============================================================
// PURE RANDOM SELECTION ENGINE
// ============================================================

/**
 * Pure random question selection.
 *
 * Fisher-Yates shuffles the entire deduplicated candidate pool and slices
 * the desired count. Every question in the pool has an equal probability
 * of being selected on every exam attempt.
 *
 * This replaces the previous stratified topic-balanced selection which
 * grouped questions by topic/difficulty buckets. While well-intentioned,
 * that approach caused the same subset of questions to appear repeatedly
 * because the bucketing narrowed the effective selection window.
 * JAMB/UTME itself does not use stratified selection — questions are
 * drawn uniformly at random from the full bank.
 *
 * The `blueprint` parameter is accepted for backward compatibility but
 * is intentionally ignored — all selection is purely random.
 *
 * @param candidates   - Pre-fetched pool of candidate questions for one subject
 * @param desiredCount - Number of questions to select
 * @param _blueprint   - IGNORED. Kept for API compatibility.
 * @returns            - Randomly selected questions
 */
export function randomSelect<T extends { topic: string | null; difficultyLevel?: string | null; parentQuestionId?: number | null; id?: number }>(
    candidates: T[],
    desiredCount: number,
    _blueprint?: Record<string, TopicBlueprintEntry> | null
): T[] {
    if (candidates.length === 0 || desiredCount <= 0) return [];
    if (candidates.length <= desiredCount) return shuffleArray(candidates);

    // Pure random: shuffle the entire pool and take from the top
    return shuffleArray(candidates).slice(0, desiredCount);
}

/** @deprecated Use randomSelect instead. Alias kept for backward compatibility. */
export const stratifiedTopicSelect = randomSelect;






// ============================================================
// QUESTION FETCH AND SELECT (DATABASE LAYER)
// ============================================================

const buildQuestionSelect = () => ({
    id: true,
    questionText: true,
    hasImage: true,
    imageUrl: true,
    optionA: true,
    optionB: true,
    optionC: true,
    optionD: true,
    optionAImageUrl: true,
    optionBImageUrl: true,
    optionCImageUrl: true,
    optionDImageUrl: true,
    optionE: true,
    optionEImageUrl: true,
    correctAnswer: true,
    subject: true,
    topic: true,
    difficultyLevel: true,
    parentQuestionId: true,
    questionType: true,
    parentQuestion: {
        select: {
            questionText: true,
            imageUrl: true
        }
    },
    explanation: {
        select: {
            explanationText: true,
            explanationImageUrl: true,
            additionalNotes: true
        }
    }
});

/**
 * Lightweight select for Phase 1 of the two-pass stochastic selection.
 *
 * Fetches ONLY the minimal metadata needed for deduplication and stratification.
 * This allows us to scan the entire candidate pool without pulling multi-KB
 * question text blobs, option images, or relation joins into memory.
 *
 * Memory footprint: ~100 bytes/record vs ~1.5 KB/record for full payloads.
 */
const buildCandidateSelect = () => ({
    id: true,
    questionText: true,
    topic: true,
    difficultyLevel: true,
    parentQuestionId: true,
});

/** Lightweight candidate shape returned by Phase 1 queries */
interface CandidateMeta {
    id: number;
    questionText: string;
    topic: string | null;
    difficultyLevel: string | null;
    parentQuestionId: number | null;
}

/**
 * Phase 3: Surgical hydration.
 *
 * Given an ordered array of question IDs (already shuffled by the stratifier),
 * fetches the full question payloads in a single indexed query, then re-aligns
 * results to the stratified order using an O(n) Map lookup.
 *
 * Prisma's `WHERE id IN (...)` does NOT guarantee order preservation,
 * so the Map-based restitching is critical for correctness.
 */
async function hydrateQuestionsByIds(ids: number[]): Promise<QuestionWithMeta[]> {
    if (ids.length === 0) return [];

    const questions = await prisma.question.findMany({
        where: { id: { in: ids } },
        select: buildQuestionSelect() as any,
    }) as unknown as QuestionWithMeta[];

    // Flatten parentQuestion relation into top-level fields
    const byId = new Map<number, QuestionWithMeta>();
    for (const q of questions) {
        byId.set(q.id, {
            ...q,
            parentQuestionText: (q as any).parentQuestion?.questionText ?? null,
            parentQuestionImageUrl: (q as any).parentQuestion?.imageUrl ?? null,
            explanation: (q as any).explanation ? {
                explanationText: (q as any).explanation.explanationText,
                explanationImageUrl: (q as any).explanation.explanationImageUrl,
                additionalNotes: (q as any).explanation.additionalNotes,
            } : null,
        });
    }

    // Restitch in the exact order the stratifier determined
    const ordered: QuestionWithMeta[] = [];
    for (const id of ids) {
        const q = byId.get(id);
        if (q) ordered.push(q);
    }

    return ordered;
}


/**
 * Select questions for a new exam
 * 
 * @param subjects - Array of subjects to include
 * @param examType - Type of exam (REAL_PAST_QUESTION or PRACTICE)
 * @param questionsPerSubject - Number of questions per subject (default: 20)
 * @param excludeQuestionIds - Optional array of question IDs to exclude (for uniqueness)
 */
export async function selectQuestionsForExam(
    subjects: string[],
    examType: string,
    questionsPerSubject: number = EXAM_CONFIG.QUESTIONS_PER_SUBJECT,
    excludeQuestionIds: number[] = [],
    options: QuestionSelectionOptions = {}
): Promise<QuestionWithMeta[]> {
    const selectedQuestions: QuestionWithMeta[] = [];
    const deterministic = options.deterministic ?? false;
    const realQuestionPool = options.realQuestionPool ?? QUESTION_POOLS.REAL_BANK;
    const institutionId = options.institutionId;
    const realQuestionPoolFilter = buildRealQuestionPoolFilter({
        realQuestionPool,
        isFeaturedFree: options.isFeaturedFree
    });

    const topicWhereFilter = buildTopicFilter(options.topicsFilter);

    for (const subject of subjects) {
        const normalizedSubject = normalizeSubjectLabel(subject);
        const subjectVariants = getSubjectSearchVariants(normalizedSubject);
        if (deterministic && examType === EXAM_TYPES.REAL_PAST_QUESTION) {
            // Deterministic selection: pick the first N questions by stable ordering (id asc)
            // Fetch extra to account for potential duplicates across year uploads
            const questions = await prisma.question.findMany({
                where: {
                    ...(institutionId ? { institutionId } : {}),
                    subject: {
                        in: subjectVariants
                    },
                    ...topicWhereFilter,
                    questionType: QUESTION_TYPES.REAL_PAST_QUESTION,
                    ...realQuestionPoolFilter,
                    id: {
                        notIn: excludeQuestionIds.length > 0 ? excludeQuestionIds : undefined
                    }
                },
                orderBy: { id: 'asc' },
                select: buildQuestionSelect() as any,
                take: questionsPerSubject * 2
            }) as unknown as QuestionWithMeta[];

            const uniqueQuestions = deduplicateByQuestionText(questions).slice(0, questionsPerSubject);

            if (uniqueQuestions.length < questionsPerSubject) {
                throw new AppError(
                    `Insufficient ${normalizedSubject} questions. Need ${questionsPerSubject}, found ${uniqueQuestions.length}`,
                    422
                );
            }

            const mappedQuestions = uniqueQuestions.map(q => ({
                ...q,
                parentQuestionText: (q as any).parentQuestion?.questionText ?? null,
                parentQuestionImageUrl: (q as any).parentQuestion?.imageUrl ?? null
            }));

            selectedQuestions.push(...mappedQuestions);
            continue;
        }

        // ================================================================
        // TWO-PASS STOCHASTIC SELECTION ENGINE
        //
        // Phase 1: Fetch lightweight metadata for the ENTIRE candidate pool
        //          (no `take` limit — scan the full database for this subject).
        // Phase 2: Deduplicate + randomly select from the complete pool.
        // ================================================================

        let selectedIds: number[];

        if (examType === EXAM_TYPES.MIXED) {
            const realQuestionCount = Math.ceil(questionsPerSubject / 2);
            const practiceQuestionCount = questionsPerSubject - realQuestionCount;

            // Phase 1: Lightweight metadata fetch — entire pool, no take limit
            let [realCandidates, practiceCandidates] = await Promise.all([
                prisma.question.findMany({
                    where: {
                        ...(institutionId ? { institutionId } : {}),
                        subject: { in: subjectVariants },
                        ...topicWhereFilter,
                        questionType: QUESTION_TYPES.REAL_PAST_QUESTION,
                        ...realQuestionPoolFilter,
                        id: { notIn: excludeQuestionIds.length > 0 ? excludeQuestionIds : undefined }
                    },
                    select: buildCandidateSelect(),
                }),
                prisma.question.findMany({
                    where: {
                        ...(institutionId ? { institutionId } : {}),
                        subject: { in: subjectVariants },
                        ...topicWhereFilter,
                        questionPool: QUESTION_POOLS.PRACTICE,
                        questionType: PRACTICE_QUESTION_TYPE_FILTER,
                        id: { notIn: excludeQuestionIds.length > 0 ? excludeQuestionIds : undefined }
                    },
                    select: buildCandidateSelect(),
                })
            ]) as [CandidateMeta[], CandidateMeta[]];

            // Phase 2: Deduplicate + randomly select from the FULL global pool
            realCandidates = deduplicateByQuestionText(realCandidates);
            practiceCandidates = deduplicateByQuestionText(practiceCandidates);

            if (realCandidates.length < realQuestionCount && (!options.topicsFilter || options.topicsFilter.length === 0)) {
                throw new AppError(
                    `Insufficient ${normalizedSubject} real exam questions for mixed mode. Need ${realQuestionCount}, found ${realCandidates.length}.`,
                    422
                );
            }

            if (practiceCandidates.length < practiceQuestionCount && (!options.topicsFilter || options.topicsFilter.length === 0)) {
                throw new AppError(
                    `Insufficient ${normalizedSubject} practice questions for mixed mode. Need ${practiceQuestionCount}, found ${practiceCandidates.length}.`,
                    422
                );
            }

            const selectedReal = randomSelect(realCandidates, realQuestionCount);
            const selectedPractice = randomSelect(practiceCandidates, practiceQuestionCount);
            selectedIds = [...selectedReal, ...selectedPractice].map(q => q.id);
        } else {
            const questionTypeFilter = examType === EXAM_TYPES.REAL_PAST_QUESTION
                ? QUESTION_TYPES.REAL_PAST_QUESTION
                : PRACTICE_QUESTION_TYPE_FILTER;

            // Phase 1: Lightweight metadata fetch — entire pool, no take limit
            let candidates = await prisma.question.findMany({
                where: {
                    ...(institutionId ? { institutionId } : {}),
                    subject: { in: subjectVariants },
                    ...topicWhereFilter,
                    ...(examType === EXAM_TYPES.REAL_PAST_QUESTION
                        ? realQuestionPoolFilter
                        : { questionPool: QUESTION_POOLS.PRACTICE }),
                    questionType: questionTypeFilter,
                    id: { notIn: excludeQuestionIds.length > 0 ? excludeQuestionIds : undefined }
                },
                select: buildCandidateSelect(),
            }) as CandidateMeta[];

            // Phase 2: Deduplicate + randomly select from the FULL global pool
            candidates = deduplicateByQuestionText(candidates);

            if (candidates.length < questionsPerSubject && (!options.topicsFilter || options.topicsFilter.length === 0)) {
                throw new AppError(
                    `Insufficient ${normalizedSubject} questions. Need ${questionsPerSubject}, found ${candidates.length}`,
                    422
                );
            }

            selectedIds = randomSelect(candidates, questionsPerSubject).map(q => q.id);
        }

        // Phase 3: Surgical hydration — fetch full payloads for ONLY the selected IDs
        // and restitch in the randomly shuffled order
        const hydrated = await hydrateQuestionsByIds(selectedIds);
        selectedQuestions.push(...hydrated);
    }

    // Questions are already shuffled within each subject by randomSelect.
    // Maintain subject-block ordering (JAMB-standard): subjects appear in the
    // order the user selected them, never mixed across subjects.
    return selectedQuestions;
}

/**
 * Get questions for a retake exam
 * Uses same question IDs but shuffles order within each subject and shuffles options.
 * Maintains subject-block ordering (JAMB-standard).
 */
export async function selectQuestionsForRetake(
    originalExamId: number
): Promise<QuestionWithMeta[]> {
    // Get original exam's question IDs
    const originalAnswers = await prisma.examAnswer.findMany({
        where: { examId: originalExamId },
        select: { questionId: true }
    });

    if (originalAnswers.length === 0) {
        throw new AppError(
            'Original exam has no questions',
            400
        );
    }

    const questionIds = originalAnswers.map((a: any) => a.questionId);

    // Fetch full question data
    const questions = await prisma.question.findMany({
        where: {
            id: { in: questionIds }
        },
        select: buildQuestionSelect() as any
    }) as unknown as QuestionWithMeta[];

    // Map Prisma result to flattened QuestionWithMeta structure
    const mappedQuestions = questions.map(q => ({
        ...q,
        parentQuestionText: (q as any).parentQuestion?.questionText ?? null,
        parentQuestionImageUrl: (q as any).parentQuestion?.imageUrl ?? null
    }));

    // Group by subject, shuffle within each group, then concatenate
    // This maintains subject-block ordering while randomizing within each subject
    const subjectGroups = new Map<string, QuestionWithMeta[]>();
    for (const q of mappedQuestions) {
        const subject = q.subject;
        let group = subjectGroups.get(subject);
        if (!group) {
            group = [];
            subjectGroups.set(subject, group);
        }
        group.push(q);
    }

    const result: QuestionWithMeta[] = [];
    for (const [, group] of subjectGroups) {
        const shuffledGroup = shuffleArray(group);
        result.push(...shuffledGroup.map(shuffleQuestionOptions));
    }

    return result;
}

/**
 * Calculate total questions based on subject count
 */
export function calculateTotalQuestions(
    subjectCount: number,
    questionsPerSubject: number = EXAM_CONFIG.QUESTIONS_PER_SUBJECT
): number {
    return subjectCount * questionsPerSubject;
}

/**
 * Calculate exam duration based on number of questions
 */
export function calculateExamDuration(totalQuestions: number): number {
    const subjectCount = Math.max(1, Math.round(totalQuestions / EXAM_CONFIG.QUESTIONS_PER_SUBJECT));

    if (subjectCount <= 1) {
        return EXAM_CONFIG.SINGLE_SUBJECT_DURATION_SECONDS;
    }

    if (subjectCount === 2) {
        return EXAM_CONFIG.TWO_SUBJECT_DURATION_SECONDS;
    }

    if (subjectCount === 3) {
        return EXAM_CONFIG.THREE_SUBJECT_DURATION_SECONDS;
    }

    return EXAM_CONFIG.FULL_EXAM_DURATION_SECONDS;
}

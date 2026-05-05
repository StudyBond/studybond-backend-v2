import { prisma } from '../../config/database';
import { EXAM_CONFIG, EXAM_TYPES } from './exams.constants';
import { QuestionWithMeta, TopicBlueprint, TopicBlueprintEntry } from './exams.types';
import { AppError } from '../../shared/errors/AppError';
import { QUESTION_POOLS, QUESTION_TYPES } from '../questions/questions.constants';
import { getSubjectSearchVariants, normalizeSubjectLabel } from '../../shared/utils/subjects';

const PRACTICE_QUESTION_TYPE_FILTER = { in: [QUESTION_TYPES.PRACTICE, QUESTION_TYPES.AI_GENERATED] } as const;

/** Sentinel key for questions whose topic is null, empty, or not in a blueprint */
const OTHER_BUCKET = '__other__';

interface QuestionSelectionOptions {
    deterministic?: boolean;
    realQuestionPool?: string;
    institutionId?: number;
    topicBlueprints?: TopicBlueprint | null;
    /** When true, only select questions flagged as isFeaturedFree by admins (for free user exams) */
    isFeaturedFree?: boolean;
}

function buildRealQuestionPoolFilter(options: {
    realQuestionPool: string;
    isFeaturedFree?: boolean;
}) {
    if (options.isFeaturedFree) {
        return {
            OR: [
                { isFeaturedFree: true },
                // Backward-compatible fallback for legacy free-pool rows that
                // were curated via questionPool before the featured flag rollout.
                { questionPool: QUESTION_POOLS.FREE_EXAM }
            ]
        };
    }

    return {
        questionPool: options.realQuestionPool
    };
}

/* Fisher-Yates shuffle algorithm for true randomization, O(n) time complexity, cryptographically fair */
function shuffleArray<T>(array: T[]): T[] {
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
// STRATIFIED TOPIC-BALANCED SELECTION ENGINE
// ============================================================

/**
 * Stratified topic-balanced question selection.
 *
 * This is the core algorithm that prevents topic clustering in exams.
 * It works in three modes depending on available configuration:
 *
 * 1. **Blueprint mode** — When a TopicBlueprint is provided for the subject,
 *    questions are distributed according to explicit per-topic quotas.
 *    Unrecognised topics fall into the `__other__` bucket.
 *
 * 2. **Uniform mode** — When no blueprint exists, discovered topics are
 *    distributed as evenly as possible using round-robin allocation.
 *
 * 3. **Passthrough mode** — When all candidates share one topic (or null),
 *    gracefully degrades to a simple shuffle-and-slice (current behavior).
 *
 * Within each topic bucket, questions are sub-stratified by difficulty level
 * (easy/medium/hard) to ensure balanced difficulty across the exam.
 *
 * Passage groups (questions linked by parentQuestionId) can be selected as
 * atomic units when the blueprint entry specifies `requirePassageGroup: true`.
 *
 * @param candidates   - Pre-fetched pool of candidate questions for one subject
 * @param desiredCount - Number of questions to select
 * @param blueprint    - Optional per-topic quota map for this subject
 * @returns            - Topic-balanced selection of questions
 */
export function stratifiedTopicSelect<T extends { topic: string | null; difficultyLevel?: string | null; parentQuestionId?: number | null; id?: number }>(
    candidates: T[],
    desiredCount: number,
    blueprint?: Record<string, TopicBlueprintEntry> | null
): T[] {
    if (candidates.length === 0 || desiredCount <= 0) return [];
    if (candidates.length <= desiredCount) return shuffleArray(candidates);

    // ---- Step 1: Group candidates into topic buckets ----
    const buckets = new Map<string, T[]>();
    const blueprintKeys = blueprint ? new Set(Object.keys(blueprint)) : null;

    for (const q of candidates) {
        let bucketKey: string;

        if (blueprintKeys) {
            // Blueprint mode: named topics go to their slot, everything else to __other__
            const topicName = q.topic?.trim() || '';
            bucketKey = (topicName && blueprintKeys.has(topicName)) ? topicName : OTHER_BUCKET;
        } else {
            // Uniform mode: group by actual topic; null/empty → __other__
            bucketKey = q.topic?.trim() || OTHER_BUCKET;
        }

        let bucket = buckets.get(bucketKey);
        if (!bucket) {
            bucket = [];
            buckets.set(bucketKey, bucket);
        }
        bucket.push(q);
    }

    // ---- Step 2: Handle passage groups for topics that require them ----
    if (blueprint) {
        for (const [topicName, entry] of Object.entries(blueprint)) {
            if (!entry.requirePassageGroup) continue;
            const bucket = buckets.get(topicName);
            if (!bucket) continue;

            // Group by parentQuestionId — each non-null parentQuestionId forms a passage group
            const passageGroups = new Map<number, T[]>();
            const standaloneQuestions: T[] = [];

            for (const q of bucket) {
                const parentId = (q as any).parentQuestionId;
                if (parentId != null) {
                    let group = passageGroups.get(parentId);
                    if (!group) {
                        group = [];
                        passageGroups.set(parentId, group);
                    }
                    group.push(q);
                } else {
                    standaloneQuestions.push(q);
                }
            }

            // If passage groups exist, select complete groups to fill the quota
            if (passageGroups.size > 0) {
                const groupEntries = shuffleArray([...passageGroups.entries()]);
                const selectedFromPassages = selectPassageGroupsToQuota(groupEntries, entry.quota);
                const remaining = entry.quota - selectedFromPassages.length;

                // Fill remainder from standalone questions if needed
                if (remaining > 0 && standaloneQuestions.length > 0) {
                    selectedFromPassages.push(
                        ...shuffleArray(standaloneQuestions).slice(0, remaining)
                    );
                }

                // Replace the bucket with just the selected passage questions
                // so the main quota logic below respects passage group atomicity
                buckets.set(topicName, selectedFromPassages);
            }
        }
    }

    // ---- Step 3: Shuffle each bucket internally with difficulty sub-stratification ----
    for (const [key, bucket] of buckets) {
        buckets.set(key, difficultyStratifiedShuffle(bucket));
    }

    // ---- Step 4: Allocate quotas ----
    const selected: T[] = [];

    if (blueprint) {
        // Blueprint mode: use explicit quotas
        const allocations = new Map<string, number>();
        let quotaTotal = 0;

        for (const [topicName, entry] of Object.entries(blueprint)) {
            const bucket = buckets.get(topicName);
            const available = bucket ? bucket.length : 0;
            const quota = Math.min(entry.quota, available);
            allocations.set(topicName, quota);
            quotaTotal += quota;
        }

        // If blueprint quotas don't fill desiredCount, allocate remainder to __other__
        if (quotaTotal < desiredCount) {
            const otherBucket = buckets.get(OTHER_BUCKET);
            const currentOtherAlloc = allocations.get(OTHER_BUCKET) ?? 0;
            const extraNeeded = desiredCount - quotaTotal;
            const otherAvailable = otherBucket ? otherBucket.length - currentOtherAlloc : 0;
            if (otherAvailable > 0) {
                allocations.set(OTHER_BUCKET, currentOtherAlloc + Math.min(extraNeeded, otherAvailable));
            }
        }

        // Pick from each bucket according to allocation
        for (const [topicName, quota] of allocations) {
            const bucket = buckets.get(topicName);
            if (!bucket || quota <= 0) continue;
            selected.push(...bucket.slice(0, quota));
        }

        // If still short (not enough questions across all buckets), fill from remaining
        if (selected.length < desiredCount) {
            const selectedIds = new Set(selected.map(q => (q as any).id));
            const remainder: T[] = [];
            for (const bucket of buckets.values()) {
                for (const q of bucket) {
                    if (!selectedIds.has((q as any).id)) {
                        remainder.push(q);
                    }
                }
            }
            const needed = desiredCount - selected.length;
            selected.push(...shuffleArray(remainder).slice(0, needed));
        }
    } else {
        // Uniform mode: distribute evenly across discovered topics
        const topicKeys = [...buckets.keys()];

        if (topicKeys.length <= 1) {
            // Single topic or all null — difficulty interleave was already applied in
            // Step 3, so we take from the front to preserve balanced difficulty spread.
            const singleBucket = buckets.get(topicKeys[0]) ?? [];
            return singleBucket.slice(0, desiredCount);
        }

        const baseQuota = Math.floor(desiredCount / topicKeys.length);
        let remainder = desiredCount - (baseQuota * topicKeys.length);

        // First pass: give each topic its base quota
        const overflow: T[] = [];
        for (const key of shuffleArray(topicKeys)) {
            const bucket = buckets.get(key)!;

            // Topics with extra remainder slots get +1
            let quota = baseQuota;
            if (remainder > 0 && bucket.length > baseQuota) {
                quota += 1;
                remainder -= 1;
            }

            const take = Math.min(quota, bucket.length);
            selected.push(...bucket.slice(0, take));

            // Leftovers from this bucket go to overflow pool
            if (bucket.length > take) {
                overflow.push(...bucket.slice(take));
            }
        }

        // Second pass: fill remaining slots from overflow (handles topics with fewer than quota)
        if (selected.length < desiredCount && overflow.length > 0) {
            const needed = desiredCount - selected.length;
            selected.push(...shuffleArray(overflow).slice(0, needed));
        }
    }

    // ---- Step 5: Final shuffle to interleave topics ----
    return shuffleArray(selected).slice(0, desiredCount);
}


/**
 * Sub-stratify a bucket of questions by difficulty level.
 *
 * Groups questions by difficulty (easy/medium/hard/null), shuffles each group,
 * then interleaves them so the bucket has a balanced difficulty spread.
 *
 * This ensures that when the main algorithm picks from the start of a bucket,
 * it naturally gets a mix of difficulties rather than clustering.
 */
function difficultyStratifiedShuffle<T extends { difficultyLevel?: string | null }>(questions: T[]): T[] {
    if (questions.length <= 1) return questions;

    const byDifficulty = new Map<string, T[]>();
    for (const q of questions) {
        const key = q.difficultyLevel?.trim().toLowerCase() || '__unset__';
        let group = byDifficulty.get(key);
        if (!group) {
            group = [];
            byDifficulty.set(key, group);
        }
        group.push(q);
    }

    // If all same difficulty, just shuffle
    if (byDifficulty.size <= 1) {
        return shuffleArray(questions);
    }

    // Shuffle each difficulty group
    const groups = [...byDifficulty.values()].map(g => shuffleArray(g));

    // Round-robin interleave across difficulty groups
    const result: T[] = [];
    let maxLen = 0;
    for (const g of groups) {
        if (g.length > maxLen) maxLen = g.length;
    }

    for (let i = 0; i < maxLen; i++) {
        for (const g of groups) {
            if (i < g.length) {
                result.push(g[i]);
            }
        }
    }

    return result;
}

function selectPassageGroupsToQuota<T>(
    groupEntries: Array<[number, T[]]>,
    quota: number
): T[] {
    if (quota <= 0 || groupEntries.length === 0) {
        return [];
    }

    const bestSelections = new Map<number, number[]>();
    bestSelections.set(0, []);

    for (let index = 0; index < groupEntries.length; index++) {
        const groupSize = groupEntries[index][1].length;
        if (groupSize > quota) {
            continue;
        }

        const totals = [...bestSelections.keys()].sort((left, right) => right - left);
        for (const total of totals) {
            const nextTotal = total + groupSize;
            if (nextTotal > quota || bestSelections.has(nextTotal)) {
                continue;
            }

            const previousSelection = bestSelections.get(total) ?? [];
            bestSelections.set(nextTotal, [...previousSelection, index]);
        }
    }

    let bestTotal = 0;
    for (const total of bestSelections.keys()) {
        if (total > bestTotal) {
            bestTotal = total;
        }
    }

    const selectedIndices = bestSelections.get(bestTotal) ?? [];
    const selectedQuestions: T[] = [];

    for (const index of selectedIndices) {
        selectedQuestions.push(...shuffleArray(groupEntries[index][1]));
    }

    return selectedQuestions;
}


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
    }
});


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
    const topicBlueprints = options.topicBlueprints ?? null;
    const realQuestionPoolFilter = buildRealQuestionPoolFilter({
        realQuestionPool,
        isFeaturedFree: options.isFeaturedFree
    });

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

        // Fetch a generous candidate pool to ensure topic diversity.
        // 5x multiplier gives the stratifier enough headroom to balance across topics.
        const fetchLimit = questionsPerSubject * 5;

        // Resolve the topic blueprint for this subject (if configured)
        const subjectBlueprint = topicBlueprints?.[normalizedSubject] ?? topicBlueprints?.[subject] ?? null;

        let selected: QuestionWithMeta[] = [];
        if (examType === EXAM_TYPES.MIXED) {
            const realQuestionCount = Math.ceil(questionsPerSubject / 2);
            const practiceQuestionCount = questionsPerSubject - realQuestionCount;

            let [realQuestions, practiceQuestions] = await Promise.all([
                prisma.question.findMany({
                    where: {
                        ...(institutionId ? { institutionId } : {}),
                        subject: {
                            in: subjectVariants
                        },
                        questionType: QUESTION_TYPES.REAL_PAST_QUESTION,
                        ...realQuestionPoolFilter,
                        id: {
                            notIn: excludeQuestionIds.length > 0 ? excludeQuestionIds : undefined
                        }
                    },
                    select: buildQuestionSelect() as any,
                    take: fetchLimit
                }),
                prisma.question.findMany({
                    where: {
                        ...(institutionId ? { institutionId } : {}),
                        subject: {
                            in: subjectVariants
                        },
                        questionPool: QUESTION_POOLS.PRACTICE,
                        questionType: PRACTICE_QUESTION_TYPE_FILTER,
                        id: {
                            notIn: excludeQuestionIds.length > 0 ? excludeQuestionIds : undefined
                        }
                    },
                    select: buildQuestionSelect() as any,
                    take: fetchLimit
                })
            ]) as unknown as [QuestionWithMeta[], QuestionWithMeta[]];

            // Deduplicate each pool independently before checking sufficiency
            realQuestions = deduplicateByQuestionText(realQuestions);
            practiceQuestions = deduplicateByQuestionText(practiceQuestions);

            if (realQuestions.length < realQuestionCount) {
                throw new AppError(
                    `Insufficient ${normalizedSubject} real exam questions for mixed mode. Need ${realQuestionCount}, found ${realQuestions.length}.`,
                    422
                );
            }

            if (practiceQuestions.length < practiceQuestionCount) {
                throw new AppError(
                    `Insufficient ${normalizedSubject} practice questions for mixed mode. Need ${practiceQuestionCount}, found ${practiceQuestions.length}.`,
                    422
                );
            }

            // Apply stratified selection to each half independently
            selected = [
                ...stratifiedTopicSelect(realQuestions, realQuestionCount, subjectBlueprint),
                ...stratifiedTopicSelect(practiceQuestions, practiceQuestionCount, subjectBlueprint)
            ];
        } else {
            const questionTypeFilter = examType === EXAM_TYPES.REAL_PAST_QUESTION
                ? QUESTION_TYPES.REAL_PAST_QUESTION
                : PRACTICE_QUESTION_TYPE_FILTER;

            const questions = await prisma.question.findMany({
                where: {
                    ...(institutionId ? { institutionId } : {}),
                    subject: {
                        in: subjectVariants
                    },
                    ...(examType === EXAM_TYPES.REAL_PAST_QUESTION
                        ? realQuestionPoolFilter
                        : { questionPool: QUESTION_POOLS.PRACTICE }),
                    questionType: questionTypeFilter,
                    id: {
                        notIn: excludeQuestionIds.length > 0 ? excludeQuestionIds : undefined
                    }
                },
                select: buildQuestionSelect() as any,
                take: fetchLimit
            }) as unknown as QuestionWithMeta[];

            // Deduplicate candidate pool before checking sufficiency
            const uniqueQuestions = deduplicateByQuestionText(questions);

            if (uniqueQuestions.length < questionsPerSubject) {
                throw new AppError(
                    `Insufficient ${normalizedSubject} questions. Need ${questionsPerSubject}, found ${uniqueQuestions.length}`,
                    422
                );
            }

            // Apply stratified topic-balanced selection
            selected = stratifiedTopicSelect(uniqueQuestions, questionsPerSubject, subjectBlueprint);
        }

        // Map Prisma result to flattened QuestionWithMeta structure
        const mappedQuestions = selected.map(q => ({
            ...q,
            parentQuestionText: (q as any).parentQuestion?.questionText ?? null,
            parentQuestionImageUrl: (q as any).parentQuestion?.imageUrl ?? null
        }));

        selectedQuestions.push(...mappedQuestions);
    }

    // Questions are already shuffled within each subject by stratifiedTopicSelect.
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

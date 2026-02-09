// ============================================
// QUESTION SELECTOR ENGINE
// ============================================
// Smart question selection with randomization
// Ensures fair, unique question distribution

import { prisma } from '../../config/database';
import { EXAM_CONFIG, EXAM_TYPES } from './exams.constants';
import { QuestionWithMeta } from './exams.types';
import { AppError } from '../../shared/errors/AppError';

/**
 * Fisher-Yates shuffle algorithm for true randomization
 * O(n) time complexity, cryptographically fair
 */
function shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Shuffle answer options for a question (for retakes)
 * Returns the question with shuffled options and updated correct answer
 */
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

    // Helper to get option by index safely
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
    excludeQuestionIds: number[] = []
): Promise<QuestionWithMeta[]> {
    const selectedQuestions: QuestionWithMeta[] = [];

    // Determine question type filter based on exam type
    const questionTypeFilter = examType === EXAM_TYPES.REAL_PAST_QUESTION
        ? 'real_past_question'
        : { in: ['practice', 'ai_generated'] };

    for (const subject of subjects) {
        // Fetch more questions than needed to allow for randomization
        const fetchLimit = questionsPerSubject * 3;

        const questions = await prisma.question.findMany({
            where: {
                subject: subject,
                questionType: questionTypeFilter,
                id: {
                    notIn: excludeQuestionIds.length > 0 ? excludeQuestionIds : undefined
                }
            },
            select: {
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
                questionType: true,
                parentQuestion: {
                    select: {
                        questionText: true,
                        imageUrl: true
                    }
                }
            } as any,
            take: fetchLimit
        }) as unknown as QuestionWithMeta[];

        // Check if we have enough questions
        if (questions.length < questionsPerSubject) {
            throw new AppError(
                `Insufficient ${subject} questions. Need ${questionsPerSubject}, found ${questions.length}`,
                422
            );
        }

        // Shuffle and select required number
        const shuffled = shuffleArray(questions);
        const selected = shuffled.slice(0, questionsPerSubject);

        // Map Prisma result to flattened QuestionWithMeta structure
        const mappedQuestions = selected.map(q => ({
            ...q,
            parentQuestionText: (q as any).parentQuestion?.questionText ?? null,
            parentQuestionImageUrl: (q as any).parentQuestion?.imageUrl ?? null
        }));

        selectedQuestions.push(...mappedQuestions);
    }

    // Final shuffle to mix subjects together
    return shuffleArray(selectedQuestions);
}

/**
 * Get questions for a retake exam
 * Uses same question IDs but shuffles order and options
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

    const questionIds = originalAnswers.map(a => a.questionId);

    // Fetch full question data
    const questions = await prisma.question.findMany({
        where: {
            id: { in: questionIds }
        },
        select: {
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
            questionType: true,
            parentQuestion: {
                select: {
                    questionText: true,
                    imageUrl: true
                }
            }
        } as any
    }) as unknown as QuestionWithMeta[];

    // Map Prisma result to flattened QuestionWithMeta structure
    const mappedQuestions = questions.map(q => ({
        ...q,
        parentQuestionText: (q as any).parentQuestion?.questionText ?? null,
        parentQuestionImageUrl: (q as any).parentQuestion?.imageUrl ?? null
    }));

    // Shuffle question order
    const shuffledQuestions = shuffleArray(mappedQuestions);

    // Shuffle options for each question
    return shuffledQuestions.map(shuffleQuestionOptions);
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
    // Base: 2 hours (7200s) for 100 questions = 72s per question
    const secondsPerQuestion = EXAM_CONFIG.FULL_EXAM_DURATION_SECONDS / EXAM_CONFIG.FULL_EXAM_QUESTIONS;
    return Math.ceil(totalQuestions * secondsPerQuestion);
}

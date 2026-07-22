import { prisma } from '../../config/database';
import { AppError } from '../../shared/errors/AppError';
import { EXAM_STATUS, EXAM_TYPES, STUDY_CONFIG } from '../exams/exams.constants';
import { selectQuestionsForExam } from '../exams/question-selector';
import { institutionContextService } from '../../shared/institutions/context';
import { institutionExamConfigService } from '../../shared/institutions/exam-config';
import { normalizeSubjectLabel } from '../../shared/utils/subjects';
import { QUESTION_POOLS } from '../questions/questions.constants';
import { StartStudySessionInput, CompleteStudySessionInput, StudySessionResponse, StudyQuestionForClient, CompleteStudySessionResponse } from './study.types';

export class StudyService {
    /**
     * Start a new study session.
     * Creates an Exam record with type STUDY and status IN_PROGRESS.
     * Hydrates questions including explanations and correct answers.
     */
    async startStudySession(userId: number, input: StartStudySessionInput): Promise<StudySessionResponse> {
        // 1. Resolve institution context
        const institution = await institutionContextService.resolveForUser(userId, input.institutionCode);

        // 2. Fetch institution active exam config and check if Study Mode is enabled
        const config = await institutionExamConfigService.getActiveConfigForInstitutionId(institution.id);
        if (!config.studyModeEnabled) {
            throw new AppError('Study Mode is currently disabled for your institution.', 403, 'STUDY_MODE_DISABLED');
        }

        // 3. Load user to check premium status
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { isPremium: true }
        });

        if (!user) {
            throw new AppError('User not found', 404);
        }

        const isPremium = user.isPremium;

        // 3. Determine question counts
        // Free users get a teaser of exactly 3 questions total across all selected subjects.
        // Premium users get STUDY_CONFIG.QUESTIONS_PER_SUBJECT (15) per subject up to STUDY_CONFIG.MAX_TOTAL_QUESTIONS (60).
        let questionsPerSubject: number = STUDY_CONFIG.QUESTIONS_PER_SUBJECT;
        let totalCountLimit: number = STUDY_CONFIG.MAX_TOTAL_QUESTIONS;

        if (!isPremium) {
            totalCountLimit = STUDY_CONFIG.FREE_TEASER_QUESTIONS;
            // Distribute teaser questions among selected subjects
            questionsPerSubject = Math.max(1, Math.ceil(STUDY_CONFIG.FREE_TEASER_QUESTIONS / input.subjects.length));
        }

        // Fetch topic blueprints from active exam config
        const topicBlueprints = institutionExamConfigService.getTopicBlueprints(config);

        // 4. Fetch questions using selector
        let questions: any[] = [];

        if (isPremium) {
            // Premium users get a rich mix of Real Past Question Bank & Practice Pool questions
            try {
                questions = await selectQuestionsForExam(
                    input.subjects,
                    EXAM_TYPES.MIXED,
                    questionsPerSubject,
                    [],
                    {
                        deterministic: false,
                        institutionId: institution.id,
                        realQuestionPool: QUESTION_POOLS.REAL_BANK,
                        topicBlueprints,
                    }
                );
            } catch {
                // Fallback to Practice pool if real bank pool for a subject is sparse
                questions = await selectQuestionsForExam(
                    input.subjects,
                    EXAM_TYPES.PRACTICE,
                    questionsPerSubject,
                    [],
                    {
                        deterministic: false,
                        institutionId: institution.id,
                        realQuestionPool: QUESTION_POOLS.REAL_BANK,
                        topicBlueprints,
                    }
                );
            }
        } else {
            // Free users pull exclusively from their Free Exam Pool (featured free question sample)
            questions = await selectQuestionsForExam(
                input.subjects,
                EXAM_TYPES.PRACTICE,
                questionsPerSubject,
                [],
                {
                    deterministic: false,
                    institutionId: institution.id,
                    realQuestionPool: QUESTION_POOLS.REAL_BANK,
                    topicBlueprints,
                    isFeaturedFree: true // Free users access featured free exam pool questions
                }
            );

            // Fallback: if no featured free questions exist for the subject, fetch standard practice bank
            if (questions.length === 0) {
                questions = await selectQuestionsForExam(
                    input.subjects,
                    EXAM_TYPES.PRACTICE,
                    questionsPerSubject,
                    [],
                    {
                        deterministic: false,
                        institutionId: institution.id,
                        realQuestionPool: QUESTION_POOLS.REAL_BANK,
                        topicBlueprints,
                        isFeaturedFree: false
                    }
                );
            }
        }

        // Slice total questions down to the limit (especially relevant for the free teaser of 3)
        if (questions.length > totalCountLimit) {
            questions = questions.slice(0, totalCountLimit);
        }

        if (questions.length === 0) {
            throw new AppError('No questions found for the selected subjects. Please try again.', 422, 'EXAM_INSUFFICIENT_QUESTIONS');
        }

        const startedAt = new Date();

        // 5. Save the session as a STUDY exam record in progress
        const sessionNumber = await this.nextStudySessionNumber(userId);
        const scopeKey = `study_${input.subjects.sort().join('_').toLowerCase()}`;

        const exam = await prisma.exam.create({
            data: {
                userId,
                institutionId: institution.id,
                examType: EXAM_TYPES.STUDY as any,
                nameScopeKey: scopeKey,
                sessionNumber,
                subjectsIncluded: input.subjects,
                totalQuestions: questions.length,
                score: 0,
                percentage: 0,
                spEarned: 0,
                status: EXAM_STATUS.IN_PROGRESS as any,
                startedAt,
                isRetake: false,
                attemptNumber: 1,
                maxRetakes: 0,
            }
        });

        // Create in-progress answer records
        const answerRecords = questions.map((q) => ({
            examId: exam.id,
            questionId: q.id,
            userAnswer: null,
            isCorrect: false,
            timeSpentSeconds: 0,
        }));

        await prisma.examAnswer.createMany({
            data: answerRecords,
        });

        // 6. Map questions to clients with explanations and correct answers intact!
        const studyQuestions: StudyQuestionForClient[] = questions.map((q) => ({
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
            subject: normalizeSubjectLabel(q.subject),
            topic: q.topic,
            correctAnswer: q.correctAnswer,
            explanation: q.explanation ? {
                text: q.explanation.explanationText,
                imageUrl: q.explanation.explanationImageUrl,
                additionalNotes: q.explanation.additionalNotes
            } : null
        }));

        return {
            examId: exam.id,
            subjects: input.subjects,
            totalQuestions: questions.length,
            isPremiumSession: isPremium,
            questions: studyQuestions
        };
    }

    /**
     * Complete a study session, persisting user stats and completing the Exam.
     */
    async completeStudySession(userId: number, examId: number, input: CompleteStudySessionInput): Promise<CompleteStudySessionResponse> {
        const exam = await prisma.exam.findFirst({
            where: {
                id: examId,
                userId,
                examType: EXAM_TYPES.STUDY as any,
                status: EXAM_STATUS.IN_PROGRESS as any
            }
        });

        if (!exam) {
            throw new AppError('Study session not found or already completed', 404, 'EXAM_NOT_FOUND');
        }

        const percentage = exam.totalQuestions > 0 ? Math.round((input.correctCount / exam.totalQuestions) * 100) : 0;

        await prisma.$transaction(async (tx: any) => {
            // Update Exam Record to Completed
            await tx.exam.update({
                where: { id: examId },
                data: {
                    status: EXAM_STATUS.COMPLETED as any,
                    completedAt: new Date(),
                    score: input.correctCount,
                    percentage,
                    spEarned: 0, // No SP awarded in study sessions
                    timeTakenSeconds: input.timeSpentSeconds,
                }
            });

            // If there's subject mastery data, save to metadata or custom logs if needed.
            // For now, updating completed exam stats is enough.
        });

        return {
            examId,
            status: 'COMPLETED',
            message: 'Study session successfully completed and recorded.'
        };
    }

    private async nextStudySessionNumber(userId: number): Promise<number> {
        const result = await prisma.exam.aggregate({
            where: {
                userId,
                examType: EXAM_TYPES.STUDY as any
            },
            _max: {
                sessionNumber: true
            }
        });
        return (result._max.sessionNumber ?? 0) + 1;
    }
}

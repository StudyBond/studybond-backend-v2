
// ============================================
// QUESTIONS SERVICE
// ============================================
// Business logic for managing questions
// Handles CRUD, Filtering, and Parent/Child validation

import prisma from '../../config/database';
import { AppError } from '../../shared/errors/AppError';
import { CreateQuestionInput, UpdateQuestionInput, QuestionFilterQuery, QuestionResponse } from './questions.types';


export class QuestionsService {

    /**
     * Create a new question
     */
    async createQuestion(input: CreateQuestionInput): Promise<QuestionResponse> {
        // Validate Parent Question if provided
        if (input.parentQuestionId) {
            const parent = await prisma.question.findUnique({
                where: { id: input.parentQuestionId }
            });
            if (!parent) {
                throw new AppError(`Parent question ${input.parentQuestionId} not found`, 404);
            }
        }

        const question = await prisma.question.create({
            data: {
                questionText: input.questionText,
                hasImage: input.hasImage ?? false,
                imageUrl: input.imageUrl,

                optionA: input.optionA,
                optionB: input.optionB,
                optionC: input.optionC,
                optionD: input.optionD,
                optionE: input.optionE,

                optionAImageUrl: input.optionAImageUrl,
                optionBImageUrl: input.optionBImageUrl,
                optionCImageUrl: input.optionCImageUrl,
                optionDImageUrl: input.optionDImageUrl,
                optionEImageUrl: input.optionEImageUrl,

                correctAnswer: input.correctAnswer,

                subject: input.subject,
                topic: input.topic,
                difficultyLevel: input.difficultyLevel,
                questionType: input.questionType,

                parentQuestionId: input.parentQuestionId,

                // Create explanation if provided
                explanation: (input.explanationText || input.explanationImageUrl) ? {
                    create: {
                        explanationText: input.explanationText || '',
                        explanationImageUrl: input.explanationImageUrl,
                        additionalNotes: input.additionalNotes
                    }
                } : undefined
            },
            include: {
                parentQuestion: {
                    select: {
                        id: true,
                        questionText: true,
                        imageUrl: true
                    }
                },
                explanation: true
            }
        });

        return this.mapToResponse(question);
    }

    /**
     * Get paginated list of questions with filtering
     */
    async getQuestions(query: QuestionFilterQuery) {
        const page = query.page || 1;
        const limit = query.limit || 20;
        const skip = (page - 1) * limit;

        const where: any = {};

        if (query.subject) where.subject = query.subject;
        if (query.topic) where.topic = { contains: query.topic }; // Loose match for topic
        if (query.questionType) where.questionType = query.questionType;
        if (query.hasImage !== undefined) where.hasImage = query.hasImage;
        if (query.isAiGenerated !== undefined) where.isAiGenerated = query.isAiGenerated;

        // Search text
        if (query.search) {
            where.questionText = {
                contains: query.search
            };
        }

        // Year filtering (often part of topic or meta, adapt as needed)
        // If year is stored in Topic string like "2020 JAMB", we filter by topic
        if (query.year) {
            // Append to topic filter or create new if not exists
            const yearFilter = { contains: query.year };
            if (where.topic) {
                where.topic = { AND: [where.topic, yearFilter] };
            } else {
                where.topic = yearFilter;
            }
        }

        const [questions, total] = await Promise.all([
            prisma.question.findMany({
                where,
                skip,
                take: limit,
                orderBy: { id: 'desc' },
                include: {
                    parentQuestion: {
                        select: {
                            id: true,
                            questionText: true,
                            imageUrl: true
                        }
                    },
                    explanation: true
                }
            }),
            prisma.question.count({ where })
        ]);

        return {
            questions: questions.map(this.mapToResponse),
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * Get single question by ID
     */
    async getQuestionById(id: number): Promise<QuestionResponse> {
        const question = await prisma.question.findUnique({
            where: { id },
            include: {
                parentQuestion: {
                    select: {
                        id: true,
                        questionText: true,
                        imageUrl: true
                    }
                },
                explanation: true
            }
        });

        if (!question) {
            throw new AppError('Question not found', 404);
        }

        return this.mapToResponse(question);
    }

    /**
     * Update question
     */
    async updateQuestion(id: number, input: UpdateQuestionInput): Promise<QuestionResponse> {
        const existing = await prisma.question.findUnique({ where: { id } });
        if (!existing) {
            throw new AppError('Question not found', 404);
        }

        // Validate Parent Question if changing
        if (input.parentQuestionId && input.parentQuestionId !== existing.parentQuestionId) {
            const parent = await prisma.question.findUnique({
                where: { id: input.parentQuestionId }
            });
            if (!parent) {
                throw new AppError(`Parent question ${input.parentQuestionId} not found`, 404);
            }
        }

        const updated = await prisma.question.update({
            where: { id },
            data: {
                ...input,
                explanation: (input.explanationText || input.explanationImageUrl) ? {
                    upsert: {
                        create: {
                            explanationText: input.explanationText || '',
                            explanationImageUrl: input.explanationImageUrl,
                            additionalNotes: input.additionalNotes
                        },
                        update: {
                            explanationText: input.explanationText || undefined,
                            explanationImageUrl: input.explanationImageUrl,
                            additionalNotes: input.additionalNotes
                        }
                    }
                } : undefined
            },
            include: {
                parentQuestion: {
                    select: {
                        id: true,
                        questionText: true,
                        imageUrl: true
                    }
                },
                explanation: true
            }
        });

        return this.mapToResponse(updated);
    }

    /**
     * Delete question
     */
    async deleteQuestion(id: number): Promise<void> {
        const existing = await prisma.question.findUnique({
            where: { id },
            include: { childQuestions: true }
        });

        if (!existing) {
            throw new AppError('Question not found', 404);
        }

        // Prevent deleting parent if it has children
        if (existing.childQuestions.length > 0) {
            throw new AppError('Cannot delete parent question that has linked child questions', 400);
        }

        await prisma.question.delete({ where: { id } });
    }

    /**
     * Helper to map DB result to clean response
     */
    private mapToResponse(q: any): QuestionResponse {
        return {
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

            correctAnswer: q.correctAnswer,

            subject: q.subject,
            topic: q.topic,
            difficultyLevel: q.difficultyLevel,
            questionType: q.questionType,

            parentQuestionId: q.parentQuestionId,
            parentQuestion: q.parentQuestion,

            explanation: q.explanation ? {
                explanationText: q.explanation.explanationText,
                explanationImageUrl: q.explanation.explanationImageUrl,
                additionalNotes: q.explanation.additionalNotes
            } : null,

            createdAt: q.createdAt,
            updatedAt: q.updatedAt
        };
    }
}

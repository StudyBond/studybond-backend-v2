// ============================================
// EXAMS CONTROLLER
// ============================================
// HTTP request handlers for exam endpoints
// Delegates business logic to ExamsService

import { FastifyRequest, FastifyReply } from 'fastify';
import { ExamsService } from './exams.service';
import {
    validateStartExam,
    validateSubmitExam,
    validateExamId,
    validateHistoryQuery
} from './exams.schema';

export class ExamsController {
    private examsService: ExamsService;

    constructor() {
        this.examsService = new ExamsService();
    }

    /**
     * POST /exams/start
     * Start a new exam session
     */
    startExam = async (
        req: FastifyRequest,
        reply: FastifyReply
    ) => {
        const validation = validateStartExam(req.body);
        if (!validation.success) {
            return reply.status(400).send({
                success: false,
                error: {
                    message: 'Validation failed',
                    details: validation.error.flatten().fieldErrors
                }
            });
        }

        const userId = (req.user as any).id;
        const result = await this.examsService.startExam(userId, validation.data);

        return reply.status(201).send({
            success: true,
            data: result
        });
    };

    /**
     * POST /exams/:examId/submit
     * Submit exam answers
     */
    submitExam = async (
        req: FastifyRequest,
        reply: FastifyReply
    ) => {
        const paramValidation = validateExamId(req.params);
        if (!paramValidation.success) {
            return reply.status(400).send({
                success: false,
                error: {
                    message: 'Invalid exam ID',
                    details: paramValidation.error.flatten().fieldErrors
                }
            });
        }

        const bodyValidation = validateSubmitExam(req.body);
        if (!bodyValidation.success) {
            return reply.status(400).send({
                success: false,
                error: {
                    message: 'Validation failed',
                    details: bodyValidation.error.flatten().fieldErrors
                }
            });
        }

        const userId = (req.user as any).id;
        const result = await this.examsService.submitExam(
            userId,
            paramValidation.data.examId,
            bodyValidation.data
        );

        return reply.status(200).send({
            success: true,
            data: result
        });
    };

    /**
     * GET /exams/:examId/questions
     * Get questions for in-progress exam
     */
    getExamQuestions = async (
        req: FastifyRequest,
        reply: FastifyReply
    ) => {
        const paramValidation = validateExamId(req.params);
        if (!paramValidation.success) {
            return reply.status(400).send({
                success: false,
                error: {
                    message: 'Invalid exam ID',
                    details: paramValidation.error.flatten().fieldErrors
                }
            });
        }

        const userId = (req.user as any).id;
        const result = await this.examsService.getExamQuestions(
            userId,
            paramValidation.data.examId
        );

        return reply.status(200).send({
            success: true,
            data: result
        });
    };

    /**
     * GET /exams/history
     * Get user's exam history
     */
    getExamHistory = async (
        req: FastifyRequest,
        reply: FastifyReply
    ) => {
        const validation = validateHistoryQuery(req.query);
        if (!validation.success) {
            return reply.status(400).send({
                success: false,
                error: {
                    message: 'Invalid query parameters',
                    details: validation.error.flatten().fieldErrors
                }
            });
        }

        const userId = (req.user as any).id;
        const result = await this.examsService.getExamHistory(userId, validation.data);

        return reply.status(200).send({
            success: true,
            data: result
        });
    };

    /**
     * GET /exams/:examId
     * Get exam details (completed exams only)
     */
    getExamDetails = async (
        req: FastifyRequest,
        reply: FastifyReply
    ) => {
        const paramValidation = validateExamId(req.params);
        if (!paramValidation.success) {
            return reply.status(400).send({
                success: false,
                error: {
                    message: 'Invalid exam ID',
                    details: paramValidation.error.flatten().fieldErrors
                }
            });
        }

        const userId = (req.user as any).id;
        const result = await this.examsService.getExamDetails(
            userId,
            paramValidation.data.examId
        );

        return reply.status(200).send({
            success: true,
            data: result
        });
    };

    /**
     * POST /exams/:examId/retake
     * Create a retake of an existing exam
     */
    retakeExam = async (
        req: FastifyRequest,
        reply: FastifyReply
    ) => {
        const paramValidation = validateExamId(req.params);
        if (!paramValidation.success) {
            return reply.status(400).send({
                success: false,
                error: {
                    message: 'Invalid exam ID',
                    details: paramValidation.error.flatten().fieldErrors
                }
            });
        }

        const userId = (req.user as any).id;
        const result = await this.examsService.retakeExam(
            userId,
            paramValidation.data.examId
        );

        return reply.status(201).send({
            success: true,
            data: result
        });
    };

    /**
     * POST /exams/:examId/abandon
     * Abandon an in-progress exam
     */
    abandonExam = async (
        req: FastifyRequest,
        reply: FastifyReply
    ) => {
        const paramValidation = validateExamId(req.params);
        if (!paramValidation.success) {
            return reply.status(400).send({
                success: false,
                error: {
                    message: 'Invalid exam ID',
                    details: paramValidation.error.flatten().fieldErrors
                }
            });
        }

        const userId = (req.user as any).id;
        const result = await this.examsService.abandonExam(
            userId,
            paramValidation.data.examId
        );

        return reply.status(200).send({
            success: true,
            data: result
        });
    };
}

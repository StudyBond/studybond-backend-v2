// Note : All business logic has been delegated to ExamsService so these are the HTTP request handlers for exam endpoints

import { FastifyRequest, FastifyReply } from 'fastify';
import { ExamsService } from './exams.service';
import {
    startExamSchema,
    startDailyChallengeSchema,
    submitExamSchema,
    examIdParamSchema,
    historyQuerySchema,
    reportViolationSchema
} from './exams.schema';
import { parseWithSchema } from '../../shared/utils/validation';
import { optionalIdempotencyHeadersSchema } from '../../shared/idempotency/schema';
import { resolveIdempotencyKey } from '../../shared/idempotency/idempotency';

export class ExamsController {
    private examsService: ExamsService;

    constructor() {
        this.examsService = new ExamsService();
    }

    /* GET /exams/eligibility - Get current daily limits and credits */
    checkEligibility = async (
        req: FastifyRequest,
        reply: FastifyReply
    ) => {
        const userId = (req.user as { userId: number }).userId;
        // Check for an empty subject array to just get the remaining credits status
        const result = await this.examsService.checkExamEligibility(userId, 'REAL_PAST_QUESTION', []);
        
        return reply.status(200).send({
            success: true,
            data: result
        });
    };

    /* POST /exams/start - Start a new exam session */
    startExam = async (
        req: FastifyRequest,
        reply: FastifyReply
    ) => {
        const payload = parseWithSchema(startExamSchema, req.body, 'Invalid exam start request');
        const headers = parseWithSchema(optionalIdempotencyHeadersSchema, req.headers, 'Invalid request headers');

        const userId = (req.user as { userId: number }).userId;
        const idempotencyKey = resolveIdempotencyKey(headers['idempotency-key'], 'exam_start');
        const result = await this.examsService.startExam(userId, payload, idempotencyKey);

        return reply.status(201).send({
            success: true,
            data: result
        });
    };

    /* POST /exams/daily-challenge/start - Start a global daily challenge */
    startDailyChallenge = async (
        req: FastifyRequest,
        reply: FastifyReply
    ) => {
        const payload = parseWithSchema(startDailyChallengeSchema, req.body, 'Invalid daily challenge request');
        const headers = parseWithSchema(optionalIdempotencyHeadersSchema, req.headers, 'Invalid request headers');

        const userId = (req.user as { userId: number }).userId;
        const idempotencyKey = resolveIdempotencyKey(headers['idempotency-key'], 'daily_challenge_start');
        const result = await this.examsService.startDailyChallenge(userId, payload, idempotencyKey);

        return reply.status(201).send({
            success: true,
            data: result
        });
    };

    /* POST /exams/:examId/submit - Submit exam answers */
    submitExam = async (
        req: FastifyRequest,
        reply: FastifyReply
    ) => {
        const params = parseWithSchema(examIdParamSchema, req.params, 'Invalid exam ID');
        const payload = parseWithSchema(submitExamSchema, req.body, 'Invalid exam submission payload');
        const headers = parseWithSchema(optionalIdempotencyHeadersSchema, req.headers, 'Invalid request headers');

        const userId = (req.user as { userId: number }).userId;
        const idempotencyKey = resolveIdempotencyKey(headers['idempotency-key'], `exam_submit_${params.examId}`);
        const result = await this.examsService.submitExam(
            userId,
            params.examId,
            payload,
            idempotencyKey
        );

        return reply.status(200).send({
            success: true,
            data: result
        });
    };

    /* GET /exams/:examId/questions - Get questions for in-progress exam */
    getExamQuestions = async (
        req: FastifyRequest,
        reply: FastifyReply
    ) => {
        const params = parseWithSchema(examIdParamSchema, req.params, 'Invalid exam ID');

        const userId = (req.user as { userId: number }).userId;
        const result = await this.examsService.getExamQuestions(
            userId,
            params.examId
        );

        return reply.status(200).send({
            success: true,
            data: result
        });
    };

    /* GET /exams/history - Get user's exam history */
    getExamHistory = async (
        req: FastifyRequest,
        reply: FastifyReply
    ) => {
        const query = parseWithSchema(historyQuerySchema, req.query, 'Invalid exam history query parameters');

        const userId = (req.user as { userId: number }).userId;
        const result = await this.examsService.getExamHistory(userId, query);

        return reply.status(200).send({
            success: true,
            data: result
        });
    };

    /* GET /exams/:examId - Get exam details (completed exams only) */
    getExamDetails = async (
        req: FastifyRequest,
        reply: FastifyReply
    ) => {
        const params = parseWithSchema(examIdParamSchema, req.params, 'Invalid exam ID');

        const userId = (req.user as { userId: number }).userId;
        const result = await this.examsService.getExamDetails(
            userId,
            params.examId
        );

        return reply.status(200).send({
            success: true,
            data: result
        });
    };

    /* POST /exams/:examId/retake - Create a retake of an existing exam */
    retakeExam = async (
        req: FastifyRequest,
        reply: FastifyReply
    ) => {
        const params = parseWithSchema(examIdParamSchema, req.params, 'Invalid exam ID');
        const headers = parseWithSchema(optionalIdempotencyHeadersSchema, req.headers, 'Invalid request headers');

        const userId = (req.user as { userId: number }).userId;
        const idempotencyKey = resolveIdempotencyKey(headers['idempotency-key'], `exam_retake_${params.examId}`);
        const result = await this.examsService.retakeExam(
            userId,
            params.examId,
            idempotencyKey
        );

        return reply.status(201).send({
            success: true,
            data: result
        });
    };

    /* POST /exams/:examId/abandon - Abandon an in-progress exam */
    abandonExam = async (
        req: FastifyRequest,
        reply: FastifyReply
    ) => {
        const params = parseWithSchema(examIdParamSchema, req.params, 'Invalid exam ID');

        const userId = (req.user as { userId: number }).userId;
        const result = await this.examsService.abandonExam(
            userId,
            params.examId
        );

        return reply.status(200).send({
            success: true,
            data: result
        });
    };
    /* POST /exams/:examId/violations - Report an anti-cheat violation */
    reportViolation = async (
        req: FastifyRequest,
        reply: FastifyReply
    ) => {
        const params = parseWithSchema(examIdParamSchema, req.params, 'Invalid exam ID');
        const payload = parseWithSchema(reportViolationSchema, req.body, 'Invalid violation payload');

        const userId = (req.user as { userId: number }).userId;
        const result = await this.examsService.reportViolation(
            userId,
            params.examId,
            payload
        );

        return reply.status(200).send({
            success: true,
            data: result
        });
    };
}

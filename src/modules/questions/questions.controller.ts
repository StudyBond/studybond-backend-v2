
// ============================================
// QUESTIONS CONTROLLER
// ============================================
// HTTP request handlers for question endpoints

import { FastifyRequest, FastifyReply } from 'fastify';
import { QuestionsService } from './questions.service';
import {
    createQuestionSchema,
    updateQuestionSchema,
    questionFilterSchema,
    questionIdParamSchema
} from './questions.schema';
import { CreateQuestionInput, UpdateQuestionInput, QuestionFilterQuery } from './questions.types';

export class QuestionsController {
    private service: QuestionsService;

    constructor() {
        this.service = new QuestionsService();
    }

    createQuestion = async (
        request: FastifyRequest<{ Body: CreateQuestionInput }>,
        reply: FastifyReply
    ) => {
        const input = createQuestionSchema.parse(request.body);
        const question = await this.service.createQuestion(input as CreateQuestionInput);
        return reply.code(201).send(question);
    };

    getQuestions = async (
        request: FastifyRequest<{ Querystring: QuestionFilterQuery }>,
        reply: FastifyReply
    ) => {
        const query = questionFilterSchema.parse(request.query);
        const result = await this.service.getQuestions(query);
        return reply.send(result);
    };

    getQuestionById = async (
        request: FastifyRequest<{ Params: { id: number } }>,
        reply: FastifyReply
    ) => {
        const { id } = questionIdParamSchema.parse(request.params);
        const question = await this.service.getQuestionById(id);
        return reply.send(question);
    };

    updateQuestion = async (
        request: FastifyRequest<{ Params: { id: number }, Body: UpdateQuestionInput }>,
        reply: FastifyReply
    ) => {
        const { id } = questionIdParamSchema.parse(request.params);
        const input = updateQuestionSchema.parse(request.body);
        const question = await this.service.updateQuestion(id, input as UpdateQuestionInput);
        return reply.send(question);
    };

    deleteQuestion = async (
        request: FastifyRequest<{ Params: { id: number } }>,
        reply: FastifyReply
    ) => {
        const { id } = questionIdParamSchema.parse(request.params);
        await this.service.deleteQuestion(id);
        return reply.code(204).send();
    };


    bulkUpload = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        // Dynamic import to avoid circular dep if any (optional, but keeping style)
        const { parseCSVStream, parseExcel, processBulkUpload } = await import('./bulk-upload');
        const { AppError } = await import('../../shared/errors/AppError');

        const file = await request.file();

        if (!file) {
            throw new AppError('No file uploaded', 400);
        }

        const filename = file.filename.toLowerCase();
        // Do NOT convert to buffer immediately for CSV

        let questions;

        if (filename.endsWith('.csv')) {
            // Pass the stream directly
            questions = await parseCSVStream(file.file);
        } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
            // Excel needs buffer, verify size limit first if possible
            const buffer = await file.toBuffer();
            questions = parseExcel(buffer);
        } else {
            throw new AppError('Unsupported file format. Use CSV or Excel (.xlsx, .xls)', 400);
        }

        if (questions.length === 0) {
            throw new AppError('File contains no data rows', 400);
        }

        if (questions.length === 0) {
            throw new AppError('File contains no data rows', 400);
        }

        const result = await processBulkUpload(questions);

        return reply.code(result.success ? 201 : 400).send(result);
    };
}

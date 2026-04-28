// HTTP request handlers for question endpoints

import { FastifyRequest, FastifyReply } from 'fastify';
import { QuestionsService } from './questions.service';
import {
    bulkUploadQuerySchema,
    createQuestionSchema,
    questionAssetKindParamSchema,
    updateQuestionSchema,
    questionFilterSchema,
    questionIdParamSchema
} from './questions.schema';
import { BulkQuestionUploadQuery, CreateQuestionInput, UpdateQuestionInput, QuestionFilterQuery } from './questions.types';
import { parseWithSchema } from '../../shared/utils/validation';
import { QuestionAssetKind } from './question-assets';
import { AppError } from '../../shared/errors/AppError';
import { parseCSVStream, parseExcel, processBulkUpload } from './bulk-upload';

export class QuestionsController {
    private service: QuestionsService;

    constructor() {
        this.service = new QuestionsService();
    }

    createQuestion = async (
        request: FastifyRequest<{ Body: CreateQuestionInput }>,
        reply: FastifyReply
    ) => {
        const input = parseWithSchema(createQuestionSchema, request.body, 'Invalid question payload');
        const question = await this.service.createQuestion(input as CreateQuestionInput);
        return reply.code(201).send(question);
    };

    getQuestions = async (
        request: FastifyRequest<{ Querystring: QuestionFilterQuery }>,
        reply: FastifyReply
    ) => {
        const query = parseWithSchema(questionFilterSchema, request.query, 'Invalid question query parameters');
        const result = await this.service.getQuestions(query);
        return reply.send(result);
    };

    getQuestionById = async (
        request: FastifyRequest<{ Params: { id: number } }>,
        reply: FastifyReply
    ) => {
        const { id } = parseWithSchema(questionIdParamSchema, request.params, 'Invalid question ID');
        const question = await this.service.getQuestionById(id);
        return reply.send(question);
    };

    updateQuestion = async (
        request: FastifyRequest<{ Params: { id: number }, Body: UpdateQuestionInput }>,
        reply: FastifyReply
    ) => {
        const { id } = parseWithSchema(questionIdParamSchema, request.params, 'Invalid question ID');
        const input = parseWithSchema(updateQuestionSchema, request.body, 'Invalid question update payload');
        const question = await this.service.updateQuestion(id, input as UpdateQuestionInput);
        return reply.send(question);
    };

    deleteQuestion = async (
        request: FastifyRequest<{ Params: { id: number } }>,
        reply: FastifyReply
    ) => {
        const { id } = parseWithSchema(questionIdParamSchema, request.params, 'Invalid question ID');
        await this.service.deleteQuestion(id);
        return reply.code(204).send();
    };

    uploadQuestionAsset = async (
        request: FastifyRequest<{ Params: { kind: string } }>,
        reply: FastifyReply
    ) => {
        const { kind } = parseWithSchema(questionAssetKindParamSchema, request.params, 'Invalid question asset type');
        const file = await request.file();

        if (!file) {
            throw new AppError('No image file uploaded', 400, 'VALIDATION_ERROR');
        }

        if (!file.mimetype?.startsWith('image/')) {
            throw new AppError('Only image uploads are allowed for question assets.', 400, 'VALIDATION_ERROR');
        }

        const buffer = await file.toBuffer();
        const asset = await this.service.uploadQuestionAsset({
            kind: kind as QuestionAssetKind,
            buffer,
            filename: file.filename,
            contentType: file.mimetype
        });

        return reply.code(201).send(asset);
    };


    bulkUpload = async (
        request: FastifyRequest<{ Querystring: BulkQuestionUploadQuery }>,
        reply: FastifyReply
    ) => {




        const query = parseWithSchema(bulkUploadQuerySchema, request.query, 'Invalid bulk upload query parameters');
        const file = await request.file();

        if (!file) {
            throw new AppError('No file uploaded', 400);
        }

        const filename = file.filename.toLowerCase();
        // Do NOT convert to buffer immediately for CSV

        let questions;

        if (filename.endsWith('.csv')) {
            questions = await parseCSVStream(file.file);
        } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
            // Excel needs buffer, we should verify size limit first if possible
            const buffer = await file.toBuffer();
            questions = parseExcel(buffer);
        } else {
            throw new AppError('Unsupported file format. Use CSV or Excel (.xlsx, .xls)', 400);
        }

        if (questions.length === 0) {
            throw new AppError('File contains no data rows', 400);
        }

        const result = await processBulkUpload(questions, query);

        return reply.code(result.success ? 201 : 422).send(result);
    };
}

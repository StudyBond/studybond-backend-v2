// HTTP request handlers for question endpoints

import { FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { Readable } from 'stream';
import { QuestionsService } from './questions.service';
import {
    bulkUploadQuerySchema,
    bulkUploadHistoryQuerySchema,
    bulkUploadDuplicateCheckQuerySchema,
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
import prisma from '../../config/database';

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
        const originalFilename = file.filename;

        let questions;
        let fileHash: string | undefined = (query as any).fileHash;

        if (filename.endsWith('.csv')) {
            // For CSV, we need the buffer for hashing but the stream for parsing
            // Read the full buffer first, hash it, then parse
            const buffer = await file.toBuffer();
            if (!fileHash) {
                fileHash = createHash('sha256').update(buffer).digest('hex');
            }
            const stream = Readable.from(buffer);
            questions = await parseCSVStream(stream);
        } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
            const buffer = await file.toBuffer();
            if (!fileHash) {
                fileHash = createHash('sha256').update(buffer).digest('hex');
            }
            questions = parseExcel(buffer);
        } else {
            throw new AppError('Unsupported file format. Use CSV or Excel (.xlsx, .xls)', 400);
        }

        if (questions.length === 0) {
            throw new AppError('File contains no data rows', 400);
        }

        const userId = (request as any).user?.id;
        const context = userId && fileHash
            ? { uploadedById: userId, fileHash, fileName: originalFilename }
            : undefined;

        const result = await processBulkUpload(questions, query, context);

        return reply.code(result.success ? 201 : 422).send(result);
    };

    // ── Bulk Upload History ────────────────────────────

    bulkUploadHistory = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const query = parseWithSchema(bulkUploadHistoryQuerySchema, request.query, 'Invalid history query');
        const limit = query.limit ?? 20;

        const where: any = {};
        if (query.institutionCode) {
            const institution = await prisma.institution.findFirst({
                where: { code: query.institutionCode.trim().toUpperCase(), isActive: true },
                select: { id: true }
            });
            if (institution) {
                where.institutionId = institution.id;
            }
        }

        const [batches, total] = await Promise.all([
            prisma.bulkUploadBatch.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: limit,
                include: {
                    institution: { select: { code: true } },
                    uploadedBy: { select: { fullName: true } }
                }
            }),
            prisma.bulkUploadBatch.count({ where })
        ]);

        return reply.send({
            batches: batches.map((batch: any) => ({
                id: batch.id,
                institutionId: batch.institutionId,
                institutionCode: batch.institution.code,
                uploadedById: batch.uploadedById,
                uploaderName: batch.uploadedBy.fullName,
                fileName: batch.fileName,
                fileHash: batch.fileHash,
                totalRows: batch.totalRows,
                successCount: batch.successCount,
                errorCount: batch.errorCount,
                questionCount: batch.questionIds.length,
                status: batch.status,
                createdAt: batch.createdAt.toISOString()
            })),
            total
        });
    };

    // ── Duplicate Check ────────────────────────────────

    bulkUploadDuplicateCheck = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const query = parseWithSchema(bulkUploadDuplicateCheckQuerySchema, request.query, 'Invalid duplicate check query');

        const existing = await prisma.bulkUploadBatch.findFirst({
            where: {
                fileHash: query.fileHash,
                status: 'COMPLETED'
            },
            orderBy: { createdAt: 'desc' },
            include: {
                institution: { select: { code: true } },
                uploadedBy: { select: { fullName: true } }
            }
        });

        if (!existing) {
            return reply.send({ isDuplicate: false, existingBatch: null });
        }

        return reply.send({
            isDuplicate: true,
            existingBatch: {
                id: existing.id,
                institutionId: existing.institutionId,
                institutionCode: existing.institution.code,
                uploadedById: existing.uploadedById,
                uploaderName: existing.uploadedBy.fullName,
                fileName: existing.fileName,
                fileHash: existing.fileHash,
                totalRows: existing.totalRows,
                successCount: existing.successCount,
                errorCount: existing.errorCount,
                questionCount: existing.questionIds.length,
                status: existing.status,
                createdAt: existing.createdAt.toISOString()
            }
        });
    };
}

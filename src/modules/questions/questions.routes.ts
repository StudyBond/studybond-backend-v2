import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { QuestionsController } from './questions.controller';
import { authenticate } from '../../shared/decorators/authenticate';
import { requireAdmin } from '../../shared/decorators/requireAdmin';
import {
    bulkUploadQuerySchema,
    bulkUploadHistoryQuerySchema,
    bulkUploadDuplicateCheckQuerySchema,
    createQuestionSchema,
    questionAssetKindParamSchema,
    questionFilterSchema,
    questionIdParamSchema,
    updateQuestionSchema
} from './questions.schema';
import {
    bulkUploadResponseSchema,
    bulkUploadHistoryResponseSchema,
    bulkUploadDuplicateCheckResponseSchema,
    questionListResponseSchema,
    questionAssetUploadResponseSchema,
    questionResponseSchema
} from './questions.openapi';
import { withStandardErrorResponses } from '../../shared/openapi/responses';

export async function questionsRoutes(app: FastifyInstance) {
    const controller = new QuestionsController();

    // All routes require authentication and admin privileges
    app.addHook('preHandler', authenticate);
    app.addHook('preHandler', requireAdmin);

    // Create
    app.post('/', {
        schema: {
            tags: ['Questions'],
            summary: 'Create question',
            description: 'Create a new question in the admin question bank.',
            body: createQuestionSchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                201: questionResponseSchema
            })
        }
    }, controller.createQuestion);

    // Read
    app.get('/', {
        schema: {
            tags: ['Questions'],
            summary: 'List questions',
            description: 'List questions with filtering and pagination for admin moderation and content management.',
            querystring: questionFilterSchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: questionListResponseSchema
            })
        }
    }, controller.getQuestions);

    app.post('/assets/upload/:kind', {
        schema: {
            tags: ['Questions'],
            summary: 'Upload question image asset',
            description: 'Upload a question, option, or explanation image to Cloudinary and receive the managed asset metadata required for create/update flows.',
            params: questionAssetKindParamSchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                201: questionAssetUploadResponseSchema
            })
        }
    }, controller.uploadQuestionAsset);

    app.get('/:id', {
        schema: {
            tags: ['Questions'],
            summary: 'Get question by id',
            description: 'Fetch a single question from the admin question bank.',
            params: questionIdParamSchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: questionResponseSchema
            })
        }
    }, controller.getQuestionById);

    // Update
    app.put('/:id', {
        schema: {
            tags: ['Questions'],
            summary: 'Update question',
            description: 'Update a question in the admin question bank.',
            params: questionIdParamSchema,
            body: updateQuestionSchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: questionResponseSchema
            })
        }
    }, controller.updateQuestion);

    // Delete
    app.delete('/:id', {
        schema: {
            tags: ['Questions'],
            summary: 'Delete question',
            description: 'Delete a question that is safe to remove from the question bank.',
            params: questionIdParamSchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                204: z.null()
            })
        }
    }, controller.deleteQuestion);

    // ── Bulk Upload Management ─────────────────────────

    // Upload history (must be registered before /bulk to avoid route conflicts)
    app.get('/bulk/history', {
        schema: {
            tags: ['Questions'],
            summary: 'Bulk upload history',
            description: 'List recent bulk upload batches with metadata for auditing.',
            querystring: bulkUploadHistoryQuerySchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: bulkUploadHistoryResponseSchema
            })
        }
    }, controller.bulkUploadHistory);

    // Duplicate check
    app.get('/bulk/check-duplicate', {
        schema: {
            tags: ['Questions'],
            summary: 'Check for duplicate file',
            description: 'Check if a file with the given SHA-256 hash has already been uploaded.',
            querystring: bulkUploadDuplicateCheckQuerySchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: bulkUploadDuplicateCheckResponseSchema
            })
        }
    }, controller.bulkUploadDuplicateCheck);

    // Bulk Upload (CSV/Excel)
    app.post('/bulk', {
        schema: {
            tags: ['Questions'],
            summary: 'Bulk upload questions',
            description: 'Upload a CSV or Excel file to create many questions at once.',
            querystring: bulkUploadQuerySchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                201: bulkUploadResponseSchema,
                422: bulkUploadResponseSchema
            })
        }
    }, controller.bulkUpload);

    app.log.info('Questions routes registered');
}


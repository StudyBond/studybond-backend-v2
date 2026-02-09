// ============================================
// EXAMS ROUTES
// ============================================
// API route definitions for exam endpoints
// All routes require authentication

import { FastifyInstance } from 'fastify';
import { ExamsController } from './exams.controller';
import { startExamSchema, submitExamSchema, examIdParamSchema, historyQuerySchema } from './exams.schema';

export async function examsRoutes(app: FastifyInstance) {
    const controller = new ExamsController();

    // ============================================
    // PROTECTED ROUTES (require authentication)
    // ============================================

    /**
     * POST /exams/start
     * Start a new exam session
     * Body: { examType: 'REAL_PAST_QUESTION' | 'PRACTICE', subjects: string[] }
     */
    app.post('/start', {
        preValidation: [app.authenticate],
        schema: {
            tags: ['Exams'],
            summary: 'Start a new exam',
            description: 'Starts a new exam session with selected subjects.',
            body: startExamSchema
        }
    }, controller.startExam);

    /**
     * POST /exams/:examId/submit
     * Submit exam answers and get results
     */
    app.post('/:examId/submit', {
        preValidation: [app.authenticate],
        schema: {
            tags: ['Exams'],
            summary: 'Submit exam answers',
            description: 'Submits answers for an in-progress exam and returns scored results.',
            params: examIdParamSchema,
            body: submitExamSchema
        }
    }, controller.submitExam);

    /**
     * GET /exams/:examId/questions
     * Get questions for an in-progress exam (for resuming)
     */
    app.get('/:examId/questions', {
        preValidation: [app.authenticate],
        schema: {
            tags: ['Exams'],
            summary: 'Get exam questions',
            description: 'Gets questions for an in-progress exam. Used for resuming after page refresh.',
            params: examIdParamSchema
        }
    }, controller.getExamQuestions);

    /**
     * GET /exams/history
     * Get user's exam history with pagination
     */
    app.get('/history', {
        preValidation: [app.authenticate],
        schema: {
            tags: ['Exams'],
            summary: 'Get exam history',
            description: 'Gets paginated list of user exams with aggregate statistics.',
            querystring: historyQuerySchema
        }
    }, controller.getExamHistory);

    /**
     * GET /exams/:examId
     * Get full exam details (completed exams only)
     */
    app.get('/:examId', {
        preValidation: [app.authenticate],
        schema: {
            tags: ['Exams'],
            summary: 'Get exam details',
            description: 'Gets full details for a completed exam including answers and explanations.',
            params: examIdParamSchema
        }
    }, controller.getExamDetails);

    /**
     * POST /exams/:examId/retake
     * Create a retake of an existing exam
     */
    app.post('/:examId/retake', {
        preValidation: [app.authenticate],
        schema: {
            tags: ['Exams'],
            summary: 'Retake exam',
            description: 'Creates a retake of a completed exam. Questions and options are shuffled.',
            params: examIdParamSchema
        }
    }, controller.retakeExam);

    /**
     * POST /exams/:examId/abandon
     * Abandon an in-progress exam
     */
    app.post('/:examId/abandon', {
        preValidation: [app.authenticate],
        schema: {
            tags: ['Exams'],
            summary: 'Abandon exam',
            description: 'Abandons an in-progress exam. No SP is earned.',
            params: examIdParamSchema
        }
    }, controller.abandonExam);
}

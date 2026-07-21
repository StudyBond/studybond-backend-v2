// All routes require authentication

import { FastifyInstance } from 'fastify';
import { ExamsController } from './exams.controller';
import { startExamSchema, startDailyChallengeSchema, submitExamSchema, examIdParamSchema, historyQuerySchema, syncExamsSchema } from './exams.schema';
import { optionalIdempotencyHeadersSchema } from '../../shared/idempotency/schema';
import {
    examAbandonPayloadSchema,
    examHistoryPayloadSchema,
    examResultPayloadSchema,
    examSessionPayloadSchema,
    examEligibilityPayloadSchema,
    syncExamsPayloadSchema
} from './exams.openapi';
import { successEnvelopeSchema, withStandardErrorResponses } from '../../shared/openapi/responses';

export async function examsRoutes(app: FastifyInstance) {
    const controller = new ExamsController(app);

    /* POST /exams/start - Start a new exam session
     * Body: { examType: 'REAL_PAST_QUESTION' | 'PRACTICE', subjects: string[] }
     */
    app.post('/start', {
        preValidation: [app.authenticate],
        config: {
            rateLimit: {
                max: 30,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Exams'],
            summary: 'Start a new exam',
            description: 'Starts a new exam session with selected subjects.',
            headers: optionalIdempotencyHeadersSchema,
            body: startExamSchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                201: successEnvelopeSchema(examSessionPayloadSchema)
            })
        }
    }, controller.startExam);

    /* POST /exams/daily-challenge/start - Start a global daily challenge */
    app.post('/daily-challenge/start', {
        preValidation: [app.authenticate],
        config: {
            rateLimit: {
                max: 20,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Exams'],
            summary: 'Start global daily challenge',
            description: 'Starts the daily challenge. Exactly 4 subjects required. 3 minute limit.',
            headers: optionalIdempotencyHeadersSchema,
            body: startDailyChallengeSchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                201: successEnvelopeSchema(examSessionPayloadSchema)
            })
        }
    }, controller.startDailyChallenge);

    /* GET /exams/daily-challenge/start - Helper to diagnose method mismatch */
    app.get('/daily-challenge/start', async () => {
        return {
            success: false,
            message: 'Daily Challenge must be started via POST request. Please ensure you are clicking the "Start" button in the application.'
        };
    });

    /* GET /exams/eligibility - Check user's exam limits and credits */
    app.get('/eligibility', {
        preValidation: [app.authenticate],
        config: {
            rateLimit: {
                max: 120,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Exams'],
            summary: 'Check exam eligibility',
            description: 'Gets current daily limits, used subject credits, and remaining credits for the user.',
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: successEnvelopeSchema(examEligibilityPayloadSchema)
            })
        }
    }, controller.checkEligibility);

    /* POST /exams/:examId/submit - Submit exam answers and get results */
    app.post('/:examId/submit', {
        preValidation: [app.authenticate],
        config: {
            rateLimit: {
                max: 30,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Exams'],
            summary: 'Submit exam answers',
            description: 'Submits answers for an in-progress exam and returns scored results.',
            headers: optionalIdempotencyHeadersSchema,
            params: examIdParamSchema,
            body: submitExamSchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: successEnvelopeSchema(examResultPayloadSchema)
            })
        }
    }, controller.submitExam);

    /* GET /exams/:examId/questions - Get questions for an in-progress exam (for resuming) */
    app.get('/:examId/questions', {
        preValidation: [app.authenticate],
        config: {
            rateLimit: {
                max: 120,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Exams'],
            summary: 'Get exam questions',
            description: 'Gets questions for an in-progress exam. Used for resuming after page refresh.',
            params: examIdParamSchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: successEnvelopeSchema(examSessionPayloadSchema)
            })
        }
    }, controller.getExamQuestions);

    /* GET /exams/history - Get user's exam history with pagination */
    app.get('/history', {
        preValidation: [app.authenticate],
        config: {
            rateLimit: {
                max: 120,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Exams'],
            summary: 'Get exam history',
            description: 'Gets paginated list of user exams with aggregate statistics.',
            querystring: historyQuerySchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: successEnvelopeSchema(examHistoryPayloadSchema)
            })
        }
    }, controller.getExamHistory);

    /* GET /exams/:examId - Get full exam details (completed exams only) */
    app.get('/:examId', {
        preValidation: [app.authenticate],
        config: {
            rateLimit: {
                max: 120,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Exams'],
            summary: 'Get exam details',
            description: 'Gets full details for a completed exam including answers and explanations.',
            params: examIdParamSchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: successEnvelopeSchema(examResultPayloadSchema)
            })
        }
    }, controller.getExamDetails);

    /* POST /exams/:examId/retake - Create a retake of an existing exam */
    app.post('/:examId/retake', {
        preValidation: [app.authenticate],
        config: {
            rateLimit: {
                max: 30,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Exams'],
            summary: 'Retake exam',
            description: 'Creates a retake of a completed exam. Questions and options are shuffled.',
            headers: optionalIdempotencyHeadersSchema,
            params: examIdParamSchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                201: successEnvelopeSchema(examSessionPayloadSchema)
            })
        }
    }, controller.retakeExam);

    /* POST /exams/:examId/abandon - Abandon an in-progress exam */
    app.post('/:examId/abandon', {
        preValidation: [app.authenticate],
        config: {
            rateLimit: {
                max: 30,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Exams'],
            summary: 'Abandon exam',
            description: 'Abandons an in-progress exam. No SP is earned.',
            params: examIdParamSchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: successEnvelopeSchema(examAbandonPayloadSchema)
            })
        }
    }, controller.abandonExam);

    /* POST /exams/sync - Sync a batch of offline submissions */
    app.post('/sync', {
        preValidation: [app.authenticate],
        config: {
            rateLimit: {
                max: 30,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Exams'],
            summary: 'Sync offline exams',
            description: 'Processes a batch of offline exam submissions.',
            body: syncExamsSchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: successEnvelopeSchema(syncExamsPayloadSchema)
            })
        }
    }, controller.syncExams);

}

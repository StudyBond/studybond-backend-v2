import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { StudyController } from './study.controller';
import { startStudySessionSchema, completeStudySessionSchema, studyIdParamSchema } from './study.schema';
import { successEnvelopeSchema, withStandardErrorResponses } from '../../shared/openapi/responses';

export async function studyRoutes(app: FastifyInstance) {
    const controller = new StudyController();

    /** GET /study/topics — Fetch available topic families and subtopics tree */
    app.get('/topics', {
        preValidation: [app.authenticate],
        config: {
            rateLimit: {
                max: 60,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Study Mode'],
            summary: 'Fetch available topics and subtopics tree',
            description: 'Returns topic families and subtopics with live question counts per subject.',
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: successEnvelopeSchema(z.any())
            })
        }
    }, controller.getTopics);

    /** POST /study/start — Start a new study session */
    app.post('/start', {
        preValidation: [app.authenticate],
        config: {
            rateLimit: {
                max: 30,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Study Mode'],
            summary: 'Start a new study session',
            description: 'Starts a self-paced study session with selected subjects. Free users get 3 questions max.',
            body: startStudySessionSchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                201: successEnvelopeSchema(z.any())
            })
        }
    }, controller.startSession);

    /** POST /study/:examId/complete — Complete a study session */
    app.post('/:examId/complete', {
        preValidation: [app.authenticate],
        config: {
            rateLimit: {
                max: 30,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Study Mode'],
            summary: 'Complete a study session',
            description: 'Saves statistics for the study session and marks the corresponding exam as completed.',
            params: studyIdParamSchema,
            body: completeStudySessionSchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: successEnvelopeSchema(z.any())
            })
        }
    }, controller.completeSession);
}

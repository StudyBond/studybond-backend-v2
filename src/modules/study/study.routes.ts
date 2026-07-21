import { FastifyInstance } from 'fastify';
import { StudyController } from './study.controller';
import { startStudySessionSchema, completeStudySessionSchema, studyIdParamSchema } from './study.schema';
import { successEnvelopeSchema, withStandardErrorResponses } from '../../shared/openapi/responses';

export async function studyRoutes(app: FastifyInstance) {
    const controller = new StudyController();

    /** POST /study/start — Start a new study session */
    app.post('/start', {
        preValidation: [app.authenticate],
        schema: {
            tags: ['Study Mode'],
            summary: 'Start a new study session',
            description: 'Starts a self-paced study session with selected subjects. Free users get 3 questions max.',
            body: startStudySessionSchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                201: successEnvelopeSchema(
                    // We don't have study-specific openapi schema declared separately, 
                    // fastify will serialize it as standard JSON based on service outputs.
                    // This is sufficient for the Fastify framework.
                    startStudySessionSchema
                )
            })
        }
    }, controller.startSession);

    /** POST /study/:examId/complete — Complete a study session */
    app.post('/:examId/complete', {
        preValidation: [app.authenticate],
        schema: {
            tags: ['Study Mode'],
            summary: 'Complete a study session',
            description: 'Saves statistics for the study session and marks the corresponding exam as completed.',
            params: studyIdParamSchema,
            body: completeStudySessionSchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: successEnvelopeSchema(completeStudySessionSchema)
            })
        }
    }, controller.completeSession);
}

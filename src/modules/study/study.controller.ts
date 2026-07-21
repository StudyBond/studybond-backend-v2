import { FastifyRequest, FastifyReply } from 'fastify';
import { StudyService } from './study.service';
import { startStudySessionSchema, completeStudySessionSchema, studyIdParamSchema } from './study.schema';
import { parseWithSchema } from '../../shared/utils/validation';

export class StudyController {
    private studyService: StudyService;

    constructor() {
        this.studyService = new StudyService();
    }

    startSession = async (req: FastifyRequest, reply: FastifyReply) => {
        const payload = parseWithSchema(startStudySessionSchema, req.body, 'Invalid study session start request');
        const userId = (req.user as { userId: number }).userId;

        const result = await this.studyService.startStudySession(userId, payload);

        return reply.status(201).send({
            success: true,
            data: result
        });
    };

    completeSession = async (req: FastifyRequest, reply: FastifyReply) => {
        const params = parseWithSchema(studyIdParamSchema, req.params, 'Invalid study session ID');
        const payload = parseWithSchema(completeStudySessionSchema, req.body, 'Invalid study completion payload');
        const userId = (req.user as { userId: number }).userId;

        const result = await this.studyService.completeStudySession(userId, params.examId, payload);

        return reply.status(200).send({
            success: true,
            data: result
        });
    };
}

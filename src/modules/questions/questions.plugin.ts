import { FastifyInstance } from 'fastify';
import { questionsRoutes } from './questions.routes';

async function questionsPlugin(app: FastifyInstance) {
    // Question routes (mount point: /api/questions via app.ts)
    await app.register(questionsRoutes, { prefix: '/questions' });
    app.log.info('Questions module registered');
}

export default questionsPlugin;

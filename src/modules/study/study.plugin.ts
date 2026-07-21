import { FastifyInstance } from 'fastify';
import { studyRoutes } from './study.routes';

export async function studyPlugin(app: FastifyInstance) {
    await app.register(studyRoutes, { prefix: '/study' });
    app.log.info('Study Mode module registered');
}
export default studyPlugin;

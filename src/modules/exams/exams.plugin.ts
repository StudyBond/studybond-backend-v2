// Registers exam routes under /exams; final mount is at /api in app.ts

import { FastifyInstance } from 'fastify';
import { examsRoutes } from './exams.routes';

export async function examsPlugin(app: FastifyInstance) {
    await app.register(examsRoutes, { prefix: '/exams' });

    app.log.info('Exams module registered');
}

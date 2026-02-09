// ============================================
// EXAMS PLUGIN
// ============================================
// Fastify plugin registration for exams module
// Registers all exam routes under /api/exams

import { FastifyInstance } from 'fastify';
import { examsRoutes } from './exams.routes';

export async function examsPlugin(app: FastifyInstance) {
    // Register exam routes with prefix
    await app.register(examsRoutes, { prefix: '/api/exams' });

    app.log.info('✅ Exams module registered');
}

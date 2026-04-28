import { FastifyInstance } from 'fastify';
import { adminRoutes } from './admin.routes';

export default async function adminPlugin(app: FastifyInstance) {
    // Final mount happens in app.ts at /api/admin
    await app.register(adminRoutes, { prefix: '/admin' });
    app.log.info('Admin module registered');
}

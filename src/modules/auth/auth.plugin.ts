import { FastifyInstance } from 'fastify';
import { authRoutes } from './auth.routes';

export default async function authPlugin(app: FastifyInstance) {
    // Final mount happens in app.ts at /api/auth
    await app.register(authRoutes);
    app.log.info('Auth module registered');
}

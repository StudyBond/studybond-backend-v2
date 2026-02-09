import { FastifyInstance } from 'fastify';
import { authRoutes } from './auth.routes';

export async function authPlugin(app: FastifyInstance) {
  // The prefix '/api/auth' is usually set in app.ts when registering this plugin
  await app.register(authRoutes);

  app.log.info('✅ Auth module registered');
}
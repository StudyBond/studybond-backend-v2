import { FastifyInstance } from 'fastify';
import { streaksRoutes } from './streaks.routes';

export default async function streaksPlugin(app: FastifyInstance) {
  await app.register(streaksRoutes, { prefix: '/streaks' });
  app.log.info('Streaks module registered');
}

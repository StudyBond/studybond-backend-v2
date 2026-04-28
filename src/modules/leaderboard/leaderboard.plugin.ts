import { FastifyInstance } from 'fastify';
import { leaderboardRoutes } from './leaderboard.routes';

async function leaderboardPlugin(app: FastifyInstance) {
  await app.register(leaderboardRoutes, { prefix: '/leaderboard' });
  app.log.info('Leaderboard module registered');
}

export default leaderboardPlugin;

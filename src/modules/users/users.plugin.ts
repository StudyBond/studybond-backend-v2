import { FastifyInstance } from 'fastify';
import { usersRoutes } from './users.routes';

export default async function usersPlugin(app: FastifyInstance) {
  await app.register(usersRoutes, { prefix: '/users' });
  app.log.info('Users module registered');
}

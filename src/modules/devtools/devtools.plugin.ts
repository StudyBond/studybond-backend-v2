import { FastifyInstance } from 'fastify';
import { devToolsRoutes } from './devtools.routes';

export default async function devToolsPlugin(app: FastifyInstance) {
  await devToolsRoutes(app);
  app.log.info('Dev tools module registered');
}

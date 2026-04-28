import { FastifyInstance } from 'fastify';
import { adminReportsRoutes, userReportsRoutes } from './reports.routes';

export default async function reportsPlugin(app: FastifyInstance) {
  await app.register(userReportsRoutes, { prefix: '/reports' });
  await app.register(adminReportsRoutes, { prefix: '/admin/reports' });
  app.log.info('Reports module registered');
}

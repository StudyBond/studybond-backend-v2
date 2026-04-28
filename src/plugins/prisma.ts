import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import prisma, { connectDatabase } from '../config/database';

async function prismaPlugin(app: FastifyInstance) {
  if (process.env.OPENAPI_EXPORT_MODE === 'true') {
    app.decorate('prisma', prisma);
    app.log.info('Skipping database connection in OpenAPI export mode');
    return;
  }

  try {
    await connectDatabase();
    app.decorate('prisma', prisma);
    app.log.info('Prisma client decorated on app instance');
  } catch (error) {
    app.log.error('Failed to connect to database');
    throw error;
  }
}

export default fp(prismaPlugin, {
  name: 'prisma-plugin'
});

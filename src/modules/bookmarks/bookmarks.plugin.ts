import { FastifyInstance } from 'fastify';
import { bookmarksRoutes } from './bookmarks.routes';

export default async function bookmarksPlugin(app: FastifyInstance) {
  await app.register(bookmarksRoutes, { prefix: '/bookmarks' });
  app.log.info('Bookmarks module registered');
}

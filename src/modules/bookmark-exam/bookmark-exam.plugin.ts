import { FastifyInstance } from 'fastify';
import { bookmarkExamRoutes } from './bookmark-exam.routes';

export default async function bookmarkExamPlugin(app: FastifyInstance) {
  await app.register(bookmarkExamRoutes, { prefix: '/bookmark-exam' });
  app.log.info('Bookmark Exam module registered');
}

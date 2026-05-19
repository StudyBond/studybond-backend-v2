import { FastifyInstance } from 'fastify';
import { authenticate } from '../../shared/decorators/authenticate';
import { bookmarkExamController } from './bookmark-exam.controller';

export async function bookmarkExamRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.post('/start', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute'
      }
    },
    schema: {
      tags: ['Bookmark Exam'],
      summary: 'Start a bookmark exam',
      description: 'Starts an exam using the user\'s bookmarked questions. Requires premium and at least 20 active bookmarks.',
      security: [{ bearerAuth: [] }]
    }
  }, bookmarkExamController.startBookmarkExam);
}

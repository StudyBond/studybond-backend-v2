import { FastifyRequest, FastifyReply } from 'fastify';
import { parseWithSchema } from '../../shared/utils/validation';
import { startBookmarkExamSchema } from './bookmark-exam.schema';
import { bookmarkExamService } from './bookmark-exam.service';

export class BookmarkExamController {
  startBookmarkExam = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req.user as { userId: number }).userId;
    const payload = parseWithSchema(
      startBookmarkExamSchema,
      req.body,
      'Invalid bookmark exam request'
    );

    const result = await bookmarkExamService.startBookmarkExam(
      userId,
      payload.subject
    );

    return reply.status(201).send({
      success: true,
      data: result
    });
  };
}

export const bookmarkExamController = new BookmarkExamController();

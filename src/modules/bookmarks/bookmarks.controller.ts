import { FastifyReply, FastifyRequest } from 'fastify';
import { parseWithSchema } from '../../shared/utils/validation';
import {
  bookmarkIdParamSchema,
  bookmarkQuerySchema,
  createBookmarkSchema,
  updateBookmarkSchema
} from './bookmarks.schema';
import { bookmarksService } from './bookmarks.service';

interface AuthenticatedRequestUser {
  userId: number;
}

export class BookmarksController {
  createBookmark = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const payload = parseWithSchema(createBookmarkSchema, req.body, 'Invalid bookmark payload');
    const data = await bookmarksService.createBookmark(userId, payload);

    return reply.status(201).send({
      success: true,
      data
    });
  };

  getBookmarks = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const query = parseWithSchema(bookmarkQuerySchema, req.query, 'Invalid bookmark query parameters');
    const data = await bookmarksService.getUserBookmarks(userId, query);

    return reply.status(200).send({
      success: true,
      data
    });
  };

  getBookmarkById = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const params = parseWithSchema(bookmarkIdParamSchema, req.params, 'Invalid bookmark id');
    const data = await bookmarksService.getBookmarkById(userId, params.bookmarkId);

    return reply.status(200).send({
      success: true,
      data
    });
  };

  updateBookmark = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const params = parseWithSchema(bookmarkIdParamSchema, req.params, 'Invalid bookmark id');
    const payload = parseWithSchema(updateBookmarkSchema, req.body, 'Invalid bookmark update payload');
    const data = await bookmarksService.updateBookmark(userId, params.bookmarkId, payload);

    return reply.status(200).send({
      success: true,
      data
    });
  };

  deleteBookmark = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const params = parseWithSchema(bookmarkIdParamSchema, req.params, 'Invalid bookmark id');
    const data = await bookmarksService.deleteBookmark(userId, params.bookmarkId);

    return reply.status(200).send({
      success: true,
      data
    });
  };
}

export const bookmarksController = new BookmarksController();

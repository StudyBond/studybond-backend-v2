import { FastifyInstance } from 'fastify';
import { authenticate } from '../../shared/decorators/authenticate';
import { bookmarksController } from './bookmarks.controller';
import {
  bookmarkIdParamSchema,
  bookmarkQuerySchema,
  createBookmarkSchema,
  updateBookmarkSchema
} from './bookmarks.schema';
import {
  bookmarkDeletedPayloadSchema,
  bookmarkSchema,
  bookmarkFullSchema,
  bookmarksListPayloadSchema
} from './bookmarks.openapi';
import { successEnvelopeSchema, withStandardErrorResponses } from '../../shared/openapi/responses';

export async function bookmarksRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.post('/', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 hour'
      }
    },
    schema: {
      tags: ['Bookmarks'],
      summary: 'Save a question to the authenticated user bookmark list',
      body: createBookmarkSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        201: successEnvelopeSchema(bookmarkSchema)
      })
    }
  }, bookmarksController.createBookmark);

  app.get('/', {
    config: {
      rateLimit: {
        max: 90,
        timeWindow: '1 minute'
      }
    },
    schema: {
      tags: ['Bookmarks'],
      summary: 'List active bookmarks for the authenticated user',
      querystring: bookmarkQuerySchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(bookmarksListPayloadSchema)
      })
    }
  }, bookmarksController.getBookmarks);

  app.get('/:bookmarkId', {
    config: {
      rateLimit: {
        max: 120,
        timeWindow: '1 minute'
      }
    },
    schema: {
      tags: ['Bookmarks'],
      summary: 'Get one bookmark owned by the authenticated user',
      params: bookmarkIdParamSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(bookmarkFullSchema)
      })
    }
  }, bookmarksController.getBookmarkById);

  app.patch('/:bookmarkId', {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 hour'
      }
    },
    schema: {
      tags: ['Bookmarks'],
      summary: 'Update bookmark notes',
      params: bookmarkIdParamSchema,
      body: updateBookmarkSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(bookmarkFullSchema)
      })
    }
  }, bookmarksController.updateBookmark);

  app.delete('/:bookmarkId', {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 hour'
      }
    },
    schema: {
      tags: ['Bookmarks'],
      summary: 'Remove one bookmark owned by the authenticated user',
      params: bookmarkIdParamSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(bookmarkDeletedPayloadSchema)
      })
    }
  }, bookmarksController.deleteBookmark);
}

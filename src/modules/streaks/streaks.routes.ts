import { FastifyInstance } from 'fastify';
import { authenticate } from '../../shared/decorators/authenticate';
import { streaksController } from './streaks.controller';
import { streakCalendarQuerySchema } from './streaks.schema';
import {
  streakCalendarPayloadSchema,
  streakSummaryPayloadSchema
} from './streaks.openapi';
import { successEnvelopeSchema, withStandardErrorResponses } from '../../shared/openapi/responses';

export async function streaksRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/', {
    config: {
      rateLimit: {
        max: 120,
        timeWindow: '1 minute'
      }
    },
    schema: {
      tags: ['Streaks'],
      summary: 'Get the authenticated user streak summary',
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(streakSummaryPayloadSchema)
      })
    }
  }, streaksController.getSummary);

  app.get('/calendar', {
    config: {
      rateLimit: {
        max: 120,
        timeWindow: '1 minute'
      }
    },
    schema: {
      tags: ['Streaks'],
      summary: 'Get the authenticated user streak calendar',
      querystring: streakCalendarQuerySchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(streakCalendarPayloadSchema)
      })
    }
  }, streaksController.getCalendar);
}

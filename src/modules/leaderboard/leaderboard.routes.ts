import { FastifyInstance } from 'fastify';
import { LeaderboardController } from './leaderboard.controller';
import { leaderboardQuerySchema } from './leaderboard.schema';
import { LeaderboardService } from './leaderboard.service';
import { leaderboardPayloadSchema, myRankPayloadSchema } from './leaderboard.openapi';
import { successEnvelopeSchema, withStandardErrorResponses } from '../../shared/openapi/responses';

export async function leaderboardRoutes(app: FastifyInstance) {
  const controller = new LeaderboardController(new LeaderboardService());

  app.get('/weekly', {
    preValidation: [app.authenticate],
    config: {
      rateLimit: {
        max: 1000,
        timeWindow: 15 * 60 * 1000
      }
    },
    schema: {
      tags: ['Leaderboard'],
      summary: 'Get weekly leaderboard',
      description: 'Returns top users ranked by weekly SP (resets weekly) inside the resolved institution scope.',
      querystring: leaderboardQuerySchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(leaderboardPayloadSchema)
      })
    }
  }, controller.getWeeklyLeaderboard);

  app.get('/all-time', {
    preValidation: [app.authenticate],
    config: {
      rateLimit: {
        max: 1000,
        timeWindow: 15 * 60 * 1000
      }
    },
    schema: {
      tags: ['Leaderboard'],
      summary: 'Get all-time leaderboard',
      description: 'Returns top users ranked by total SP across all time inside the resolved institution scope.',
      querystring: leaderboardQuerySchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(leaderboardPayloadSchema)
      })
    }
  }, controller.getAllTimeLeaderboard);

  app.get('/my-rank', {
    preValidation: [app.authenticate],
    config: {
      rateLimit: {
        max: 600,
        timeWindow: 15 * 60 * 1000
      }
    },
    schema: {
      tags: ['Leaderboard'],
      summary: 'Get my leaderboard rank',
      description: 'Returns the current user rank in both weekly and all-time ladders for the resolved institution scope.',
      querystring: leaderboardQuerySchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(myRankPayloadSchema)
      })
    }
  }, controller.getMyRank);
}

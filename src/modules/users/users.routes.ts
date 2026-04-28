import { FastifyInstance } from 'fastify';
import { authenticate } from '../../shared/decorators/authenticate';
import { usersController } from './users.controller';
import { changePasswordSchema, deleteAccountSchema, updateProfileSchema, userStatsQuerySchema } from './users.schema';
import {
  accountDeletedPayloadSchema,
  passwordChangedPayloadSchema,
  securityOverviewSchema,
  userAchievementSchema,
  userProfileSchema,
  userStatsSchema
} from './users.openapi';
import { successEnvelopeSchema, withStandardErrorResponses } from '../../shared/openapi/responses';

export async function usersRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/profile', {
    config: {
      rateLimit: {
        max: 120,
        timeWindow: '1 minute'
      }
    },
    schema: {
      tags: ['Users'],
      summary: 'Get the authenticated user profile',
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(userProfileSchema)
      })
    }
  }, usersController.getProfile);

  app.patch('/profile', {
    config: {
      rateLimit: {
        max: 40,
        timeWindow: '1 hour'
      }
    },
    schema: {
      tags: ['Users'],
      summary: 'Update the authenticated user profile',
      body: updateProfileSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(userProfileSchema)
      })
    }
  }, usersController.updateProfile);

  app.get('/stats', {
    config: {
      rateLimit: {
        max: 120,
        timeWindow: '1 minute'
      }
    },
    schema: {
      tags: ['Users'],
      summary: 'Get authenticated user study stats',
      querystring: userStatsQuerySchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(userStatsSchema)
      })
    }
  }, usersController.getStats);

  app.get('/achievements', {
    config: {
      rateLimit: {
        max: 120,
        timeWindow: '1 minute'
      }
    },
    schema: {
      tags: ['Users'],
      summary: 'Get authenticated user achievements and badge progress',
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(userAchievementSchema.array())
      })
    }
  }, usersController.getAchievements);

  app.get('/security', {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute'
      }
    },
    schema: {
      tags: ['Users'],
      summary: 'Get the authenticated user security overview with active sessions and registered premium devices',
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(securityOverviewSchema)
      })
    }
  }, usersController.getSecurityOverview);

  app.patch('/password', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 hour'
      }
    },
    schema: {
      tags: ['Users'],
      summary: 'Change the authenticated user password and sign out other active sessions',
      body: changePasswordSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(passwordChangedPayloadSchema)
      })
    }
  }, usersController.changePassword);

  app.delete('/account', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 hour'
      }
    },
    schema: {
      tags: ['Users'],
      summary: 'Delete the authenticated user account',
      body: deleteAccountSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(accountDeletedPayloadSchema)
      })
    }
  }, usersController.deleteAccount);
}

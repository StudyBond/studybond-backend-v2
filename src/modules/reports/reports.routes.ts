import { FastifyInstance } from 'fastify';
import { authenticate } from '../../shared/decorators/authenticate';
import { requireAdmin, requireSuperadmin } from '../../shared/decorators/requireAdmin';
import { reportsController } from './reports.controller';
import {
  adminReportQuerySchema,
  createReportSchema,
  hardDeleteReportSchema,
  reportIdParamSchema,
  reportQuerySchema,
  updateReportStatusSchema
} from './reports.schema';
import {
  adminReportSchema,
  adminReportsListPayloadSchema,
  reportDeletedPayloadSchema,
  userReportSchema,
  userReportsListPayloadSchema
} from './reports.openapi';
import { successEnvelopeSchema, withStandardErrorResponses } from '../../shared/openapi/responses';

export async function userReportsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.post('/', {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 hour'
      }
    },
    schema: {
      tags: ['Reports'],
      summary: 'Report a question issue',
      body: createReportSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        201: successEnvelopeSchema(userReportSchema)
      })
    }
  }, reportsController.createReport);

  app.get('/', {
    config: {
      rateLimit: {
        max: 90,
        timeWindow: '1 minute'
      }
    },
    schema: {
      tags: ['Reports'],
      summary: 'List reports created by the authenticated user',
      querystring: reportQuerySchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(userReportsListPayloadSchema)
      })
    }
  }, reportsController.getUserReports);

  app.get('/:reportId', {
    config: {
      rateLimit: {
        max: 120,
        timeWindow: '1 minute'
      }
    },
    schema: {
      tags: ['Reports'],
      summary: 'Get one report owned by the authenticated user',
      params: reportIdParamSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(userReportSchema)
      })
    }
  }, reportsController.getUserReportById);

  app.delete('/:reportId', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 hour'
      }
    },
    schema: {
      tags: ['Reports'],
      summary: 'Delete one pending report owned by the authenticated user',
      params: reportIdParamSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(reportDeletedPayloadSchema)
      })
    }
  }, reportsController.deleteUserReport);
}

export async function adminReportsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/', {
    preHandler: requireAdmin,
    config: {
      rateLimit: {
        max: 120,
        timeWindow: '1 minute'
      }
    },
    schema: {
      tags: ['Admin Reports'],
      summary: 'List reports for the admin moderation queue',
      querystring: adminReportQuerySchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(adminReportsListPayloadSchema)
      })
    }
  }, reportsController.listAdminReports);

  app.get('/:reportId', {
    preHandler: requireAdmin,
    config: {
      rateLimit: {
        max: 120,
        timeWindow: '1 minute'
      }
    },
    schema: {
      tags: ['Admin Reports'],
      summary: 'Get one report for moderation',
      params: reportIdParamSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(adminReportSchema)
      })
    }
  }, reportsController.getAdminReportById);

  app.patch('/:reportId/status', {
    preHandler: requireAdmin,
    config: {
      rateLimit: {
        max: 40,
        timeWindow: '1 hour'
      }
    },
    schema: {
      tags: ['Admin Reports'],
      summary: 'Review or resolve a report',
      params: reportIdParamSchema,
      body: updateReportStatusSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(adminReportSchema)
      })
    }
  }, reportsController.updateAdminReportStatus);

  app.delete('/:reportId/hard-delete', {
    preHandler: requireSuperadmin,
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 hour'
      }
    },
    schema: {
      tags: ['Admin Reports'],
      summary: 'Permanently delete a report',
      params: reportIdParamSchema,
      body: hardDeleteReportSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(reportDeletedPayloadSchema)
      })
    }
  }, reportsController.hardDeleteAdminReport);
}

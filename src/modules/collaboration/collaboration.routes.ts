import { FastifyInstance } from 'fastify';
import { CollaborationController } from './collaboration.controller';
import {
  codeParamSchema,
  createSessionBodySchema,
  idempotencyHeadersSchema,
  sessionIdParamSchema,
  updateSessionNameBodySchema,
  wsAuthQuerySchema
} from './collaboration.schema';
import { CollaborationService } from './collaboration.service';
import { CollaborationWebSocketHandlers } from './websocket-handlers';
import {
  successEnvelopeSchema,
  withStandardErrorResponses
} from '../../shared/openapi/responses';
import {
  collaborationSessionSnapshotSchema,
  collaborationStartSessionSchema
} from './collaboration.openapi';

interface CollaborationRoutesOptions {
  collaborationService: CollaborationService;
  wsHandlers: CollaborationWebSocketHandlers;
}

export async function collaborationRoutes(
  app: FastifyInstance,
  options: CollaborationRoutesOptions
) {
  const controller = new CollaborationController(options.collaborationService);

  app.post('/create', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Collaboration'],
      summary: 'Create a collaboration session',
      description: 'Creates a new 1v1 collaboration room and returns its session snapshot.',
      headers: idempotencyHeadersSchema,
      body: createSessionBodySchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        201: successEnvelopeSchema(collaborationSessionSnapshotSchema)
      })
    }
  }, controller.createSession);

  app.get('/code/:code', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Collaboration'],
      summary: 'Get session by code',
      description: 'Fetches a collaboration session snapshot using a room code.',
      params: codeParamSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(collaborationSessionSnapshotSchema)
      })
    }
  }, controller.getSessionByCode);

  // Backward-compatible alias.
  app.get('/:code', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Collaboration'],
      summary: 'Get session by code (alias)',
      description: 'Alias of /code/:code for legacy client compatibility.',
      params: codeParamSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(collaborationSessionSnapshotSchema)
      })
    }
  }, controller.getSessionByCode);

  app.post('/code/:code/join', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Collaboration'],
      summary: 'Join collaboration session',
      description: 'Joins a waiting 1v1 room by code.',
      headers: idempotencyHeadersSchema,
      params: codeParamSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(collaborationSessionSnapshotSchema)
      })
    }
  }, controller.joinSession);

  // Backward-compatible alias.
  app.post('/:code/join', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Collaboration'],
      summary: 'Join collaboration session (alias)',
      description: 'Alias of /code/:code/join for legacy client compatibility.',
      headers: idempotencyHeadersSchema,
      params: codeParamSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(collaborationSessionSnapshotSchema)
      })
    }
  }, controller.joinSession);

  app.post('/sessions/:sessionId/start', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Collaboration'],
      summary: 'Start collaboration session',
      description: 'Host starts a waiting 1v1 session. Both participants receive the same question set.',
      headers: idempotencyHeadersSchema,
      params: sessionIdParamSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(collaborationStartSessionSchema)
      })
    }
  }, controller.startSession);

  app.get('/sessions/:sessionId', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Collaboration'],
      summary: 'Get collaboration session by id',
      description: 'Returns the full collaboration session snapshot for participants.',
      params: sessionIdParamSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(collaborationSessionSnapshotSchema)
      })
    }
  }, controller.getSessionById);

  app.post('/sessions/:sessionId/leave', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Collaboration'],
      summary: 'Leave collaboration session',
      description: 'Leaves a collaboration session. If host leaves while waiting, the session is cancelled.',
      headers: idempotencyHeadersSchema,
      params: sessionIdParamSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(collaborationSessionSnapshotSchema)
      })
    }
  }, controller.leaveSession);

  app.post('/sessions/:sessionId/cancel', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Collaboration'],
      summary: 'Cancel collaboration session',
      description: 'Host-only cancellation for waiting or in-progress collaboration sessions.',
      headers: idempotencyHeadersSchema,
      params: sessionIdParamSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(collaborationSessionSnapshotSchema)
      })
    }
  }, controller.cancelSession);

  app.patch('/sessions/:sessionId/name', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Collaboration'],
      summary: 'Update collaboration session custom name',
      description: 'Host-only while waiting. Set customName to null to reset to default generated name.',
      headers: idempotencyHeadersSchema,
      params: sessionIdParamSchema,
      body: updateSessionNameBodySchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(collaborationSessionSnapshotSchema)
      })
    }
  }, controller.updateSessionName);

  app.get('/sessions/:sessionId/ws', {
    websocket: true,
    schema: {
      hide: true,
      params: sessionIdParamSchema,
      querystring: wsAuthQuerySchema
    }
  }, options.wsHandlers.handleConnection as any);
}

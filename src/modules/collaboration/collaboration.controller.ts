import { FastifyReply, FastifyRequest } from 'fastify';
import { parseWithSchema } from '../../shared/utils/validation';
import {
  codeParamSchema,
  createSessionBodySchema,
  idempotencyHeadersSchema,
  sessionIdParamSchema,
  updateSessionNameBodySchema
} from './collaboration.schema';
import { CollaborationService } from './collaboration.service';
import { resolveIdempotencyKey } from '../../shared/idempotency/idempotency';

interface AuthenticatedRequestUser {
  userId: number;
}

export class CollaborationController {
  private readonly collaborationService: CollaborationService;

  constructor(collaborationService: CollaborationService) {
    this.collaborationService = collaborationService;
  }

  createSession = async (req: FastifyRequest, reply: FastifyReply) => {
    const payload = parseWithSchema(createSessionBodySchema, req.body, 'Invalid collaboration session payload');
    const headers = parseWithSchema(idempotencyHeadersSchema, req.headers, 'Missing or invalid Idempotency-Key header');
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const idempotencyKey = resolveIdempotencyKey(headers['idempotency-key'], 'collab_create');

    const result = await this.collaborationService.createSession(
      userId,
      {
        sessionType: payload.sessionType,
        institutionCode: payload.institutionCode,
        subjects: payload.subjects,
        questionSource: payload.questionSource,
        maxParticipants: payload.maxParticipants,
        customName: payload.customName
      },
      idempotencyKey
    );

    return reply.status(201).send({
      success: true,
      data: result
    });
  };

  getSessionByCode = async (req: FastifyRequest, reply: FastifyReply) => {
    const params = parseWithSchema(codeParamSchema, req.params, 'Invalid session code');
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const result = await this.collaborationService.getSessionByCode(params.code, userId);
    return reply.status(200).send({
      success: true,
      data: result
    });
  };

  joinSession = async (req: FastifyRequest, reply: FastifyReply) => {
    const params = parseWithSchema(codeParamSchema, req.params, 'Invalid session code');
    const headers = parseWithSchema(idempotencyHeadersSchema, req.headers, 'Missing or invalid Idempotency-Key header');
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const idempotencyKey = resolveIdempotencyKey(headers['idempotency-key'], `collab_join_${params.code}`);

    const result = await this.collaborationService.joinSession(
      userId,
      params.code,
      idempotencyKey
    );

    return reply.status(200).send({
      success: true,
      data: result
    });
  };

  startSession = async (req: FastifyRequest, reply: FastifyReply) => {
    const params = parseWithSchema(sessionIdParamSchema, req.params, 'Invalid session id');
    const headers = parseWithSchema(idempotencyHeadersSchema, req.headers, 'Missing or invalid Idempotency-Key header');
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const idempotencyKey = resolveIdempotencyKey(headers['idempotency-key'], `collab_start_${params.sessionId}`);

    const result = await this.collaborationService.startSession(
      userId,
      params.sessionId,
      idempotencyKey
    );

    return reply.status(200).send({
      success: true,
      data: result
    });
  };

  getSessionById = async (req: FastifyRequest, reply: FastifyReply) => {
    const params = parseWithSchema(sessionIdParamSchema, req.params, 'Invalid session id');
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const result = await this.collaborationService.getSessionById(params.sessionId, userId);
    return reply.status(200).send({
      success: true,
      data: result
    });
  };

  leaveSession = async (req: FastifyRequest, reply: FastifyReply) => {
    const params = parseWithSchema(sessionIdParamSchema, req.params, 'Invalid session id');
    const headers = parseWithSchema(idempotencyHeadersSchema, req.headers, 'Missing or invalid Idempotency-Key header');
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const idempotencyKey = resolveIdempotencyKey(headers['idempotency-key'], `collab_leave_${params.sessionId}`);

    const result = await this.collaborationService.leaveSession(
      userId,
      params.sessionId,
      idempotencyKey
    );

    return reply.status(200).send({
      success: true,
      data: result
    });
  };

  cancelSession = async (req: FastifyRequest, reply: FastifyReply) => {
    const params = parseWithSchema(sessionIdParamSchema, req.params, 'Invalid session id');
    const headers = parseWithSchema(idempotencyHeadersSchema, req.headers, 'Missing or invalid Idempotency-Key header');
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const idempotencyKey = resolveIdempotencyKey(headers['idempotency-key'], `collab_cancel_${params.sessionId}`);

    const result = await this.collaborationService.cancelSession(
      userId,
      params.sessionId,
      idempotencyKey
    );

    return reply.status(200).send({
      success: true,
      data: result
    });
  };

  updateSessionName = async (req: FastifyRequest, reply: FastifyReply) => {
    const params = parseWithSchema(sessionIdParamSchema, req.params, 'Invalid session id');
    const headers = parseWithSchema(idempotencyHeadersSchema, req.headers, 'Missing or invalid Idempotency-Key header');
    const payload = parseWithSchema(updateSessionNameBodySchema, req.body, 'Invalid custom session name');
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const idempotencyKey = resolveIdempotencyKey(headers['idempotency-key'], `collab_rename_${params.sessionId}`);

    const result = await this.collaborationService.updateSessionName(
      userId,
      params.sessionId,
      payload.customName,
      idempotencyKey
    );

    return reply.status(200).send({
      success: true,
      data: result
    });
  };
}

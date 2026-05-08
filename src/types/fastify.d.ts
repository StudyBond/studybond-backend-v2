import { FastifyRequest, FastifyReply } from 'fastify';
import { JWT } from '@fastify/jwt';
import { MetricsRegistry } from '../shared/metrics/registry';
import type { CollaborationService } from '../modules/collaboration/collaboration.service';

interface JwtUserPayload {
  userId: number;
  email: string;
  role: string;
  sessionId: string;
  deviceId: string;
  tokenVersion?: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    cache?: {
      available: boolean;
      client: any;
    };
    metrics: MetricsRegistry;
    collaborationService?: CollaborationService;
  }

  interface FastifyRequest {
    jwt: JWT;
    user: JwtUserPayload;
    correlationId?: string;
  }
}

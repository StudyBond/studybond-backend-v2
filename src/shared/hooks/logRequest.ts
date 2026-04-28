import { FastifyReply, FastifyRequest } from 'fastify';

export async function logRequest(request: FastifyRequest, _reply: FastifyReply) {
  request.log.info({
    requestId: request.id,
    correlationId: request.correlationId ?? request.id,
    method: request.method,
    url: request.url,
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  }, 'Incoming request');
}

export async function logResponse(request: FastifyRequest, reply: FastifyReply) {
  const routeTemplate = (request.routeOptions as any)?.url || request.url.split('?')[0];
  request.log.info({
    requestId: request.id,
    correlationId: request.correlationId ?? request.id,
    method: request.method,
    routeTemplate,
    statusCode: reply.statusCode,
    responseTime: reply.elapsedTime,
  }, 'Request completed');
}

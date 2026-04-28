import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { formatClientError } from '../shared/utils/formatters';

async function errorHandlerPlugin(app: FastifyInstance) {
  app.setErrorHandler((error: any, req, reply) => {
    req.log.error({
      requestId: req.id,
      correlationId: (req as any).correlationId || req.id,
      error: {
        message: error.message,
        stack: error.stack,
        code: error.code,
      },
      request: {
        method: req.method,
        url: req.url,
        params: req.params,
        query: req.query,
      },
    }, 'Request error');

    const statusCode = error.statusCode || 500;
    const formatted = formatClientError(error, statusCode);

    return reply.status(statusCode).send({
      success: false,
      error: {
        message: formatted.message,
        statusCode,
        code: formatted.code,
        hint: formatted.hint,
        ...(error.details && { details: error.details }),
        ...(process.env.NODE_ENV === 'development' && {
          stack: error.stack
        }),
      },
      requestId: req.id,
      correlationId: (req as any).correlationId || req.id,
      timestamp: new Date().toISOString(),
    });
  });

  app.setNotFoundHandler((req, reply) => {
    req.log.warn({
      method: req.method,
      url: req.url,
    }, 'Route not found');

    return reply.status(404).send({
      success: false,
      error: {
        message: `Route ${req.method} ${req.url} was not found.`,
        statusCode: 404,
        code: 'ROUTE_NOT_FOUND',
        hint: 'Check the endpoint path and HTTP method, then try again.'
      },
      requestId: req.id,
      correlationId: (req as any).correlationId || req.id,
      timestamp: new Date().toISOString(),
    });
  });
}

export default fp(errorHandlerPlugin, {
  name: 'error-handler-plugin'
});

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { MetricsRegistry } from '../shared/metrics/registry';
import { setGlobalMetricsRegistry } from '../shared/metrics/global';

function normalizeRouteTemplate(request: FastifyRequest): string {
  const routeTemplate = (request.routeOptions as any)?.url as string | undefined;
  if (routeTemplate && routeTemplate.length > 0) return routeTemplate;
  return request.url.split('?')[0] || 'unknown';
}

function getCorrelationId(request: FastifyRequest): string {
  const rawHeader = request.headers['x-correlation-id'];
  if (typeof rawHeader === 'string' && rawHeader.trim().length > 0) {
    return rawHeader.trim();
  }
  return request.id;
}

async function metricsPlugin(app: FastifyInstance) {
  const metrics = new MetricsRegistry();
  app.decorate('metrics', metrics);
  setGlobalMetricsRegistry(metrics);

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const startedAt = process.hrtime.bigint();
    const correlationId = getCorrelationId(request);
    (request as any).__metricsStartedAt = startedAt;
    (request as any).correlationId = correlationId;

    reply.header('x-request-id', request.id);
    reply.header('x-correlation-id', correlationId);
  });

  app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const startedAt = (request as any).__metricsStartedAt as bigint | undefined;
    if (!startedAt) return;

    const elapsedNs = process.hrtime.bigint() - startedAt;
    const elapsedMs = Number(elapsedNs) / 1_000_000;
    const route = normalizeRouteTemplate(request);
    const method = request.method;
    const statusClass = `${Math.floor(reply.statusCode / 100)}xx`;

    metrics.incrementCounter('http_requests_total', 1, { method, route, statusClass });
    metrics.observeHistogram('http_request_duration_ms', elapsedMs, { method, route, statusClass });
  });

  app.get('/internal/metrics', {
    schema: {
      hide: true
    }
  }, async (request, reply) => {
    const token = process.env.METRICS_TOKEN;
    if (token) {
      const provided = request.headers['x-metrics-token'];
      if (provided !== token) {
        return reply.status(403).send({
          success: false,
          error: {
            message: 'Forbidden',
            statusCode: 403,
            code: 'FORBIDDEN'
          }
        });
      }
    } else if (process.env.NODE_ENV === 'production') {
      return reply.status(403).send({
        success: false,
        error: {
          message: 'Metrics endpoint is disabled until METRICS_TOKEN is configured.',
          statusCode: 403,
          code: 'FORBIDDEN'
        }
      });
    }

    reply.header('content-type', 'text/plain; version=0.0.4');
    return reply.send(metrics.toPrometheus());
  });
}

export default fp(metricsPlugin, {
  name: 'metrics-plugin'
});

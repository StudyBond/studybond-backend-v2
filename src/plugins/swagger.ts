import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { createJsonSchemaTransform } from 'fastify-type-provider-zod';

async function swaggerPlugin(app: FastifyInstance) {
  const enabled =
    process.env.SWAGGER_ENABLED === 'true' ||
    (process.env.SWAGGER_ENABLED !== 'false' && process.env.NODE_ENV !== 'production');

  if (!enabled) {
    return;
  }

  const swagger = await import('@fastify/swagger');
  const swaggerUi = await import('@fastify/swagger-ui');

  const serverUrl =
    process.env.PUBLIC_API_BASE_URL ||
    process.env.API_BASE_URL ||
    'http://localhost:5000';

  await app.register(swagger.default, {
    openapi: {
      info: {
        title: 'StudyBond API',
        description: 'StudyBond backend API reference for web, mobile, admin, and internal engineering workflows.',
        version: '1.0.0'
      },
      servers: [
        {
          url: serverUrl,
          description: process.env.NODE_ENV === 'production' ? 'Production' : 'Local development'
        }
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Paste the StudyBond access token as `Bearer <token>`.'
          }
        }
      },
      tags: [
        { name: 'Auth', description: 'Account registration, login, verification, token refresh, and password recovery.' },
        { name: 'Users', description: 'Authenticated user profile, security, and account settings.' },
        { name: 'Exams', description: 'Exam lifecycle endpoints including start, submit, history, retake, and abandon.' },
        { name: 'Collaboration', description: '1v1 collaboration session lifecycle and realtime session bootstrapping.' },
        { name: 'Leaderboard', description: 'Weekly, all-time, and self-rank leaderboard reads.' },
        { name: 'Subscriptions', description: 'Premium plan checkout, verification, cancellation, and webhook handling.' },
        { name: 'Admin', description: 'Operational admin command-center endpoints.' },
        { name: 'Bookmarks', description: 'User bookmark creation, updates, retrieval, and deletion.' },
        { name: 'Reports', description: 'Question issue reporting by learners.' },
        { name: 'Admin Reports', description: 'Admin moderation queue for question reports.' },
        { name: 'Questions', description: 'Admin-managed question bank CRUD and bulk upload.' },
        { name: 'Streaks', description: 'Streak summary and streak calendar endpoints.' },
        { name: 'System', description: 'Operational and health endpoints.' }
      ]
    },
    transform: createJsonSchemaTransform({
      skipList: ['/api/docs', '/api/docs/json', '/api/docs/yaml']
    })
  });

  await app.register(swaggerUi.default, {
    routePrefix: '/api/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      displayRequestDuration: true,
      persistAuthorization: true
    },
    staticCSP: true,
    transformStaticCSP: (header) => header
  });

  app.get('/api/openapi.json', {
    schema: {
      hide: true
    }
  }, async () => app.swagger());
}

export default fp(swaggerPlugin, {
  name: 'swagger-plugin'
});

import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import fastifyCors from '@fastify/cors';

async function corsPlugin(app: FastifyInstance) {
  await app.register(fastifyCors, {
    origin: (origin, callback) => {
      if (process.env.NODE_ENV === 'development') {
        callback(null, true);
        return;
      }

      const allowedOrigins = process.env.CORS_ORIGIN?.split(',') || [];
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'), false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  });
}

export default fp(corsPlugin, {
  name: 'cors-plugin'
});

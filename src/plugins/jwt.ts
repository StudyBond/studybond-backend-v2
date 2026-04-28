import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import { validateToken } from '../shared/hooks/validateToken';

async function jwtPlugin(app: FastifyInstance) {
  await app.register(fastifyJwt, {
    secret: process.env.JWT_SECRET!,
    sign: {
      expiresIn: process.env.JWT_EXPIRY || '15m',
    },
  });

  app.decorate('authenticate', async (request: any, _reply: any) => {
    await validateToken(request);
  });
}

export default fp(jwtPlugin, {
  name: 'jwt-plugin'
});

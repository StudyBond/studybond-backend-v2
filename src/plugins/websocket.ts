import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import fastifyWebsocket from '@fastify/websocket';

async function websocketPlugin(app: FastifyInstance) {
  await app.register(fastifyWebsocket, {
    options: {
      maxPayload: Number.parseInt(process.env.WS_MAX_PAYLOAD_BYTES || '65536', 10)
    }
  });

  app.log.info('WebSocket plugin registered successfully');
}

export default fp(websocketPlugin, {
  name: 'websocket-plugin'
});

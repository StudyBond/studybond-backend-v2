import { FastifyInstance } from 'fastify';
import { collaborationRoutes } from './collaboration.routes';
import { CollaborationService } from './collaboration.service';
import { SessionManager } from './session-manager';
import { CollaborationWebSocketHandlers } from './websocket-handlers';

export async function collaborationPlugin(app: FastifyInstance) {
  const sessionManager = new SessionManager(app);
  const collaborationService = new CollaborationService(app, sessionManager);
  const wsHandlers = new CollaborationWebSocketHandlers(app, collaborationService, sessionManager);

  await app.register(collaborationRoutes as any, {
    prefix: '/collaboration',
    collaborationService,
    wsHandlers
  });

  app.addHook('onClose', async () => {
    await sessionManager.close();
  });

  app.log.info('Collaboration module registered (v1 1v1 ready)');
}

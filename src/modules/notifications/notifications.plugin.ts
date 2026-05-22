import { FastifyInstance } from "fastify";
import { notificationsRoutes } from "./notifications.routes";
import { NotificationsWebSocketHandlers } from "./notifications.websocket";

export async function notificationsPlugin(app: FastifyInstance) {
  const wsHandler = new NotificationsWebSocketHandlers(app);

  await app.register(notificationsRoutes as any, {
    wsHandler: wsHandler.handleConnection,
  });

  app.log.info("Notifications module registered");
}

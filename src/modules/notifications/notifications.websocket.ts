import { FastifyInstance, FastifyRequest } from "fastify";
import { AuthError } from "../../shared/errors/AuthError";
import { validateToken } from "../../shared/hooks/validateToken";
import { parseWithSchema } from "../../shared/utils/validation";
import { notificationsRealtimeHub } from "./notifications.realtime";
import { notificationsWsAuthQuerySchema } from "./notifications.schema";
import { notificationsService } from "./notifications.service";

interface WsConnection {
  socket: any;
}

export class NotificationsWebSocketHandlers {
  constructor(private readonly app: FastifyInstance) {}

  private extractToken(req: FastifyRequest): string {
    const query = parseWithSchema(
      notificationsWsAuthQuerySchema,
      req.query ?? {},
      "Invalid WebSocket auth query."
    );

    if (query.token) {
      return query.token;
    }

    const authorization = req.headers.authorization;
    if (!authorization) {
      throw new AuthError(
        "WebSocket authentication token is missing.",
        401,
        "SESSION_INVALID"
      );
    }

    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      throw new AuthError(
        "WebSocket token format is invalid. Use Bearer <token>.",
        401,
        "SESSION_INVALID"
      );
    }

    return match[1];
  }

  handleConnection = async (connection: WsConnection, req: FastifyRequest) => {
    const socket = connection.socket;
    let userId: number | null = null;

    const reject = (statusCode: number, code: string, message: string) => {
      try {
        socket.send(
          JSON.stringify({
            type: "notification.error",
            payload: { statusCode, code, message },
            createdAt: new Date().toISOString(),
          })
        );
      } catch {
        // ignore
      }
      socket.close(
        statusCode === 401 ? 4401 : statusCode === 403 ? 4403 : 4400,
        message
      );
    };

    try {
      notificationsService.assertWsEnabled();
      const token = this.extractToken(req);
      if (!req.headers.authorization) {
        (req.headers as Record<string, unknown>).authorization = `Bearer ${token}`;
      }

      await validateToken(req);
      const authUser = req.user as { userId?: number } | undefined;
      if (!authUser?.userId) {
        throw new AuthError(
          "WebSocket session is invalid or expired. Please reconnect.",
          401,
          "SESSION_INVALID"
        );
      }

      userId = authUser.userId;
      notificationsRealtimeHub.subscribe(userId, socket);
      const summary = await notificationsService.getSummary(
        userId,
        {},
        { skipReadGuard: true }
      );
      notificationsRealtimeHub.publishSummary(userId, summary);
    } catch (error: any) {
      reject(
        error?.statusCode || 4401,
        error?.code || "WS_AUTH_FAILED",
        error?.message || "WebSocket connection rejected."
      );
      return;
    }

    socket.on("message", () => {
      try {
        socket.send(
          JSON.stringify({
            type: "notification.ack",
            payload: { ok: true },
            createdAt: new Date().toISOString(),
          })
        );
      } catch {
        // ignore
      }
    });

    socket.on("close", () => {
      if (userId != null) {
        notificationsRealtimeHub.unsubscribe(userId, socket);
      }
    });

    socket.on("error", (error: Error) => {
      this.app.log.warn({ error, userId }, "Notifications socket error");
    });
  };
}

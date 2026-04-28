import { FastifyInstance, FastifyRequest } from 'fastify';
import { parseWithSchema } from '../../shared/utils/validation';
import { AppError } from '../../shared/errors/AppError';
import { AuthError } from '../../shared/errors/AuthError';
import { ValidationError } from '../../shared/errors/ValidationError';
import { COLLAB_LIMITS, COLLAB_WEBSOCKET_EVENTS } from './collaboration.constants';
import { sessionIdParamSchema, wsAuthQuerySchema, wsClientEventSchema } from './collaboration.schema';
import { CollaborationService } from './collaboration.service';
import { SessionManager } from './session-manager';
import { validateToken } from '../../shared/hooks/validateToken';

interface WsConnection {
  socket: any;
}

interface WsAuthedContext {
  sessionId: number;
  userId: number;
}

interface ConnectionLease {
  key: string;
  owner: string;
}

export class CollaborationWebSocketHandlers {
  private readonly app: FastifyInstance;
  private readonly collaborationService: CollaborationService;
  private readonly sessionManager: SessionManager;
  private readonly outboundQueues = new Map<any, string[]>();
  private readonly flushingSockets = new Set<any>();
  private readonly ownerLeases = new Map<any, ConnectionLease>();
  private readonly ownerRefreshTimers = new Map<any, NodeJS.Timeout>();
  private readonly localSocketByConnectionKey = new Map<string, any>();
  private totalQueuedMessages = 0;

  private static readonly WS_OWNER_TTL_SECONDS = Number.parseInt(
    process.env.WS_OWNER_TTL_SECONDS || '75',
    10
  );

  private static readonly WS_OWNER_REFRESH_SECONDS = Number.parseInt(
    process.env.WS_OWNER_REFRESH_SECONDS || '25',
    10
  );

  private static readonly WS_SLOW_CONSUMER_MAX_QUEUE = Number.parseInt(
    process.env.WS_SLOW_CONSUMER_MAX_QUEUE || '128',
    10
  );

  private static readonly WS_SLOW_CONSUMER_DISCONNECT_THRESHOLD = Number.parseInt(
    process.env.WS_SLOW_CONSUMER_DISCONNECT_THRESHOLD || '256',
    10
  );

  private static readonly WS_BUFFERED_AMOUNT_SOFT_LIMIT = Number.parseInt(
    process.env.WS_BUFFERED_AMOUNT_SOFT_LIMIT || '262144',
    10
  );

  constructor(
    app: FastifyInstance,
    collaborationService: CollaborationService,
    sessionManager: SessionManager
  ) {
    this.app = app;
    this.collaborationService = collaborationService;
    this.sessionManager = sessionManager;
  }

  private safeSend(socket: any, payload: Record<string, unknown>): void {
    if (!socket || socket.readyState !== 1) return;
    socket.send(JSON.stringify(payload));
  }

  private enqueueOutbound(socket: any, payload: Record<string, unknown>, eventType: string, critical = false): void {
    if (!socket || socket.readyState !== 1) return;

    const queue = this.outboundQueues.get(socket) ?? [];
    const serialized = JSON.stringify(payload);

    if (queue.length >= CollaborationWebSocketHandlers.WS_SLOW_CONSUMER_MAX_QUEUE && !critical) {
      this.app.metrics.incrementCounter('ws_outbound_queue_dropped_total', 1, { eventType });
      if (queue.length >= CollaborationWebSocketHandlers.WS_SLOW_CONSUMER_DISCONNECT_THRESHOLD) {
        this.safeSend(socket, {
          type: COLLAB_WEBSOCKET_EVENTS.SERVER_ERROR,
          payload: {
            code: 'WS_SLOW_CONSUMER',
            message: 'Connection is too slow to keep up with realtime updates.'
          }
        });
        socket.close(4413, 'Slow consumer');
      }
      return;
    }

    queue.push(serialized);
    this.outboundQueues.set(socket, queue);
    this.totalQueuedMessages += 1;
    this.app.metrics.setGauge('ws_outbound_queue_len', this.totalQueuedMessages);

    if (!this.flushingSockets.has(socket)) {
      this.flushingSockets.add(socket);
      setImmediate(() => this.flushOutbound(socket));
    }
  }

  private flushOutbound(socket: any): void {
    const queue = this.outboundQueues.get(socket);
    if (!queue || queue.length === 0 || socket.readyState !== 1) {
      this.flushingSockets.delete(socket);
      return;
    }

    while (queue.length > 0 && socket.readyState === 1) {
      if (socket.bufferedAmount > CollaborationWebSocketHandlers.WS_BUFFERED_AMOUNT_SOFT_LIMIT) {
        setTimeout(() => this.flushOutbound(socket), 15);
        return;
      }

      const message = queue.shift();
      if (!message) break;
      this.totalQueuedMessages = Math.max(0, this.totalQueuedMessages - 1);
      socket.send(message);
    }

    this.app.metrics.setGauge('ws_outbound_queue_len', this.totalQueuedMessages);
    this.flushingSockets.delete(socket);
  }

  private clearSocketQueue(socket: any): void {
    const queue = this.outboundQueues.get(socket);
    if (!queue) return;
    this.totalQueuedMessages = Math.max(0, this.totalQueuedMessages - queue.length);
    this.app.metrics.setGauge('ws_outbound_queue_len', this.totalQueuedMessages);
    this.outboundQueues.delete(socket);
    this.flushingSockets.delete(socket);
  }

  private extractToken(req: FastifyRequest): string {
    const query = parseWithSchema(wsAuthQuerySchema, req.query ?? {}, 'Invalid WebSocket auth query');
    if (query.token) {
      return query.token;
    }

    const authorization = req.headers.authorization;
    if (!authorization) {
      throw new AuthError('WebSocket authentication token is missing.', 401, 'SESSION_INVALID');
    }

    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      throw new AuthError('WebSocket token format is invalid. Use Bearer <token>.', 401, 'SESSION_INVALID');
    }
    return match[1];
  }

  private connectionKey(sessionId: number, userId: number): string {
    return `ws:conn:${sessionId}:${userId}`;
  }

  private async authenticateSocket(req: FastifyRequest): Promise<WsAuthedContext> {
    const params = parseWithSchema(sessionIdParamSchema, req.params, 'Invalid collaboration session id');
    const token = this.extractToken(req);

    if (!req.headers.authorization) {
      (req.headers as Record<string, unknown>).authorization = `Bearer ${token}`;
    }

    await validateToken(req);
    const payload = req.user as { userId: number } | undefined;
    if (!payload?.userId) {
      throw new AuthError('WebSocket session is invalid or expired. Please reconnect.', 401, 'SESSION_INVALID');
    }

    await this.collaborationService.assertUserCanAccessSession(params.sessionId, payload.userId);
    return {
      sessionId: params.sessionId,
      userId: payload.userId
    };
  }

  private async acquireConnectionLease(context: WsAuthedContext, socket: any): Promise<ConnectionLease | null> {
    const redisClient = this.app.cache?.available ? this.app.cache.client : null;
    const key = this.connectionKey(context.sessionId, context.userId);
    const owner = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    const existingLocal = this.localSocketByConnectionKey.get(key);
    if (existingLocal && existingLocal !== socket) {
      this.safeSend(existingLocal, {
        type: COLLAB_WEBSOCKET_EVENTS.CONNECTION_REPLACED,
        payload: {
          code: 'WS_CONNECTION_REPLACED',
          message: 'This collaboration session was opened from another active connection.'
        }
      });
      existingLocal.close(4409, 'Replaced by newer connection');
    }
    this.localSocketByConnectionKey.set(key, socket);

    if (!redisClient) {
      return { key, owner };
    }

    const claimed = await redisClient.set(
      key,
      owner,
      'EX',
      CollaborationWebSocketHandlers.WS_OWNER_TTL_SECONDS,
      'NX'
    );

    if (claimed !== 'OK') {
      const previousOwner = await redisClient.get(key);
      await redisClient.set(
        key,
        owner,
        'EX',
        CollaborationWebSocketHandlers.WS_OWNER_TTL_SECONDS
      );

      this.app.metrics.incrementCounter('ws_connection_replaced_total', 1);
      if (previousOwner) {
        this.app.log.info(
          { key, previousOwner, owner },
          'WebSocket ownership replaced by newer connection'
        );
      }
    }

    return { key, owner };
  }

  private startLeaseRefresh(socket: any, lease: ConnectionLease): void {
    const redisClient = this.app.cache?.available ? this.app.cache.client : null;
    if (!redisClient) return;

    const refreshTimer = setInterval(async () => {
      try {
        const refreshed = await redisClient.eval(
          `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("expire", KEYS[1], ARGV[2]) else return 0 end`,
          1,
          lease.key,
          lease.owner,
          CollaborationWebSocketHandlers.WS_OWNER_TTL_SECONDS
        );

        if (Number(refreshed) === 0) {
          this.safeSend(socket, {
            type: COLLAB_WEBSOCKET_EVENTS.CONNECTION_REPLACED,
            payload: {
              code: 'WS_CONNECTION_REPLACED',
              message: 'Your connection ownership moved to another active socket.'
            }
          });
          socket.close(4409, 'Connection ownership replaced');
        }
      } catch (error) {
        this.app.log.warn({ error, key: lease.key }, 'Failed to refresh websocket ownership lease');
      }
    }, CollaborationWebSocketHandlers.WS_OWNER_REFRESH_SECONDS * 1000);

    this.ownerRefreshTimers.set(socket, refreshTimer);
  }

  private async releaseConnectionLease(socket: any, lease: ConnectionLease | null): Promise<void> {
    const timer = this.ownerRefreshTimers.get(socket);
    if (timer) {
      clearInterval(timer);
      this.ownerRefreshTimers.delete(socket);
    }

    if (!lease) return;

    if (this.localSocketByConnectionKey.get(lease.key) === socket) {
      this.localSocketByConnectionKey.delete(lease.key);
    }

    const redisClient = this.app.cache?.available ? this.app.cache.client : null;
    if (!redisClient) return;

    try {
      await redisClient.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
        1,
        lease.key,
        lease.owner
      );
    } catch (error) {
      this.app.log.warn({ error, key: lease.key }, 'Failed to release websocket ownership lease');
    }
  }

  private async handleClientMessage(context: WsAuthedContext, raw: string, socket: any): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ValidationError('WebSocket message must be valid JSON.');
    }

    if (parsed && typeof parsed === 'object') {
      const candidate = parsed as { type?: string; eventId?: string };
      const requiresEventId = candidate.type === 'progress_update'
        || candidate.type === 'time_alert'
        || candidate.type === 'emoji_reaction'
        || candidate.type === 'finished';
      if (requiresEventId && (!candidate.eventId || candidate.eventId.trim().length < 8)) {
        throw new AppError(
          'This realtime action requires an eventId for duplicate protection.',
          400,
          'WS_EVENT_ID_REQUIRED'
        );
      }
    }

    const event = parseWithSchema(wsClientEventSchema, parsed, 'Invalid collaboration event payload');

    if (event.type === 'ready') {
      await this.collaborationService.markParticipantReady(context.sessionId, context.userId);
      return;
    }

    if (event.type === 'heartbeat') {
      await this.collaborationService.recordPresenceHeartbeat(context.sessionId, context.userId);
      this.safeSend(socket, {
        type: 'heartbeat_ack',
        payload: {
          sessionId: context.sessionId,
          serverTime: new Date().toISOString()
        }
      });
      return;
    }

    if (event.type === 'finished') {
      await this.collaborationService.markParticipantFinished(
        context.sessionId,
        context.userId,
        event.payload.examId
      );
      return;
    }

    await this.collaborationService.emitClientRealtimeEvent(
      context.sessionId,
      context.userId,
      event.type,
      event.payload,
      event.eventId
    );
  }

  private isCriticalRealtimeEvent(eventType: string): boolean {
    return eventType === COLLAB_WEBSOCKET_EVENTS.SESSION_STARTED
      || eventType === COLLAB_WEBSOCKET_EVENTS.SESSION_CANCELLED
      || eventType === COLLAB_WEBSOCKET_EVENTS.SESSION_COMPLETED
      || eventType === COLLAB_WEBSOCKET_EVENTS.FINISHED
      || eventType === COLLAB_WEBSOCKET_EVENTS.SESSION_NAME_UPDATED
      || eventType === COLLAB_WEBSOCKET_EVENTS.CONNECTION_REPLACED;
  }

  handleConnection = async (connection: WsConnection, req: FastifyRequest): Promise<void> => {
    const socket = connection.socket;
    let context: WsAuthedContext | null = null;
    let unsubscribe: (() => Promise<void>) | null = null;
    let heartbeatInterval: NodeJS.Timeout | null = null;
    let lease: ConnectionLease | null = null;
    let lastPongAt = Date.now();

    const closeWithError = (statusCode: number, message: string, code: string) => {
      const wsCloseCode = statusCode >= 4000 && statusCode <= 4999
        ? statusCode
        : statusCode === 401
          ? 4401
          : statusCode === 403
            ? 4403
            : 4400;

      this.safeSend(socket, {
        type: COLLAB_WEBSOCKET_EVENTS.SERVER_ERROR,
        payload: {
          code,
          message,
          statusCode
        }
      });
      socket.close(wsCloseCode, message);
    };

    try {
      context = await this.authenticateSocket(req);
      lease = await this.acquireConnectionLease(context, socket);
      if (lease) {
        this.ownerLeases.set(socket, lease);
        this.startLeaseRefresh(socket, lease);
      }
      this.app.metrics.incrementCounter('ws_connections_total', 1, { module: 'collaboration' });
      this.app.metrics.setGauge('active_ws_connections', this.localSocketByConnectionKey.size);

      unsubscribe = await this.sessionManager.subscribe(context.sessionId, (event) => {
        this.enqueueOutbound(socket, {
          type: event.type,
          payload: event.payload,
          createdAt: event.createdAt
        }, event.type, this.isCriticalRealtimeEvent(event.type));
      });
      await this.collaborationService.onSocketConnected(context.sessionId, context.userId);
    } catch (error: any) {
      const message = error?.message || 'WebSocket connection rejected.';
      const code = error?.code || 'WS_AUTH_FAILED';
      const statusCode = error?.statusCode || 4401;
      closeWithError(statusCode, message, code);
      return;
    }

    socket.on('pong', async () => {
      lastPongAt = Date.now();
      if (!context) return;
      try {
        await this.collaborationService.recordPresenceHeartbeat(context.sessionId, context.userId);
      } catch {
        // ignore heartbeat write failures to keep socket alive
      }
    });

    heartbeatInterval = setInterval(async () => {
      if (!context) return;
      const msSincePong = Date.now() - lastPongAt;
      if (msSincePong > COLLAB_LIMITS.HEARTBEAT_TTL_SECONDS * 1000) {
        socket.close(4408, 'Heartbeat timeout');
        return;
      }
      if (socket.readyState === 1) {
        socket.ping();
      }
      try {
        await this.collaborationService.recordPresenceHeartbeat(context.sessionId, context.userId);
      } catch {
        // best effort
      }
    }, COLLAB_LIMITS.HEARTBEAT_PING_INTERVAL_SECONDS * 1000);

    socket.on('message', async (raw: Buffer | string) => {
      if (!context) return;
      try {
        const asString = typeof raw === 'string' ? raw : raw.toString('utf8');
        await this.handleClientMessage(context, asString, socket);
      } catch (error: any) {
        this.safeSend(socket, {
          type: COLLAB_WEBSOCKET_EVENTS.SERVER_ERROR,
          payload: {
            code: error?.code || 'WS_EVENT_REJECTED',
            message: error?.message || 'Event rejected by server.'
          }
        });
      }
    });

    socket.on('close', async () => {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      this.clearSocketQueue(socket);
      if (unsubscribe) {
        await unsubscribe();
      }
      await this.releaseConnectionLease(socket, lease);
      this.ownerLeases.delete(socket);
      this.app.metrics.setGauge('active_ws_connections', this.localSocketByConnectionKey.size);
      if (context) {
        await this.collaborationService.onSocketDisconnected(context.sessionId, context.userId);
      }
    });

    socket.on('error', (error: Error) => {
      this.app.log.warn({ error, sessionId: context?.sessionId, userId: context?.userId }, 'Collaboration socket error');
    });
  };
}

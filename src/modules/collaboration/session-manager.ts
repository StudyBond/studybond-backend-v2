import { EventEmitter } from 'events';
import { FastifyInstance } from 'fastify';

interface SessionEventEnvelope {
  sessionId: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

type SessionEventListener = (event: SessionEventEnvelope) => void;

export class SessionManager {
  private readonly app: FastifyInstance;
  private readonly emitter = new EventEmitter();
  private readonly channelPrefix = 'collab:session:events:';
  private readonly listenersBySession = new Map<number, Set<SessionEventListener>>();
  private readonly subscriptions = new Set<number>();
  private publisher: any | null = null;
  private subscriber: any | null = null;

  constructor(app: FastifyInstance) {
    this.app = app;
    this.initializeRedisPubSub();
  }

  private initializeRedisPubSub(): void {
    const redisClient = this.app.cache?.available ? this.app.cache.client : null;
    if (!redisClient) return;

    this.publisher = redisClient;
    this.subscriber = redisClient.duplicate();

    this.subscriber.on('message', (channel: string, rawMessage: string) => {
      const prefix = this.channelPrefix;
      if (!channel.startsWith(prefix)) return;

      const sessionId = Number.parseInt(channel.slice(prefix.length), 10);
      if (!Number.isFinite(sessionId)) return;

      try {
        const event = JSON.parse(rawMessage) as SessionEventEnvelope;
        this.dispatch(sessionId, event);
      } catch (error) {
        this.app.log.warn({ error, channel }, 'Failed to parse collaboration event from Redis');
      }
    });
  }

  private channelName(sessionId: number): string {
    return `${this.channelPrefix}${sessionId}`;
  }

  private dispatch(sessionId: number, event: SessionEventEnvelope): void {
    this.emitter.emit(this.channelName(sessionId), event);
  }

  async subscribe(sessionId: number, listener: SessionEventListener): Promise<() => Promise<void>> {
    const channel = this.channelName(sessionId);
    const listeners = this.listenersBySession.get(sessionId) ?? new Set<SessionEventListener>();
    listeners.add(listener);
    this.listenersBySession.set(sessionId, listeners);
    this.emitter.on(channel, listener);

    if (this.subscriber && !this.subscriptions.has(sessionId)) {
      await this.subscriber.subscribe(channel);
      this.subscriptions.add(sessionId);
    }

    return async () => {
      const current = this.listenersBySession.get(sessionId);
      if (current) {
        current.delete(listener);
        if (current.size === 0) {
          this.listenersBySession.delete(sessionId);
          if (this.subscriber && this.subscriptions.has(sessionId)) {
            await this.subscriber.unsubscribe(channel);
            this.subscriptions.delete(sessionId);
          }
        }
      }
      this.emitter.off(channel, listener);
    };
  }

  async publish(sessionId: number, type: string, payload: Record<string, unknown>): Promise<void> {
    const event: SessionEventEnvelope = {
      sessionId,
      type,
      payload,
      createdAt: new Date().toISOString()
    };

    if (this.publisher) {
      await this.publisher.publish(this.channelName(sessionId), JSON.stringify(event));
      return;
    }

    this.dispatch(sessionId, event);
  }

  async close(): Promise<void> {
    if (!this.subscriber) return;

    try {
      for (const sessionId of this.subscriptions) {
        await this.subscriber.unsubscribe(this.channelName(sessionId));
      }
      this.subscriptions.clear();
      await this.subscriber.quit();
    } catch {
      try {
        await this.subscriber.disconnect();
      } catch {
        // no-op
      }
    }
  }
}

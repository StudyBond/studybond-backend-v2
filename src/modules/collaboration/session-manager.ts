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
        // Redis subscriber received an event — dispatch to local listeners.
        // NOTE: Local events were already dispatched synchronously in publish(),
        // so we must deduplicate to avoid firing handlers twice for same-process
        // events. We use a short-lived dedup set keyed by createdAt + type + sessionId.
        // For single-instance Railway deployments, this path is effectively a no-op
        // since the local dispatch in publish() already handled it.
        // For multi-instance deployments, this is the only path that fires.
        this.dispatchFromRedis(sessionId, event);
      } catch (error) {
        this.app.log.warn({ error, channel }, 'Failed to parse collaboration event from Redis');
      }
    });
  }

  private channelName(sessionId: number): string {
    return `${this.channelPrefix}${sessionId}`;
  }

  /**
   * Dispatches an event to all local EventEmitter listeners for a session.
   * This is the synchronous local delivery path.
   */
  private dispatch(sessionId: number, event: SessionEventEnvelope): void {
    this.emitter.emit(this.channelName(sessionId), event);
  }

  // ─── Redis deduplication ───
  // When both local dispatch and Redis subscriber fire for the same event
  // (single-instance scenario), we need to prevent double delivery.
  // We track recently dispatched event keys for a short window.
  private readonly recentlyDispatched = new Set<string>();

  private eventKey(event: SessionEventEnvelope): string {
    return `${event.sessionId}:${event.type}:${event.createdAt}`;
  }

  /**
   * Dispatches an event received from Redis pub/sub. Deduplicates against
   * events that were already dispatched locally by publish().
   */
  private dispatchFromRedis(sessionId: number, event: SessionEventEnvelope): void {
    const key = this.eventKey(event);
    if (this.recentlyDispatched.has(key)) {
      // Already dispatched locally — skip to prevent double delivery.
      this.recentlyDispatched.delete(key);
      return;
    }
    // This event originated from another process — dispatch it.
    this.dispatch(sessionId, event);
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

  /**
   * Publishes an event to all listeners, both local and remote.
   *
   * CRITICAL: Always dispatches locally FIRST to guarantee delivery on
   * the current process, then publishes to Redis for cross-instance
   * delivery as a best-effort operation. This ensures events flow even
   * when Redis is temporarily unavailable (e.g. Railway deployments with
   * flaky Redis connections).
   */
  async publish(sessionId: number, type: string, payload: Record<string, unknown>): Promise<void> {
    const event: SessionEventEnvelope = {
      sessionId,
      type,
      payload,
      createdAt: new Date().toISOString()
    };

    // 1. ALWAYS dispatch locally — this is the guaranteed delivery path.
    this.dispatch(sessionId, event);

    // 2. If Redis is available, also broadcast for cross-instance delivery.
    //    Mark the event as recently dispatched so the Redis subscriber
    //    deduplicates it on THIS instance.
    if (this.publisher) {
      const key = this.eventKey(event);
      this.recentlyDispatched.add(key);
      // Clean up the dedup key after a short window to prevent memory leaks.
      setTimeout(() => this.recentlyDispatched.delete(key), 5000);

      try {
        await this.publisher.publish(this.channelName(sessionId), JSON.stringify(event));
      } catch (error) {
        // Redis publish failed — local dispatch already handled it.
        // Log but do not throw; the event was delivered locally.
        this.app.log.warn({ error, sessionId, type }, 'Redis publish failed, event delivered locally only');
      }
    }
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

import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { CacheAdapter, setCacheAdapter } from '../shared/cache/cache';

async function redisPlugin(app: FastifyInstance) {
  const redisEnabled = process.env.REDIS_ENABLED === 'true';
  if (!redisEnabled) {
    app.log.info('Redis is disabled (REDIS_ENABLED=false). Using in-memory/no-cache behavior.');
    return;
  }

  let RedisCtor: any;
  try {
    // Optional dependency: backend still boots when Redis package is not installed.
    RedisCtor = require('ioredis');
  } catch {
    app.log.warn('ioredis is not installed. Install it to enable Redis-backed cache/rate-limit.');
    return;
  }

  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  let redisAvailable = false;
  const markAvailable = () => {
    redisAvailable = true;
    if (app.cache) app.cache.available = true;
  };
  const markUnavailable = () => {
    redisAvailable = false;
    if (app.cache) app.cache.available = false;
  };
  const client = new RedisCtor(redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: (times: number) => Math.min(1000 * times, 10000),
    reconnectOnError: (error: Error) => /READONLY|ETIMEDOUT|ECONNRESET|Connection is closed/i.test(error.message),
    connectTimeout: Number.parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS || '1500', 10),
    commandTimeout: Number.parseInt(process.env.REDIS_COMMAND_TIMEOUT_MS || '1500', 10),
    lazyConnect: true
  });
  client.on('error', (error: any) => {
    app.log.debug({ error }, 'Redis client error');
  });
  client.on('ready', markAvailable);
  client.on('close', markUnavailable);
  client.on('end', markUnavailable);
  client.on('reconnecting', markUnavailable);

  try {
    if (typeof client.connect === 'function') {
      await client.connect();
    }
    await client.ping();
    markAvailable();
  } catch (error) {
    markUnavailable();
    app.log.error({ error }, 'Redis connection failed. Continuing without Redis.');
    try {
      await client.quit();
    } catch {
      // ignore
    }
    return;
  }

  const adapter: CacheAdapter = {
    get available() {
      return redisAvailable;
    },
    async get(key: string) {
      return client.get(key);
    },
    async set(key: string, value: string, ttlSeconds?: number) {
      if (ttlSeconds && ttlSeconds > 0) {
        await client.set(key, value, 'EX', ttlSeconds);
        return;
      }
      await client.set(key, value);
    },
    async del(key: string) {
      await client.del(key);
    },
    async delMany(keys: string[]) {
      if (keys.length === 0) return;
      await client.del(...keys);
    },
    async incr(key: string) {
      return client.incr(key);
    },
    async expire(key: string, ttlSeconds: number) {
      await client.expire(key, ttlSeconds);
    },
    async acquireLock(key: string, owner: string, ttlSeconds: number) {
      const result = await client.set(key, owner, 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    },
    async releaseLock(key: string, owner: string) {
      // Prevent deleting another request's lock if this lock expired and was reacquired.
      await client.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
        1,
        key,
        owner
      );
    },
    async zadd(key: string, score: number, member: string) {
      await client.zadd(key, score, member);
    },
    async zrem(key: string, member: string) {
      await client.zrem(key, member);
    },
    async zrevrange(key: string, start: number, stop: number) {
      return client.zrevrange(key, start, stop);
    },
    async zrevrank(key: string, member: string) {
      const rank = await client.zrevrank(key, member);
      return rank === null ? null : Number(rank);
    },
    async zcount(key: string, min: string, max: string) {
      return client.zcount(key, min, max);
    },
    async zcard(key: string) {
      return client.zcard(key);
    },
    async hset(key: string, field: string, value: string) {
      await client.hset(key, field, value);
    },
    async hmget(key: string, fields: string[]) {
      if (fields.length === 0) return [];
      return client.hmget(key, ...fields);
    }
  };

  setCacheAdapter(adapter);
  app.decorate('cache', {
    available: true,
    client
  });

  app.addHook('onClose', async () => {
    try {
      client.disconnect();
    } catch {
      // ignore
    }
  });

  app.log.info({ redisUrl }, 'Redis connected successfully');
}

export default fp(redisPlugin, {
  name: 'redis-plugin'
});

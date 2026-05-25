type RateLimitCallback = (error: Error | null, result?: { current: number; ttl: number }) => void;

interface RateLimitStoreOptions {
  continueExceeding?: boolean;
  exponentialBackoff?: boolean;
  cache?: number;
  routeInfo?: {
    method?: string;
    url?: string;
  };
}

interface LoggerLike {
  warn(payload: unknown, message?: string): void;
}

interface LocalEntry {
  current: number;
  iterationStartMs: number;
  ttl: number;
}

const redisRateLimitLua = `
  local key = KEYS[1]
  local timeWindow = tonumber(ARGV[1])
  local max = tonumber(ARGV[2])
  local continueExceeding = ARGV[3] == 'true'
  local exponentialBackoff = ARGV[4] == 'true'
  local MAX_SAFE_INTEGER = (2^53) - 1
  local current = redis.call('INCR', key)

  if current == 1 or (continueExceeding and current > max) then
    redis.call('PEXPIRE', key, timeWindow)
  elseif exponentialBackoff and current > max then
    local backoffExponent = current - max - 1
    timeWindow = math.min(timeWindow * (2 ^ backoffExponent), MAX_SAFE_INTEGER)
    redis.call('PEXPIRE', key, timeWindow)
  else
    timeWindow = redis.call('PTTL', key)
  end

  return {current, timeWindow}
`;

export function createResilientRateLimitStore(redis: any, namespace: string, logger: LoggerLike): any {
  if (!redis.rateLimit) {
    redis.defineCommand('rateLimit', {
      numberOfKeys: 1,
      lua: redisRateLimitLua
    });
  }

  return class ResilientRateLimitStore {
    private readonly continueExceeding: boolean;
    private readonly exponentialBackoff: boolean;
    private readonly maxEntries: number;
    private readonly prefix: string;
    private readonly localEntries = new Map<string, LocalEntry>();
    private lastFallbackWarningAt = 0;

    constructor(options: RateLimitStoreOptions = {}, prefix = namespace) {
      this.continueExceeding = Boolean(options.continueExceeding);
      this.exponentialBackoff = Boolean(options.exponentialBackoff);
      this.maxEntries = Number.isFinite(options.cache) ? Math.max(1, Number(options.cache)) : 10000;
      this.prefix = prefix;
    }

    incr(key: string, callback: RateLimitCallback, timeWindow: number, max: number): void {
      if (isRedisReady(redis)) {
        try {
          redis.rateLimit(
            this.prefix + key,
            timeWindow,
            max,
            this.continueExceeding,
            this.exponentialBackoff,
            (error: Error | null, result: [number, number]) => {
              if (!error && result) {
                callback(null, { current: Number(result[0]), ttl: Number(result[1]) });
                return;
              }

              this.warnFallback(error);
              callback(null, this.incrLocal(key, timeWindow, max));
            }
          );
          return;
        } catch (error) {
          this.warnFallback(error);
        }
      } else {
        this.warnFallback(new Error(`Redis is ${redis.status || 'not ready'}`));
      }

      callback(null, this.incrLocal(key, timeWindow, max));
    }

    child(options: RateLimitStoreOptions): ResilientRateLimitStore {
      const method = options.routeInfo?.method || '';
      const url = options.routeInfo?.url || '';
      return new ResilientRateLimitStore(options, `${this.prefix}${method}${url}-`);
    }

    private incrLocal(key: string, timeWindow: number, max: number): { current: number; ttl: number } {
      const nowInMs = Date.now();
      let entry = this.localEntries.get(key);

      if (!entry || entry.iterationStartMs + timeWindow <= nowInMs) {
        entry = { current: 1, ttl: timeWindow, iterationStartMs: nowInMs };
      } else {
        entry.current += 1;

        if (this.continueExceeding && entry.current > max) {
          entry.ttl = timeWindow;
          entry.iterationStartMs = nowInMs;
        } else if (this.exponentialBackoff && entry.current > max) {
          const ttl = timeWindow * 2 ** (entry.current - max - 1);
          entry.ttl = Number.isSafeInteger(ttl) ? ttl : Number.MAX_SAFE_INTEGER;
          entry.iterationStartMs = nowInMs;
        } else {
          entry.ttl = Math.max(0, timeWindow - (nowInMs - entry.iterationStartMs));
        }
      }

      this.localEntries.set(key, entry);
      this.pruneLocalEntries(nowInMs);
      return { current: entry.current, ttl: entry.ttl };
    }

    private pruneLocalEntries(nowInMs: number): void {
      for (const [key, entry] of this.localEntries) {
        if (entry.iterationStartMs + entry.ttl <= nowInMs) {
          this.localEntries.delete(key);
        }
      }

      while (this.localEntries.size > this.maxEntries) {
        const oldestKey = this.localEntries.keys().next().value;
        if (!oldestKey) break;
        this.localEntries.delete(oldestKey);
      }
    }

    private warnFallback(error: unknown): void {
      const now = Date.now();
      if (now - this.lastFallbackWarningAt < 60000) return;
      this.lastFallbackWarningAt = now;
      logger.warn({ error }, 'Redis rate limit backend unavailable; using local fallback store.');
    }
  };
}

function isRedisReady(redis: any): boolean {
  return redis?.status === 'ready';
}

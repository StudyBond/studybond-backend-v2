import { describe, expect, it, vi } from 'vitest';
import { createResilientRateLimitStore } from '../../plugins/resilient-rate-limit-store';

function buildLogger() {
  return {
    warn: vi.fn()
  };
}

describe('resilient rate limit store', () => {
  it('uses the local fallback instead of returning Redis closed errors', async () => {
    const redis = {
      status: 'end',
      defineCommand: vi.fn()
    };
    const logger = buildLogger();
    const Store = createResilientRateLimitStore(redis, 'test:', logger);
    const store = new Store({ cache: 10 });

    const result = await new Promise<{ current: number; ttl: number }>((resolve, reject) => {
      store.incr(
        'user-1',
        (error: Error | null, value?: { current: number; ttl: number }) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(value as { current: number; ttl: number });
        },
        60000,
        100
      );
    });

    expect(result.current).toBe(1);
    expect(result.ttl).toBe(60000);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('falls back locally when the Redis command callback returns an error', async () => {
    const redis = {
      status: 'ready',
      defineCommand: vi.fn(),
      rateLimit: vi.fn((_key, _timeWindow, _max, _continueExceeding, _exponentialBackoff, callback) => {
        callback(new Error('Connection is closed.'));
      })
    };
    const logger = buildLogger();
    const Store = createResilientRateLimitStore(redis, 'test:', logger);
    const store = new Store({ cache: 10 });

    const result = await new Promise<{ current: number; ttl: number }>((resolve, reject) => {
      store.incr(
        'user-1',
        (error: Error | null, value?: { current: number; ttl: number }) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(value as { current: number; ttl: number });
        },
        60000,
        100
      );
    });

    expect(result.current).toBe(1);
    expect(redis.rateLimit).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

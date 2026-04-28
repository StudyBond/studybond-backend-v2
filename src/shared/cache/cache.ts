export interface CacheAdapter {
  available: boolean;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  delMany?(keys: string[]): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<void>;
  acquireLock(key: string, owner: string, ttlSeconds: number): Promise<boolean>;
  releaseLock(key: string, owner: string): Promise<void>;
  zadd?(key: string, score: number, member: string): Promise<void>;
  zrem?(key: string, member: string): Promise<void>;
  zrevrange?(key: string, start: number, stop: number): Promise<string[]>;
  zrevrank?(key: string, member: string): Promise<number | null>;
  zcount?(key: string, min: string, max: string): Promise<number>;
  zcard?(key: string): Promise<number>;
  hset?(key: string, field: string, value: string): Promise<void>;
  hmget?(key: string, fields: string[]): Promise<Array<string | null>>;
}

class NoopCacheAdapter implements CacheAdapter {
  available = false;

  async get(_key: string): Promise<string | null> {
    return null;
  }

  async set(_key: string, _value: string, _ttlSeconds?: number): Promise<void> {
    return;
  }

  async del(_key: string): Promise<void> {
    return;
  }

  async delMany(_keys: string[]): Promise<void> {
    return;
  }

  async incr(_key: string): Promise<number> {
    return 0;
  }

  async expire(_key: string, _ttlSeconds: number): Promise<void> {
    return;
  }

  async acquireLock(_key: string, _owner: string, _ttlSeconds: number): Promise<boolean> {
    // No-op cache should never block core API flows.
    return true;
  }

  async releaseLock(_key: string, _owner: string): Promise<void> {
    return;
  }

  async zadd(_key: string, _score: number, _member: string): Promise<void> {
    return;
  }

  async zrem(_key: string, _member: string): Promise<void> {
    return;
  }

  async zrevrange(_key: string, _start: number, _stop: number): Promise<string[]> {
    return [];
  }

  async zrevrank(_key: string, _member: string): Promise<number | null> {
    return null;
  }

  async zcount(_key: string, _min: string, _max: string): Promise<number> {
    return 0;
  }

  async zcard(_key: string): Promise<number> {
    return 0;
  }

  async hset(_key: string, _field: string, _value: string): Promise<void> {
    return;
  }

  async hmget(_key: string, fields: string[]): Promise<Array<string | null>> {
    return fields.map(() => null);
  }
}

let cacheAdapter: CacheAdapter = new NoopCacheAdapter();

export function setCacheAdapter(adapter: CacheAdapter): void {
  cacheAdapter = adapter;
}

export function getCacheAdapter(): CacheAdapter {
  return cacheAdapter;
}

export async function getJson<T>(key: string): Promise<T | null> {
  const raw = await cacheAdapter.get(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
  await cacheAdapter.set(key, JSON.stringify(value), ttlSeconds);
}

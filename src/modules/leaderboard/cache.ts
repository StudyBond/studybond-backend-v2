import { getCacheAdapter, getJson, setJson } from '../../shared/cache/cache';

interface MemoryEntry<T> {
  expiresAt: number;
  value: T;
}

const memoryCache = new Map<string, MemoryEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

function maybeSweepExpiredEntries(): void {
  if (Math.random() > 0.02) return;
  const now = Date.now();
  for (const [key, entry] of memoryCache.entries()) {
    if (entry.expiresAt <= now) {
      memoryCache.delete(key);
    }
  }
}

function readFromMemoryCache<T>(key: string): T | null {
  maybeSweepExpiredEntries();
  const entry = memoryCache.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return null;
  }

  return entry.value as T;
}

function writeToMemoryCache<T>(key: string, value: T, ttlSeconds: number): void {
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + (ttlSeconds * 1000)
  });
}

export async function getCachedLeaderboard<T>(key: string): Promise<T | null> {
  const cache = getCacheAdapter();

  if (cache.available) {
    try {
      const cached = await getJson<T>(key);
      if (cached !== null) return cached;
    } catch {
      // Leaderboard is non-critical; fallback to memory/DB.
    }
  }

  return readFromMemoryCache<T>(key);
}

export async function setCachedLeaderboard<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  writeToMemoryCache(key, value, ttlSeconds);

  const cache = getCacheAdapter();
  if (!cache.available) return;

  try {
    await setJson(key, value, ttlSeconds);
  } catch {
    // Cache write failures must never block leaderboard reads.
  }
}

export async function deleteCachedLeaderboard(key: string): Promise<void> {
  memoryCache.delete(key);

  const cache = getCacheAdapter();
  if (!cache.available) return;

  try {
    await cache.del(key);
  } catch {
    // Ignore cache delete failures in non-critical flow.
  }
}

export async function fetchWithLeaderboardCache<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>
): Promise<T> {
  const cached = await getCachedLeaderboard<T>(key);
  if (cached !== null) return cached;

  const currentInFlight = inFlight.get(key);
  if (currentInFlight) {
    return currentInFlight as Promise<T>;
  }

  const task = (async () => {
    const value = await loader();
    await setCachedLeaderboard(key, value, ttlSeconds);
    return value;
  })()
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, task as Promise<unknown>);
  return task;
}

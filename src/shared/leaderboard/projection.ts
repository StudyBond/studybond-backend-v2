import prisma from '../../config/database';
import { CacheAdapter, getCacheAdapter } from '../cache/cache';
import { getGlobalMetricsRegistry } from '../metrics/global';

export type LeaderboardProjectionSource =
  | 'EXAM_SUBMIT'
  | 'WEEKLY_RESET'
  | 'RECONCILIATION'
  | 'MANUAL';

export interface LeaderboardUserProjectionSnapshot {
  institutionId: number;
  userId: number;
  fullName: string;
  weeklySp: number;
  totalSp: number;
  updatedAt: string;
}

interface ProjectionReadConfig {
  enabled: boolean;
  redisReadEnabled: boolean;
  tieBuffer: number;
  staleSeconds: number;
}

export interface LeaderboardProjectionRedisKeys {
  weeklyZSet: string;
  allTimeZSet: string;
  userHash: string;
}

export function buildLeaderboardRedisKeys(institutionId: number): LeaderboardProjectionRedisKeys {
  const normalizedInstitutionId = Number(institutionId);
  if (!Number.isInteger(normalizedInstitutionId) || normalizedInstitutionId <= 0) {
    throw new Error(`Invalid leaderboard institution scope: ${institutionId}`);
  }

  const prefix = `lb:v2:institution:${normalizedInstitutionId}`;
  return {
    weeklyZSet: `${prefix}:weekly:z`,
    allTimeZSet: `${prefix}:alltime:z`,
    userHash: `${prefix}:user:h`
  };
}

function parseIntOrDefault(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getProjectionReadConfig(): ProjectionReadConfig {
  return {
    enabled: process.env.LEADERBOARD_PROJECTION_ENABLED === 'true',
    redisReadEnabled: process.env.LEADERBOARD_REDIS_READ_ENABLED === 'true',
    tieBuffer: parseIntOrDefault(process.env.LEADERBOARD_TIE_BUFFER, 20),
    staleSeconds: parseIntOrDefault(process.env.LEADERBOARD_PROJECTION_STALE_SECONDS, 120)
  };
}

export function isLeaderboardProjectionEnabled(): boolean {
  return process.env.LEADERBOARD_PROJECTION_ENABLED === 'true';
}

export function recordProjectionEventMetric(
  status: 'queued' | 'processed' | 'failed',
  lagSeconds?: number
): void {
  const metrics = getGlobalMetricsRegistry();
  metrics?.incrementCounter('leaderboard_projection_events_total', 1, { status });
  if (typeof lagSeconds === 'number') {
    metrics?.setGauge('leaderboard_projection_lag_seconds', lagSeconds);
  }
}

export async function queueLeaderboardProjectionEventTx(
  tx: any,
  event: {
    userId: number;
    institutionId?: number | null;
    weeklySp: number;
    totalSp: number;
    source: LeaderboardProjectionSource;
  }
): Promise<void> {
  if (!isLeaderboardProjectionEnabled()) return;

  await tx.leaderboardProjectionEvent.create({
    data: {
      userId: event.userId,
      institutionId: event.institutionId ?? null,
      weeklySp: event.weeklySp,
      totalSp: event.totalSp,
      source: event.source
    }
  });

  recordProjectionEventMetric('queued');
}

export async function queueLeaderboardProjectionEvent(
  input: {
    userId: number;
    institutionId: number;
    source: LeaderboardProjectionSource;
  }
): Promise<void> {
  if (!isLeaderboardProjectionEnabled()) return;

  const stats = await prisma.userInstitutionStats.findUnique({
    where: {
      userId_institutionId: {
        userId: input.userId,
        institutionId: input.institutionId
      }
    },
    select: {
      weeklySp: true,
      totalSp: true
    }
  });

  if (!stats) return;

  await prisma.leaderboardProjectionEvent.create({
    data: {
      userId: input.userId,
      institutionId: input.institutionId,
      weeklySp: stats.weeklySp,
      totalSp: stats.totalSp,
      source: input.source
    }
  });
  recordProjectionEventMetric('queued');
}

export function serializeProjectionSnapshot(snapshot: LeaderboardUserProjectionSnapshot): string {
  return JSON.stringify(snapshot);
}

export function parseProjectionSnapshot(raw: string | null): LeaderboardUserProjectionSnapshot | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as LeaderboardUserProjectionSnapshot;
    if (
      typeof parsed.userId !== 'number' ||
      typeof parsed.institutionId !== 'number' ||
      typeof parsed.fullName !== 'string' ||
      typeof parsed.weeklySp !== 'number' ||
      typeof parsed.totalSp !== 'number' ||
      typeof parsed.updatedAt !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function applyProjectionSnapshotToRedis(
  snapshot: LeaderboardUserProjectionSnapshot,
  cache: CacheAdapter = getCacheAdapter()
): Promise<boolean> {
  if (
    !cache.available ||
    !cache.hset ||
    !cache.zadd ||
    !cache.zrem
  ) {
    return false;
  }

  const keys = buildLeaderboardRedisKeys(snapshot.institutionId);
  const member = String(snapshot.userId);
  await cache.hset(
    keys.userHash,
    member,
    serializeProjectionSnapshot(snapshot)
  );

  if (snapshot.weeklySp > 0) {
    await cache.zadd(keys.weeklyZSet, snapshot.weeklySp, member);
  } else {
    await cache.zrem(keys.weeklyZSet, member);
  }

  if (snapshot.totalSp > 0) {
    await cache.zadd(keys.allTimeZSet, snapshot.totalSp, member);
  } else {
    await cache.zrem(keys.allTimeZSet, member);
  }

  return true;
}

export async function clearWeeklyProjectionKeys(
  institutionIds: number[],
  cache: CacheAdapter = getCacheAdapter()
): Promise<void> {
  if (!cache.available) return;
  if (institutionIds.length === 0) return;

  const keys = institutionIds.map((institutionId) => buildLeaderboardRedisKeys(institutionId).weeklyZSet);

  if (cache.delMany) {
    await cache.delMany(keys);
    return;
  }

  await Promise.all(keys.map((key) => cache.del(key)));
}

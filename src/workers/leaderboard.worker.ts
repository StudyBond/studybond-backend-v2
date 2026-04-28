import 'dotenv/config';
import cron from 'node-cron';
import prisma from '../config/database';
import { LeaderboardService } from '../modules/leaderboard/leaderboard.service';
import { CacheAdapter, setCacheAdapter } from '../shared/cache/cache';
import {
  applyProjectionSnapshotToRedis,
  buildLeaderboardRedisKeys,
  isLeaderboardProjectionEnabled,
  LeaderboardUserProjectionSnapshot,
  recordProjectionEventMetric
} from '../shared/leaderboard/projection';
import { institutionContextService } from '../shared/institutions/context';

const RedisCtor = (() => {
  try {
    return require('ioredis');
  } catch {
    return null;
  }
})();

const BATCH_SIZE = Number.parseInt(process.env.LEADERBOARD_WORKER_BATCH_SIZE || '200', 10);
const POLL_INTERVAL_MS = Number.parseInt(process.env.LEADERBOARD_WORKER_POLL_INTERVAL_MS || '800', 10);
const MAX_ATTEMPTS = Number.parseInt(process.env.LEADERBOARD_WORKER_MAX_ATTEMPTS || '8', 10);
const RECONCILE_INTERVAL_SECONDS = Number.parseInt(process.env.LEADERBOARD_WORKER_RECONCILE_INTERVAL_SECONDS || '300', 10);
const RECONCILE_TOP_N = Number.parseInt(process.env.LEADERBOARD_WORKER_RECONCILE_TOP_N || '100', 10);
const RECONCILE_SAMPLE_SIZE = Number.parseInt(process.env.LEADERBOARD_WORKER_RECONCILE_SAMPLE_SIZE || '20', 10);
const WEEKLY_RESET_CRON = process.env.LEADERBOARD_WEEKLY_RESET_CRON || '59 23 * * 0';
const WEEKLY_RESET_TIMEZONE = process.env.JOBS_TIMEZONE || 'Africa/Lagos';

let shuttingDown = false;
let redisClient: any | null = null;

function createWorkerCacheAdapter(client: any): CacheAdapter {
  return {
    available: true,
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
}

async function setupRedisForWorker(): Promise<void> {
  if (!isLeaderboardProjectionEnabled()) {
    console.log('[leaderboard-worker] projection disabled, Redis projection loop will be idle.');
    return;
  }

  if (!RedisCtor) {
    console.warn('[leaderboard-worker] ioredis package is missing. Projection worker disabled.');
    return;
  }

  if (process.env.REDIS_ENABLED !== 'true') {
    console.warn('[leaderboard-worker] REDIS_ENABLED=false. Projection worker disabled.');
    return;
  }

  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const client = new RedisCtor(redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
    reconnectOnError: () => false,
    connectTimeout: Number.parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS || '1500', 10),
    lazyConnect: true
  });
  client.on('error', (error: any) => {
    console.warn('[leaderboard-worker] Redis client error', error?.message || error);
  });

  if (typeof client.connect === 'function') {
    await client.connect();
  }
  await client.ping();
  redisClient = client;
  setCacheAdapter(createWorkerCacheAdapter(client));
  console.log(`[leaderboard-worker] Redis connected at ${redisUrl}`);
}

type ClaimedProjectionEvent = {
  id: bigint | number | string;
  userId: number;
  institutionId: number | null;
  weeklySp: number;
  totalSp: number;
  attempts: number;
  createdAt: Date;
};

type LeaderboardUserIdentity = {
  id: number;
  fullName: string;
};

type LeaderboardScoreRow = {
  userId: number;
  fullName: string;
  weeklySp: number;
  totalSp: number;
};

function normalizeBigIntId(id: bigint | number | string): bigint {
  if (typeof id === 'bigint') return id;
  if (typeof id === 'number') return BigInt(id);
  return BigInt(id);
}

async function resolveProjectionInstitutionId(institutionId: number | null | undefined): Promise<number> {
  if (typeof institutionId === 'number' && Number.isInteger(institutionId) && institutionId > 0) {
    return institutionId;
  }

  const launchInstitution = await institutionContextService.resolveByCode();
  return launchInstitution.id;
}

async function claimProjectionEvents(limit: number): Promise<ClaimedProjectionEvent[]> {
  return prisma.$transaction(async (tx: any) => {
    const rows = await tx.$queryRawUnsafe(
      `
      WITH candidate AS (
        SELECT "id"
        FROM "LeaderboardProjectionEvent"
        WHERE "processedAt" IS NULL
          AND "attempts" < $1
        ORDER BY "id" ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "LeaderboardProjectionEvent" e
      SET
        "attempts" = e."attempts" + 1,
        "updatedAt" = NOW()
      FROM candidate
      WHERE e."id" = candidate."id"
      RETURNING
        e."id",
        e."userId",
        e."institutionId",
        e."weeklySp",
        e."totalSp",
        e."attempts",
        e."createdAt"
      `,
      MAX_ATTEMPTS,
      limit
    );

    return rows as ClaimedProjectionEvent[];
  });
}

async function markProjectionProcessed(eventId: bigint | number | string): Promise<void> {
  await prisma.leaderboardProjectionEvent.update({
    where: { id: normalizeBigIntId(eventId) },
    data: {
      processedAt: new Date(),
      errorMessage: null
    }
  });
}

async function markProjectionFailed(event: ClaimedProjectionEvent, reason: string): Promise<void> {
  await prisma.leaderboardProjectionEvent.update({
    where: { id: normalizeBigIntId(event.id) },
    data: {
      errorMessage: reason.slice(0, 4000),
      processedAt: event.attempts >= MAX_ATTEMPTS ? new Date() : null
    }
  });
}

async function processProjectionBatch(): Promise<number> {
  if (!isLeaderboardProjectionEnabled()) return 0;
  if (!redisClient) return 0;

  const events = await claimProjectionEvents(BATCH_SIZE);
  if (events.length === 0) return 0;

  const userIds = Array.from(new Set(events.map((event) => event.userId)));
  const users: LeaderboardUserIdentity[] = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      fullName: true
    }
  });
  const nameMap = new Map<number, string>(users.map((user: LeaderboardUserIdentity) => [user.id, user.fullName]));

  for (const event of events) {
    const scopedInstitutionId = await resolveProjectionInstitutionId(event.institutionId);
    const snapshot: LeaderboardUserProjectionSnapshot = {
      institutionId: scopedInstitutionId,
      userId: event.userId,
      fullName: nameMap.get(event.userId) || `User ${event.userId}`,
      weeklySp: event.weeklySp,
      totalSp: event.totalSp,
      updatedAt: new Date().toISOString()
    };

    try {
      await applyProjectionSnapshotToRedis(snapshot);
      await markProjectionProcessed(event.id);
      const lagSeconds = Math.max(
        0,
        Math.floor((Date.now() - new Date(event.createdAt).getTime()) / 1000)
      );
      recordProjectionEventMetric('processed', lagSeconds);
      console.log(`[leaderboard-worker] projected event=${event.id.toString()} lag=${lagSeconds}s`);
    } catch (error: any) {
      const reason = error?.message || 'projection_failed';
      await markProjectionFailed(event, reason);
      recordProjectionEventMetric('failed');
      console.error(`[leaderboard-worker] failed event=${event.id.toString()} reason=${reason}`);
    }
  }

  return events.length;
}

async function dbExactRankForWeekly(
  institutionId: number,
  userId: number,
  weeklySp: number,
  totalSp: number
): Promise<number | null> {
  if (weeklySp <= 0) return null;
  const ahead = await prisma.userInstitutionStats.count({
    where: {
      institutionId,
      OR: [
        { weeklySp: { gt: weeklySp } },
        { weeklySp, totalSp: { gt: totalSp } },
        { weeklySp, totalSp, userId: { lt: userId } }
      ]
    }
  });
  return ahead + 1;
}

async function dbExactRankForAllTime(
  institutionId: number,
  userId: number,
  weeklySp: number,
  totalSp: number
): Promise<number | null> {
  if (totalSp <= 0) return null;
  const ahead = await prisma.userInstitutionStats.count({
    where: {
      institutionId,
      OR: [
        { totalSp: { gt: totalSp } },
        { totalSp, weeklySp: { gt: weeklySp } },
        { totalSp, weeklySp, userId: { lt: userId } }
      ]
    }
  });
  return ahead + 1;
}

async function runProjectionReconciliation(): Promise<void> {
  if (!isLeaderboardProjectionEnabled()) return;
  const cache = redisClient ? createWorkerCacheAdapter(redisClient) : null;
  if (!cache?.available || !cache.zrevrange || !cache.zrevrank) return;

  const institutionScopes = await prisma.userInstitutionStats.findMany({
    where: {
      OR: [
        { weeklySp: { gt: 0 } },
        { totalSp: { gt: 0 } }
      ]
    },
    distinct: ['institutionId'],
    select: {
      institutionId: true
    }
  });

  for (const scope of institutionScopes) {
    const institutionId = scope.institutionId;
    const redisKeys = buildLeaderboardRedisKeys(institutionId);
    const [weeklyTop, allTimeTop]: [LeaderboardScoreRow[], LeaderboardScoreRow[]] = await Promise.all([
      prisma.userInstitutionStats.findMany({
        where: {
          institutionId,
          weeklySp: { gt: 0 }
        },
        orderBy: [{ weeklySp: 'desc' }, { totalSp: 'desc' }, { userId: 'asc' }],
        take: RECONCILE_TOP_N,
        select: {
          userId: true,
          weeklySp: true,
          totalSp: true,
          user: {
            select: {
              fullName: true
            }
          }
        }
      }).then((rows: Array<any>) => rows.map((row) => ({
        userId: row.userId,
        fullName: row.user.fullName,
        weeklySp: row.weeklySp,
        totalSp: row.totalSp
      }))),
      prisma.userInstitutionStats.findMany({
        where: {
          institutionId,
          totalSp: { gt: 0 }
        },
        orderBy: [{ totalSp: 'desc' }, { weeklySp: 'desc' }, { userId: 'asc' }],
        take: RECONCILE_TOP_N,
        select: {
          userId: true,
          weeklySp: true,
          totalSp: true,
          user: {
            select: {
              fullName: true
            }
          }
        }
      }).then((rows: Array<any>) => rows.map((row) => ({
        userId: row.userId,
        fullName: row.user.fullName,
        weeklySp: row.weeklySp,
        totalSp: row.totalSp
      })))
    ]);

    for (const row of [...weeklyTop, ...allTimeTop]) {
      await applyProjectionSnapshotToRedis({
        institutionId,
        userId: row.userId,
        fullName: row.fullName,
        weeklySp: row.weeklySp,
        totalSp: row.totalSp,
        updatedAt: new Date().toISOString()
      }, cache);
    }

    const [redisWeeklyIds, redisAllTimeIds] = await Promise.all([
      cache.zrevrange(redisKeys.weeklyZSet, 0, Math.max(0, RECONCILE_TOP_N - 1)),
      cache.zrevrange(redisKeys.allTimeZSet, 0, Math.max(0, RECONCILE_TOP_N - 1))
    ]);

    const weeklyMismatch = redisWeeklyIds.join(',') !== weeklyTop.map((row: LeaderboardScoreRow) => String(row.userId)).join(',');
    const allTimeMismatch = redisAllTimeIds.join(',') !== allTimeTop.map((row: LeaderboardScoreRow) => String(row.userId)).join(',');
    if (weeklyMismatch || allTimeMismatch) {
      console.warn(
        `[leaderboard-worker] top-N drift institution=${institutionId} weekly=${weeklyMismatch} allTime=${allTimeMismatch}`
      );
    }

    const sampleUsers = await prisma.userInstitutionStats.findMany({
      where: {
        institutionId,
        OR: [
          { weeklySp: { gt: 0 } },
          { totalSp: { gt: 0 } }
        ]
      },
      orderBy: { userId: 'asc' },
      take: RECONCILE_SAMPLE_SIZE,
      select: { userId: true, weeklySp: true, totalSp: true }
    });

    let sampleMismatchCount = 0;
    for (const user of sampleUsers) {
      const [dbWeeklyRank, dbAllTimeRank, redisWeeklyRank, redisAllTimeRank] = await Promise.all([
        dbExactRankForWeekly(institutionId, user.userId, user.weeklySp, user.totalSp),
        dbExactRankForAllTime(institutionId, user.userId, user.weeklySp, user.totalSp),
        cache.zrevrank(redisKeys.weeklyZSet, String(user.userId)),
        cache.zrevrank(redisKeys.allTimeZSet, String(user.userId))
      ]);

      const normalizedRedisWeekly = redisWeeklyRank === null ? null : redisWeeklyRank + 1;
      const normalizedRedisAllTime = redisAllTimeRank === null ? null : redisAllTimeRank + 1;

      if (dbWeeklyRank !== normalizedRedisWeekly || dbAllTimeRank !== normalizedRedisAllTime) {
        sampleMismatchCount += 1;
      }
    }

    if (sampleMismatchCount > 0) {
      console.warn(
        `[leaderboard-worker] sampled-rank drift detected institution=${institutionId} mismatches=${sampleMismatchCount}`
      );
    } else {
      console.log(`[leaderboard-worker] reconciliation clean institution=${institutionId}`);
    }
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runContinuousLoop(): Promise<void> {
  while (!shuttingDown) {
    try {
      const processed = await processProjectionBatch();
      if (processed === 0) {
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (error) {
      console.error('[leaderboard-worker] processing loop error', error);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

async function start(): Promise<void> {
  const onceMode = process.argv.includes('--once');
  await setupRedisForWorker();

  const leaderboardService = new LeaderboardService();
  const reconciliationIntervalMs = Math.max(5, RECONCILE_INTERVAL_SECONDS) * 1000;
  const reconciliationTimer = onceMode
    ? null
    : setInterval(() => {
      void runProjectionReconciliation();
    }, reconciliationIntervalMs);

  const weeklyResetTask = onceMode
    ? null
    : cron.schedule(WEEKLY_RESET_CRON, async () => {
      const result = await leaderboardService.runWeeklyReset();
      if (result.skipped) {
        console.log('[leaderboard-worker] weekly reset skipped due to active lock');
        return;
      }
      console.log(`[leaderboard-worker] weekly reset complete users=${result.resetUsers} week=${result.weekStartDate}`);
    }, {
      timezone: WEEKLY_RESET_TIMEZONE
    });

  if (onceMode) {
    await processProjectionBatch();
    await runProjectionReconciliation();
  } else {
    await runContinuousLoop();
  }

  if (reconciliationTimer) {
    clearInterval(reconciliationTimer);
  }
  weeklyResetTask?.stop();
}

async function shutdown(signal: string): Promise<void> {
  shuttingDown = true;
  console.log(`[leaderboard-worker] shutdown signal received: ${signal}`);

  try {
    if (redisClient) {
      redisClient.disconnect();
    }
  } catch {
    // ignore
  }

  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

start().catch(async (error) => {
  console.error('[leaderboard-worker] fatal error', error);
  await shutdown('FATAL');
});

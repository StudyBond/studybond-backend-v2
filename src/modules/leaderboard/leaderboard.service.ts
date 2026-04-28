import prisma from '../../config/database';
import { getCacheAdapter } from '../../shared/cache/cache';
import { NotFoundError } from '../../shared/errors/NotFoundError';
import { ValidationError } from '../../shared/errors/ValidationError';
import { getGlobalMetricsRegistry } from '../../shared/metrics/global';
import {
  applyProjectionSnapshotToRedis,
  buildLeaderboardRedisKeys,
  clearWeeklyProjectionKeys,
  getProjectionReadConfig,
  isLeaderboardProjectionEnabled
} from '../../shared/leaderboard/projection';
import { institutionContextService, ResolvedInstitutionContext } from '../../shared/institutions/context';
import { deleteCachedLeaderboard, fetchWithLeaderboardCache } from './cache';
import { compareLeaderboardRows } from './leaderboard.ordering';
import { hasBoundaryTieAmbiguity } from './leaderboard.projection';
import {
  LeaderboardEntry,
  LeaderboardInstitution,
  LeaderboardResponse,
  LeaderboardType,
  MyRankResponse
} from './leaderboard.types';

const DAY_MS = 24 * 60 * 60 * 1000;
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

function readPositiveInt(envValue: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(envValue || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

interface LeaderboardUserRow {
  id: number;
  fullName: string;
  weeklySp: number;
  totalSp: number;
}

interface WeeklyResetResult {
  weekStartDate: string;
  weekEndDate: string;
  resetUsers: number;
  skipped: boolean;
}

interface LeaderboardReadPayload {
  rows: LeaderboardUserRow[];
  totalParticipants: number;
  generatedAt: string;
}

interface ScopedLeaderboardStatsRow {
  userId: number;
  weeklySp: number;
  totalSp: number;
  user: {
    fullName: string;
  };
}

interface ScopedWeeklyResetRow {
  userId: number;
  institutionId: number;
  totalSp: number;
  user: {
    fullName: string;
  };
}

export function getLagosPreviousWeekBounds(referenceDate: Date = new Date()): { weekStartDate: string; weekEndDate: string } {
  const lagosShifted = new Date(referenceDate.getTime() + LAGOS_OFFSET_MS);
  lagosShifted.setUTCHours(0, 0, 0, 0);

  const dayOfWeek = lagosShifted.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;

  const currentWeekStart = new Date(lagosShifted.getTime() - (daysSinceMonday * DAY_MS));
  const previousWeekStart = new Date(currentWeekStart.getTime() - (7 * DAY_MS));
  const previousWeekEnd = new Date(currentWeekStart.getTime() - DAY_MS);

  return {
    weekStartDate: previousWeekStart.toISOString().slice(0, 10),
    weekEndDate: previousWeekEnd.toISOString().slice(0, 10)
  };
}

export class LeaderboardService {
  private static readonly DEFAULT_LIMIT = readPositiveInt(process.env.LEADERBOARD_DEFAULT_LIMIT, 50);
  private static readonly MAX_LIMIT = readPositiveInt(process.env.LEADERBOARD_MAX_LIMIT, 50);
  private static readonly CACHE_TTL_SECONDS = readPositiveInt(process.env.LEADERBOARD_CACHE_TTL_SECONDS, 60);

  private normalizeLimit(limit?: number): number {
    const maxLimit = Math.max(1, LeaderboardService.MAX_LIMIT);
    const defaultLimit = Math.min(LeaderboardService.DEFAULT_LIMIT, maxLimit);
    const chosen = limit ?? defaultLimit;

    if (!Number.isInteger(chosen) || chosen < 1) {
      throw new ValidationError('Leaderboard limit must be a positive integer.');
    }

    if (chosen > maxLimit) {
      throw new ValidationError(`Leaderboard limit cannot exceed ${maxLimit}.`);
    }

    return chosen;
  }

  private buildCacheKey(institutionId: number, type: LeaderboardType, limit: number): string {
    return `leaderboard:${institutionId}:${type}:top:${limit}`;
  }

  private mapInstitution(institution: ResolvedInstitutionContext): LeaderboardInstitution {
    return {
      id: institution.id,
      code: institution.code,
      name: institution.name,
      slug: institution.slug
    };
  }

  private async resolveLeaderboardInstitution(
    userId: number,
    institutionCode?: string | null
  ): Promise<ResolvedInstitutionContext> {
    return institutionContextService.resolveForUser(userId, institutionCode);
  }

  private mapEntries(
    type: LeaderboardType,
    rows: LeaderboardUserRow[],
    currentUserId: number
  ): LeaderboardEntry[] {
    return rows.map((row, index) => ({
      rank: index + 1,
      userId: row.id,
      fullName: row.fullName,
      points: type === 'WEEKLY' ? row.weeklySp : row.totalSp,
      weeklySp: row.weeklySp,
      totalSp: row.totalSp,
      isCurrentUser: row.id === currentUserId
    }));
  }

  private metricCounter(name: string, labels?: Record<string, string | number | boolean>): void {
    getGlobalMetricsRegistry()?.incrementCounter(name, 1, labels);
  }

  private metricGauge(name: string, value: number, labels?: Record<string, string | number | boolean>): void {
    getGlobalMetricsRegistry()?.setGauge(name, value, labels);
  }

  private async queryWeeklyTop(
    institutionId: number,
    limit: number
  ): Promise<{ rows: LeaderboardUserRow[]; totalParticipants: number }> {
    const [rows, totalParticipants] = await Promise.all([
      prisma.userInstitutionStats.findMany({
        where: {
          institutionId,
          weeklySp: { gt: 0 }
        },
        orderBy: [
          { weeklySp: 'desc' },
          { totalSp: 'desc' },
          { userId: 'asc' }
        ],
        take: limit,
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
      }),
      prisma.userInstitutionStats.count({
        where: {
          institutionId,
          weeklySp: { gt: 0 }
        }
      })
    ]);

    return {
      rows: rows.map((row: ScopedLeaderboardStatsRow) => ({
        id: row.userId,
        fullName: row.user.fullName,
        weeklySp: row.weeklySp,
        totalSp: row.totalSp
      })),
      totalParticipants
    };
  }

  private async queryAllTimeTop(
    institutionId: number,
    limit: number
  ): Promise<{ rows: LeaderboardUserRow[]; totalParticipants: number }> {
    const [rows, totalParticipants] = await Promise.all([
      prisma.userInstitutionStats.findMany({
        where: {
          institutionId,
          totalSp: { gt: 0 }
        },
        orderBy: [
          { totalSp: 'desc' },
          { weeklySp: 'desc' },
          { userId: 'asc' }
        ],
        take: limit,
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
      }),
      prisma.userInstitutionStats.count({
        where: {
          institutionId,
          totalSp: { gt: 0 }
        }
      })
    ]);

    return {
      rows: rows.map((row: ScopedLeaderboardStatsRow) => ({
        id: row.userId,
        fullName: row.user.fullName,
        weeklySp: row.weeklySp,
        totalSp: row.totalSp
      })),
      totalParticipants
    };
  }

  private async warmProjectionRows(institutionId: number, rows: LeaderboardUserRow[]): Promise<void> {
    if (!isLeaderboardProjectionEnabled()) return;
    if (rows.length === 0) return;

    for (const row of rows) {
      try {
        await applyProjectionSnapshotToRedis({
          institutionId,
          userId: row.id,
          fullName: row.fullName,
          weeklySp: row.weeklySp,
          totalSp: row.totalSp,
          updatedAt: new Date().toISOString()
        });
      } catch {
        this.metricCounter('leaderboard_redis_miss_total', { reason: 'warm_failed' });
        return;
      }
    }
  }

  private async tryReadFromRedisProjection(
    type: LeaderboardType,
    currentUserId: number,
    limit: number,
    institution: ResolvedInstitutionContext
  ): Promise<LeaderboardResponse | null> {
    const config = getProjectionReadConfig();
    if (!config.enabled || !config.redisReadEnabled) return null;

    const cache = getCacheAdapter();
    if (
      !cache.available ||
      !cache.zrevrange ||
      !cache.hmget ||
      !cache.zcount ||
      !cache.zcard
    ) {
      this.metricCounter('leaderboard_redis_miss_total', { reason: 'cache_capability_missing' });
      return null;
    }

    const redisKeys = buildLeaderboardRedisKeys(institution.id);
    const zsetKey = type === 'WEEKLY' ? redisKeys.weeklyZSet : redisKeys.allTimeZSet;
    const requested = limit + Math.max(1, config.tieBuffer);

    const memberIds = await cache.zrevrange(zsetKey, 0, requested - 1);
    if (memberIds.length === 0) {
      this.metricCounter('leaderboard_redis_hit_total', { type, empty: true });
      return {
        type,
        institution: this.mapInstitution(institution),
        limit,
        generatedAt: new Date().toISOString(),
        totalParticipants: 0,
        entries: []
      };
    }

    const rawSnapshots = await cache.hmget(redisKeys.userHash, memberIds);
    const now = Date.now();
    const rows: LeaderboardUserRow[] = [];

    for (let index = 0; index < memberIds.length; index += 1) {
      const raw = rawSnapshots[index];
      if (!raw) {
        this.metricCounter('leaderboard_redis_miss_total', { reason: 'snapshot_missing' });
        return null;
      }

      let parsed: {
        institutionId: number;
        userId: number;
        fullName: string;
        weeklySp: number;
        totalSp: number;
        updatedAt: string;
      } | null = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        this.metricCounter('leaderboard_redis_miss_total', { reason: 'snapshot_parse_failed' });
        return null;
      }

      if (
        !parsed ||
        typeof parsed.institutionId !== 'number' ||
        typeof parsed.userId !== 'number' ||
        typeof parsed.fullName !== 'string' ||
        typeof parsed.weeklySp !== 'number' ||
        typeof parsed.totalSp !== 'number' ||
        typeof parsed.updatedAt !== 'string'
      ) {
        this.metricCounter('leaderboard_redis_miss_total', { reason: 'snapshot_invalid' });
        return null;
      }

      if (parsed.institutionId !== institution.id) {
        this.metricCounter('leaderboard_redis_miss_total', { reason: 'snapshot_scope_mismatch' });
        return null;
      }

      const stalenessMs = now - Date.parse(parsed.updatedAt);
      if (!Number.isFinite(stalenessMs) || stalenessMs > (config.staleSeconds * 1000)) {
        this.metricCounter('leaderboard_redis_miss_total', { reason: 'snapshot_stale' });
        return null;
      }

      rows.push({
        id: parsed.userId,
        fullName: parsed.fullName,
        weeklySp: parsed.weeklySp,
        totalSp: parsed.totalSp
      });
    }

    const sorted = [...rows].sort((left, right) => compareLeaderboardRows(type, left, right));
    if (sorted.length < limit) {
      this.metricCounter('leaderboard_redis_miss_total', { reason: 'insufficient_candidates' });
      return null;
    }

    const primaryScore = type === 'WEEKLY'
      ? sorted[limit - 1].weeklySp
      : sorted[limit - 1].totalSp;
    const projectedPrimaryScores = sorted.map((row) => (
      type === 'WEEKLY' ? row.weeklySp : row.totalSp
    ));
    const globalBoundaryCount = await cache.zcount(
      zsetKey,
      String(primaryScore),
      String(primaryScore)
    );

    if (hasBoundaryTieAmbiguity(projectedPrimaryScores, primaryScore, globalBoundaryCount)) {
      this.metricCounter('leaderboard_redis_miss_total', { reason: 'tie_ambiguity' });
      return null;
    }

    const totalParticipants = await cache.zcard(zsetKey);
    this.metricCounter('leaderboard_redis_hit_total', { type });

    return {
      type,
      institution: this.mapInstitution(institution),
      limit,
      generatedAt: new Date().toISOString(),
      totalParticipants,
      entries: this.mapEntries(type, sorted.slice(0, limit), currentUserId)
    };
  }

  async getWeeklyLeaderboard(
    currentUserId: number,
    institutionCode?: string | null,
    limit?: number
  ): Promise<LeaderboardResponse> {
    const normalizedLimit = this.normalizeLimit(limit);
    const institution = await this.resolveLeaderboardInstitution(currentUserId, institutionCode);

    const projected = await this.tryReadFromRedisProjection('WEEKLY', currentUserId, normalizedLimit, institution);
    if (projected) return projected;
    this.metricCounter('leaderboard_db_fallback_total', { type: 'WEEKLY', institutionId: institution.id });

    const cacheKey = this.buildCacheKey(institution.id, 'WEEKLY', normalizedLimit);
    const payload = await fetchWithLeaderboardCache(cacheKey, LeaderboardService.CACHE_TTL_SECONDS, async () => {
      const { rows, totalParticipants } = await this.queryWeeklyTop(institution.id, normalizedLimit);
      return {
        rows,
        totalParticipants,
        generatedAt: new Date().toISOString()
      } as LeaderboardReadPayload;
    });

    await this.warmProjectionRows(institution.id, payload.rows);

    return {
      type: 'WEEKLY',
      institution: this.mapInstitution(institution),
      limit: normalizedLimit,
      generatedAt: payload.generatedAt,
      totalParticipants: payload.totalParticipants,
      entries: this.mapEntries('WEEKLY', payload.rows, currentUserId)
    };
  }

  async getAllTimeLeaderboard(
    currentUserId: number,
    institutionCode?: string | null,
    limit?: number
  ): Promise<LeaderboardResponse> {
    const normalizedLimit = this.normalizeLimit(limit);
    const institution = await this.resolveLeaderboardInstitution(currentUserId, institutionCode);

    const projected = await this.tryReadFromRedisProjection('ALL_TIME', currentUserId, normalizedLimit, institution);
    if (projected) return projected;
    this.metricCounter('leaderboard_db_fallback_total', { type: 'ALL_TIME', institutionId: institution.id });

    const cacheKey = this.buildCacheKey(institution.id, 'ALL_TIME', normalizedLimit);
    const payload = await fetchWithLeaderboardCache(cacheKey, LeaderboardService.CACHE_TTL_SECONDS, async () => {
      const { rows, totalParticipants } = await this.queryAllTimeTop(institution.id, normalizedLimit);
      return {
        rows,
        totalParticipants,
        generatedAt: new Date().toISOString()
      } as LeaderboardReadPayload;
    });

    await this.warmProjectionRows(institution.id, payload.rows);

    return {
      type: 'ALL_TIME',
      institution: this.mapInstitution(institution),
      limit: normalizedLimit,
      generatedAt: payload.generatedAt,
      totalParticipants: payload.totalParticipants,
      entries: this.mapEntries('ALL_TIME', payload.rows, currentUserId)
    };
  }

  async getMyRank(userId: number, institutionCode?: string | null): Promise<MyRankResponse> {
    const institution = await this.resolveLeaderboardInstitution(userId, institutionCode);
    const [user, scopedStats, weeklyParticipants, allTimeParticipants] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          fullName: true
        }
      }),
      prisma.userInstitutionStats.findUnique({
        where: {
          userId_institutionId: {
            userId,
            institutionId: institution.id
          }
        },
        select: {
          weeklySp: true,
          totalSp: true
        }
      }),
      prisma.userInstitutionStats.count({
        where: {
          institutionId: institution.id,
          weeklySp: { gt: 0 }
        }
      }),
      prisma.userInstitutionStats.count({
        where: {
          institutionId: institution.id,
          totalSp: { gt: 0 }
        }
      })
    ]);

    if (!user) {
      throw new NotFoundError('User profile could not be found for leaderboard rank.');
    }

    const userWeeklySp = scopedStats?.weeklySp ?? 0;
    const userTotalSp = scopedStats?.totalSp ?? 0;

    let weeklyRank: number | null = null;
    if (userWeeklySp > 0) {
      const weeklyAhead = await prisma.userInstitutionStats.count({
        where: {
          institutionId: institution.id,
          OR: [
            { weeklySp: { gt: userWeeklySp } },
            { weeklySp: userWeeklySp, totalSp: { gt: userTotalSp } },
            { weeklySp: userWeeklySp, totalSp: userTotalSp, userId: { lt: user.id } }
          ]
        }
      });
      weeklyRank = weeklyAhead + 1;
    }

    let allTimeRank: number | null = null;
    if (userTotalSp > 0) {
      const allTimeAhead = await prisma.userInstitutionStats.count({
        where: {
          institutionId: institution.id,
          OR: [
            { totalSp: { gt: userTotalSp } },
            { totalSp: userTotalSp, weeklySp: { gt: userWeeklySp } },
            { totalSp: userTotalSp, weeklySp: userWeeklySp, userId: { lt: user.id } }
          ]
        }
      });
      allTimeRank = allTimeAhead + 1;
    }

    return {
      institution: this.mapInstitution(institution),
      user: {
        id: user.id,
        fullName: user.fullName,
        weeklySp: userWeeklySp,
        totalSp: userTotalSp
      },
      weekly: {
        rank: weeklyRank,
        points: userWeeklySp,
        totalParticipants: weeklyParticipants
      },
      allTime: {
        rank: allTimeRank,
        points: userTotalSp,
        totalParticipants: allTimeParticipants
      }
    };
  }

  async runWeeklyReset(referenceDate: Date = new Date()): Promise<WeeklyResetResult> {
    const { weekStartDate, weekEndDate } = getLagosPreviousWeekBounds(referenceDate);
    const cache = getCacheAdapter();
    const owner = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const lockKey = `jobs:leaderboard:weekly-reset:${weekStartDate}`;

    let lockAcquired = true;
    if (cache.available) {
      try {
        lockAcquired = await cache.acquireLock(lockKey, owner, 600);
      } catch {
        lockAcquired = true;
      }
    }

    if (!lockAcquired) {
      return {
        weekStartDate,
        weekEndDate,
        resetUsers: 0,
        skipped: true
      };
    }

    try {
      const resetResult = await prisma.$transaction(async (tx: any) => {
        const [usersToReset, scopedRowsToReset] = await Promise.all([
          tx.user.findMany({
            where: {
              weeklySp: { gt: 0 }
            },
            select: {
              id: true
            }
          }),
          tx.userInstitutionStats.findMany({
            where: {
              weeklySp: { gt: 0 }
            },
            select: {
              userId: true,
              institutionId: true,
              totalSp: true,
              user: {
                select: {
                  fullName: true
                }
              }
            }
          })
        ]);

        await tx.$executeRawUnsafe(
          `
          INSERT INTO "WeeklyLeaderboard"
            ("userId", "institutionId", "weekStartDate", "weekEndDate", "weeklySp", "rank", "createdAt")
          SELECT
            s."userId",
            s."institutionId",
            $1::date,
            $2::date,
            s."weeklySp",
            ROW_NUMBER() OVER (
              PARTITION BY s."institutionId"
              ORDER BY s."weeklySp" DESC, s."totalSp" DESC, s."userId" ASC
            ),
            NOW()
          FROM "UserInstitutionStats" s
          WHERE s."institutionId" IS NOT NULL
            AND s."weeklySp" > 0
          ON CONFLICT ("userId", "institutionId", "weekStartDate")
          DO UPDATE SET
            "weekEndDate" = EXCLUDED."weekEndDate",
            "weeklySp" = EXCLUDED."weeklySp",
            "rank" = EXCLUDED."rank"
          `,
          weekStartDate,
          weekEndDate
        );

        if (usersToReset.length > 0) {
          await tx.user.updateMany({
            where: {
              id: { in: usersToReset.map((user: { id: number }) => user.id) }
            },
            data: {
              weeklySp: 0
            }
          });
        }

        if (scopedRowsToReset.length > 0) {
          await tx.userInstitutionStats.updateMany({
            where: {
              weeklySp: { gt: 0 }
            },
            data: {
              weeklySp: 0
            }
          });

          if (isLeaderboardProjectionEnabled()) {
            await tx.leaderboardProjectionEvent.createMany({
              data: scopedRowsToReset.map((row: ScopedWeeklyResetRow) => ({
                userId: row.userId,
                institutionId: row.institutionId,
                weeklySp: 0,
                totalSp: row.totalSp,
                source: 'WEEKLY_RESET'
              }))
            });
          }
        }

        return {
          resetUsers: usersToReset.length,
          scopedRowsToReset,
          touchedInstitutionIds: Array.from(
            new Set(scopedRowsToReset.map((row: ScopedWeeklyResetRow) => row.institutionId))
          )
        };
      });

      if (isLeaderboardProjectionEnabled() && resetResult.scopedRowsToReset.length > 0) {
        await Promise.all(
          resetResult.scopedRowsToReset.map((row: ScopedWeeklyResetRow) => applyProjectionSnapshotToRedis({
            institutionId: row.institutionId,
            userId: row.userId,
            fullName: row.user.fullName,
            weeklySp: 0,
            totalSp: row.totalSp,
            updatedAt: new Date().toISOString()
          }))
        );

        getGlobalMetricsRegistry()?.incrementCounter(
          'leaderboard_projection_events_total',
          resetResult.scopedRowsToReset.length,
          { status: 'queued' }
        );
      }

      await clearWeeklyProjectionKeys(resetResult.touchedInstitutionIds);
      await this.invalidateLeaderboardCaches(resetResult.touchedInstitutionIds);
      this.metricGauge('leaderboard_projection_lag_seconds', 0, { phase: 'weekly_reset' });

      return {
        weekStartDate,
        weekEndDate,
        resetUsers: resetResult.resetUsers,
        skipped: false
      };
    } finally {
      if (cache.available) {
        try {
          await cache.releaseLock(lockKey, owner);
        } catch {
          // Lock TTL handles eventual release.
        }
      }
    }
  }

  private async invalidateLeaderboardCaches(institutionIds: number[]): Promise<void> {
    if (institutionIds.length === 0) return;

    const maxLimit = Math.max(1, LeaderboardService.MAX_LIMIT);
    const tasks: Array<Promise<void>> = [];

    for (const institutionId of institutionIds) {
      for (let limit = 1; limit <= maxLimit; limit += 1) {
        tasks.push(deleteCachedLeaderboard(this.buildCacheKey(institutionId, 'WEEKLY', limit)));
        tasks.push(deleteCachedLeaderboard(this.buildCacheKey(institutionId, 'ALL_TIME', limit)));
      }
    }

    await Promise.all(tasks);
  }
}

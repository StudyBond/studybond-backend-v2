import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { ADMIN_ANALYTICS_CONFIG } from '../../config/constants';
import { ResolvedInstitutionContext, institutionContextService } from '../../shared/institutions/context';
import { getProjectionReadConfig, isLeaderboardProjectionEnabled } from '../../shared/leaderboard/projection';
import { getGlobalMetricsRegistry } from '../../shared/metrics/global';
import { addLagosDateDays, deriveStreakSnapshot, getLagosDateKey, getLagosDateValue, getLagosDayDifference, getLagosDayStart } from '../../shared/streaks/domain';
import { hasRoleAtLeast } from '../../shared/decorators/requireAdmin';
import { ForbiddenError } from '../../shared/errors/ForbiddenError';
import { NotFoundError } from '../../shared/errors/NotFoundError';
import { auditService } from './audit.service';
import { buildPremiumCoverageStateTx } from './premium-coverage';
import type {
    AdminActivityResponse,
    AdminActivityPoint,
    AdminOverviewResponse,
    AdminPremiumInsightsResponse,
    AdminPremiumPoint,
    AdminSystemHealthResponse,
    AdminUser360Response
} from './admin.types';

type DailyCountRow = {
    day: string;
    count: bigint | number | string;
};

type DailyRevenueRow = {
    day: string;
    count: bigint | number | string;
    revenue: unknown;
};

type QuestionPoolCountRow = {
    questionPool: 'FREE_EXAM' | 'REAL_BANK' | 'PRACTICE';
    _count: {
        _all: number;
    };
};

type DailyRollupRow = {
    date: Date;
    newUsers: number;
    examsStarted: number;
    examsCompleted: number;
    collaborationSessions: number;
    successfulPayments: number;
    successfulRevenueNaira: Prisma.Decimal | number | string | bigint;
    manualPremiumGrants: number;
    promotionalPremiumGrants: number;
    correctivePremiumGrants: number;
    premiumRevocations: number;
    updatedAt: Date;
};

function toNumber(value: unknown): number {
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    if (value && typeof value === 'object' && 'toString' in value) {
        const parsed = Number(String(value));
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

function subtractDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() - days);
    return next;
}

function buildDailyKeys(days: number, now = new Date()): string[] {
    const today = getLagosDateValue(now);
    const start = addLagosDateDays(today, -(days - 1));
    return Array.from({ length: days }, (_, index) => getLagosDateKey(addLagosDateDays(start, index)));
}

function buildDailyBase(days: number): Record<string, number> {
    return Object.fromEntries(buildDailyKeys(days).map((key) => [key, 0]));
}

function mergeDailyCounts(days: number, rows: DailyCountRow[]): Record<string, number> {
    const base = buildDailyBase(days);
    for (const row of rows) {
        if (!row.day) continue;
        base[row.day] = toNumber(row.count);
    }
    return base;
}

function mergeDailyRevenue(days: number, rows: DailyRevenueRow[]): Record<string, { count: number; revenue: number }> {
    const base = Object.fromEntries(buildDailyKeys(days).map((key) => [key, { count: 0, revenue: 0 }]));
    for (const row of rows) {
        if (!row.day) continue;
        base[row.day] = {
            count: toNumber(row.count),
            revenue: toNumber(row.revenue)
        };
    }
    return base;
}

function sumValues(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

function sumDecimals(values: Array<number | string | bigint | Prisma.Decimal>): number {
    return values.reduce<number>((total, value) => total + toNumber(value), 0);
}

function isCompleteRollupWindow(days: number, rows: DailyRollupRow[]): boolean {
    if (rows.length !== days) {
        return false;
    }

    const expectedKeys = new Set(buildDailyKeys(days));
    for (const row of rows) {
        expectedKeys.delete(getLagosDateKey(row.date));
    }

    return expectedKeys.size === 0;
}

export class AdminAnalyticsService {
    private async resolveInstitutionScope(
        actorId: number,
        institutionCode?: string | null
    ): Promise<ResolvedInstitutionContext | null> {
        if (!institutionCode) {
            return null;
        }

        return institutionContextService.resolveForUser(actorId, institutionCode);
    }

    private async assertAdminReadAccess(
        actorId: number,
        actorRole: string,
        attemptedAction: string
    ): Promise<void> {
        if (hasRoleAtLeast(actorRole, 'ADMIN')) {
            return;
        }

        await auditService.logUnauthorizedAttempt(
            actorId,
            actorRole,
            attemptedAction,
            'SYSTEM'
        );
        throw new ForbiddenError('Admin access is required for this action.');
    }

    private async assertSuperadminReadAccess(
        actorId: number,
        actorRole: string,
        attemptedAction: string
    ): Promise<void> {
        if (actorRole === 'SUPERADMIN') {
            return;
        }

        await auditService.logUnauthorizedAttempt(
            actorId,
            actorRole,
            attemptedAction,
            'SYSTEM'
        );
        throw new ForbiddenError('Superadmin access is required for this action.');
    }

    private async measure<T>(endpoint: string, actorRole: string, compute: () => Promise<T>): Promise<T> {
        const metrics = getGlobalMetricsRegistry();
        const startedAt = Date.now();
        try {
            return await compute();
        } finally {
            const elapsedMs = Date.now() - startedAt;
            metrics?.incrementCounter('admin_requests_total', 1, { endpoint, actorRole });
            metrics?.observeHistogram('admin_dashboard_query_duration_ms', elapsedMs, { endpoint });
        }
    }

    private async getRollupsForWindow(days: number, now = new Date()): Promise<DailyRollupRow[] | null> {
        const today = getLagosDateValue(now);
        const start = addLagosDateDays(today, -(days - 1));
        const rows = await prisma.adminAnalyticsDailyRollup.findMany({
            where: {
                date: {
                    gte: start,
                    lte: today
                }
            },
            select: {
                date: true,
                newUsers: true,
                examsStarted: true,
                examsCompleted: true,
                collaborationSessions: true,
                successfulPayments: true,
                successfulRevenueNaira: true,
                manualPremiumGrants: true,
                promotionalPremiumGrants: true,
                correctivePremiumGrants: true,
                premiumRevocations: true,
                updatedAt: true
            },
            orderBy: { date: 'asc' }
        });

        return isCompleteRollupWindow(days, rows) ? rows : null;
    }

    private buildActivityFromRollups(days: number, rows: DailyRollupRow[], now: Date): AdminActivityResponse {
        const rowByDate = new Map(rows.map((row) => [getLagosDateKey(row.date), row]));
        const daily = buildDailyKeys(days).map((date): AdminActivityPoint => {
            const row = rowByDate.get(date);
            return {
                date,
                newUsers: row?.newUsers ?? 0,
                examStarts: row?.examsStarted ?? 0,
                examCompletions: row?.examsCompleted ?? 0,
                collaborationSessions: row?.collaborationSessions ?? 0,
                paidPremiumActivations: row?.successfulPayments ?? 0,
                manualPremiumGrants: row?.manualPremiumGrants ?? 0
            };
        });

        return {
            generatedAt: now,
            institution: null,
            windowDays: days,
            dataSource: 'ROLLUP',
            summary: {
                newUsers: sumValues(daily.map((point) => point.newUsers)),
                examStarts: sumValues(daily.map((point) => point.examStarts)),
                examCompletions: sumValues(daily.map((point) => point.examCompletions)),
                collaborationSessions: sumValues(daily.map((point) => point.collaborationSessions)),
                paidPremiumActivations: sumValues(daily.map((point) => point.paidPremiumActivations)),
                manualPremiumGrants: sumValues(daily.map((point) => point.manualPremiumGrants))
            },
            daily
        };
    }

    private buildPremiumFromRollups(
        days: number,
        rows: DailyRollupRow[],
        now: Date,
        current: AdminPremiumInsightsResponse['current'],
        reusableAuthorizations: number
    ): AdminPremiumInsightsResponse {
        const rowByDate = new Map(rows.map((row) => [getLagosDateKey(row.date), row]));
        const daily = buildDailyKeys(days).map((date): AdminPremiumPoint => {
            const row = rowByDate.get(date);
            return {
                date,
                successfulPayments: row?.successfulPayments ?? 0,
                revenueNaira: toNumber(row?.successfulRevenueNaira ?? 0),
                manualGrants: row?.manualPremiumGrants ?? 0,
                revocations: row?.premiumRevocations ?? 0
            };
        });

        return {
            generatedAt: now,
            windowDays: days,
            dataSource: 'ROLLUP',
            current,
            revenue: {
                successfulPayments: sumValues(rows.map((row) => row.successfulPayments)),
                successfulRevenueNaira: sumDecimals(rows.map((row) => row.successfulRevenueNaira)),
                reusableAuthorizations
            },
            adminActions: {
                manualGrants: sumValues(rows.map((row) => row.manualPremiumGrants)),
                promotionalGrants: sumValues(rows.map((row) => row.promotionalPremiumGrants)),
                correctiveGrants: sumValues(rows.map((row) => row.correctivePremiumGrants)),
                revocations: sumValues(rows.map((row) => row.premiumRevocations))
            },
            daily
        };
    }

    async getOverview(
        actorId: number,
        actorRole: string,
        institutionCode?: string | null
    ): Promise<AdminOverviewResponse> {
        await this.assertAdminReadAccess(actorId, actorRole, 'GET_ADMIN_ANALYTICS_OVERVIEW');

        return this.measure('overview', actorRole, async () => {
            const now = new Date();
            const last7Days = subtractDays(now, 7);
            const last30Days = subtractDays(now, 30);
            const next7Days = subtractDays(now, -7);
            const next30Days = subtractDays(now, -30);
            const last24Hours = subtractDays(now, 1);
            const institution = await this.resolveInstitutionScope(actorId, institutionCode);

            const scopedExamWhere = institution ? { institutionId: institution.id } : {};
            const scopedCollaborationWhere = institution ? { institutionId: institution.id } : {};
            const scopedQuestionWhere = institution ? { institutionId: institution.id } : {};

            const [
                totalUsers,
                verifiedUsers,
                bannedUsers,
                admins,
                superadmins,
                newUsers7Days,
                newUsers30Days,
                activePremiumUsers,
                activePaidSubscriptions,
                activeAdminEntitlements,
                expiringIn7Days,
                expiringIn30Days,
                activeSessions,
                activeStreakUsers,
                examsInProgress,
                examsStartedLast7Days,
                examsCompletedLast7Days,
                collaborationWaiting,
                collaborationInProgress,
                collaborationCreatedLast7Days,
                questionPoolCounts,
                pendingReports,
                leaderboardSignalsLast24Hours,
                pendingStepUpChallenges,
                adminActionsLast24Hours,
                recentEmailFailuresLast24Hours
            ] = await Promise.all([
                prisma.user.count(),
                prisma.user.count({ where: { isVerified: true } }),
                prisma.user.count({ where: { isBanned: true } }),
                prisma.user.count({ where: { role: 'ADMIN' } }),
                prisma.user.count({ where: { role: 'SUPERADMIN' } }),
                prisma.user.count({ where: { createdAt: { gte: last7Days } } }),
                prisma.user.count({ where: { createdAt: { gte: last30Days } } }),
                prisma.user.count({ where: { isPremium: true } }),
                prisma.subscription.count({
                    where: {
                        status: 'ACTIVE',
                        endDate: { gt: now }
                    }
                }),
                prisma.premiumEntitlement.count({
                    where: {
                        status: 'ACTIVE',
                        endsAt: { gt: now }
                    }
                }),
                prisma.user.count({
                    where: {
                        isPremium: true,
                        subscriptionEndDate: {
                            gt: now,
                            lte: next7Days
                        }
                    }
                }),
                prisma.user.count({
                    where: {
                        isPremium: true,
                        subscriptionEndDate: {
                            gt: now,
                            lte: next30Days
                        }
                    }
                }),
                prisma.userSession.count({
                    where: {
                        isActive: true,
                        OR: [
                            { expiresAt: null },
                            { expiresAt: { gt: now } }
                        ]
                    }
                }),
                prisma.user.count({
                    where: {
                        currentStreak: { gt: 0 }
                    }
                }),
                prisma.exam.count({
                    where: {
                        ...scopedExamWhere,
                        status: 'IN_PROGRESS'
                    }
                }),
                prisma.exam.count({
                    where: {
                        ...scopedExamWhere,
                        startedAt: { gte: last7Days }
                    }
                }),
                prisma.exam.count({
                    where: {
                        ...scopedExamWhere,
                        status: 'COMPLETED',
                        completedAt: { gte: last7Days }
                    }
                }),
                prisma.collaborationSession.count({
                    where: {
                        ...scopedCollaborationWhere,
                        status: 'WAITING'
                    }
                }),
                prisma.collaborationSession.count({
                    where: {
                        ...scopedCollaborationWhere,
                        status: 'IN_PROGRESS'
                    }
                }),
                prisma.collaborationSession.count({
                    where: {
                        ...scopedCollaborationWhere,
                        createdAt: { gte: last7Days }
                    }
                }),
                prisma.question.groupBy({
                    where: scopedQuestionWhere,
                    by: ['questionPool'],
                    _count: { _all: true }
                }),
                prisma.questionReport.count({
                    where: institution
                        ? {
                            status: 'PENDING',
                            question: {
                                institutionId: institution.id
                            }
                        }
                        : { status: 'PENDING' }
                }),
                prisma.leaderboardIntegritySignal.count({
                    where: institution
                        ? {
                            institutionId: institution.id,
                            createdAt: { gte: last24Hours }
                        }
                        : { createdAt: { gte: last24Hours } }
                }),
                prisma.adminStepUpChallenge.count({
                    where: {
                        otpExpiresAt: { gt: now },
                        verifiedAt: null
                    }
                }),
                prisma.adminAuditLog.count({ where: { createdAt: { gte: last24Hours } } }),
                prisma.emailLog.count({
                    where: {
                        sentAt: { gte: last24Hours },
                        status: { notIn: ['sent', 'delivered'] }
                    }
                })
            ]);

            const typedQuestionPoolCounts = questionPoolCounts as QuestionPoolCountRow[];
            const totalQuestions = typedQuestionPoolCounts.reduce((sum, row) => sum + row._count._all, 0);
            const countByPool = Object.fromEntries(
                typedQuestionPoolCounts.map((row) => [row.questionPool, row._count._all] as const)
            ) as Record<QuestionPoolCountRow['questionPool'], number>;

            return {
                generatedAt: now,
                institution,
                users: {
                    total: totalUsers,
                    verified: verifiedUsers,
                    banned: bannedUsers,
                    admins,
                    superadmins,
                    newLast7Days: newUsers7Days,
                    newLast30Days: newUsers30Days
                },
                premium: {
                    activeUsers: activePremiumUsers,
                    activePaidSubscriptions,
                    activeAdminEntitlements,
                    expiringIn7Days,
                    expiringIn30Days
                },
                engagement: {
                    activeSessions,
                    usersWithActiveStreak: activeStreakUsers,
                    examsInProgress,
                    examsStartedLast7Days,
                    examsCompletedLast7Days,
                    collaborationWaiting,
                    collaborationInProgress,
                    collaborationCreatedLast7Days
                },
                content: {
                    totalQuestions,
                    freeExamQuestions: countByPool.FREE_EXAM ?? 0,
                    realUiQuestions: countByPool.REAL_BANK ?? 0,
                    practiceQuestions: countByPool.PRACTICE ?? 0,
                    pendingReports
                },
                risk: {
                    leaderboardSignalsLast24Hours,
                    pendingStepUpChallenges,
                    adminActionsLast24Hours,
                    recentEmailFailuresLast24Hours
                }
            };
        });
    }

    async getActivity(
        actorId: number,
        actorRole: string,
        days: number,
        institutionCode?: string | null
    ): Promise<AdminActivityResponse> {
        await this.assertAdminReadAccess(actorId, actorRole, 'GET_ADMIN_ANALYTICS_ACTIVITY');

        return this.measure('activity', actorRole, async () => {
            const now = new Date();
            const institution = await this.resolveInstitutionScope(actorId, institutionCode);
            const rollups = institution ? null : await this.getRollupsForWindow(days, now);
            if (rollups) {
                return this.buildActivityFromRollups(days, rollups, now);
            }

            const windowStart = getLagosDayStart(addLagosDateDays(getLagosDateValue(now), -(days - 1)));
            const examInstitutionPredicate = institution
                ? Prisma.sql` AND "institutionId" = ${institution.id}`
                : Prisma.empty;
            const collaborationInstitutionPredicate = institution
                ? Prisma.sql` AND "institutionId" = ${institution.id}`
                : Prisma.empty;

            const [
                userRows,
                examStartRows,
                examCompletionRows,
                collaborationRows,
                paymentRows,
                grantRows
            ] = await Promise.all([
                prisma.$queryRaw<DailyCountRow[]>`
                    SELECT TO_CHAR((("createdAt" + interval '1 hour')::date), 'YYYY-MM-DD') AS "day",
                           COUNT(*)::bigint AS "count"
                    FROM "User"
                    WHERE "createdAt" >= ${windowStart}
                    GROUP BY 1
                    ORDER BY 1 ASC
                `,
                prisma.$queryRaw<DailyCountRow[]>`
                    SELECT TO_CHAR((("startedAt" + interval '1 hour')::date), 'YYYY-MM-DD') AS "day",
                           COUNT(*)::bigint AS "count"
                    FROM "Exam"
                    WHERE "startedAt" >= ${windowStart}
                      ${examInstitutionPredicate}
                    GROUP BY 1
                    ORDER BY 1 ASC
                `,
                prisma.$queryRaw<DailyCountRow[]>`
                    SELECT TO_CHAR((("completedAt" + interval '1 hour')::date), 'YYYY-MM-DD') AS "day",
                           COUNT(*)::bigint AS "count"
                    FROM "Exam"
                    WHERE "status" = 'COMPLETED'
                      AND "completedAt" IS NOT NULL
                      AND "completedAt" >= ${windowStart}
                      ${examInstitutionPredicate}
                    GROUP BY 1
                    ORDER BY 1 ASC
                `,
                prisma.$queryRaw<DailyCountRow[]>`
                    SELECT TO_CHAR((("createdAt" + interval '1 hour')::date), 'YYYY-MM-DD') AS "day",
                           COUNT(*)::bigint AS "count"
                    FROM "CollaborationSession"
                    WHERE "createdAt" >= ${windowStart}
                      ${collaborationInstitutionPredicate}
                    GROUP BY 1
                    ORDER BY 1 ASC
                `,
                prisma.$queryRaw<DailyCountRow[]>`
                    SELECT TO_CHAR((("paidAt" + interval '1 hour')::date), 'YYYY-MM-DD') AS "day",
                           COUNT(*)::bigint AS "count"
                    FROM "SubscriptionPayment"
                    WHERE "status" = 'SUCCESS'
                      AND "paidAt" IS NOT NULL
                      AND "paidAt" >= ${windowStart}
                    GROUP BY 1
                    ORDER BY 1 ASC
                `,
                prisma.$queryRaw<DailyCountRow[]>`
                    SELECT TO_CHAR((("createdAt" + interval '1 hour')::date), 'YYYY-MM-DD') AS "day",
                           COUNT(*)::bigint AS "count"
                    FROM "PremiumEntitlement"
                    WHERE "kind" = 'MANUAL'
                      AND "createdAt" >= ${windowStart}
                    GROUP BY 1
                    ORDER BY 1 ASC
                `
            ]);

            const userSeries = mergeDailyCounts(days, userRows);
            const examStartSeries = mergeDailyCounts(days, examStartRows);
            const examCompletionSeries = mergeDailyCounts(days, examCompletionRows);
            const collaborationSeries = mergeDailyCounts(days, collaborationRows);
            const paymentSeries = mergeDailyCounts(days, paymentRows);
            const grantSeries = mergeDailyCounts(days, grantRows);

            const daily: AdminActivityPoint[] = buildDailyKeys(days).map((date) => ({
                date,
                newUsers: userSeries[date] ?? 0,
                examStarts: examStartSeries[date] ?? 0,
                examCompletions: examCompletionSeries[date] ?? 0,
                collaborationSessions: collaborationSeries[date] ?? 0,
                paidPremiumActivations: paymentSeries[date] ?? 0,
                manualPremiumGrants: grantSeries[date] ?? 0
            }));

            return {
                generatedAt: now,
                institution,
                windowDays: days,
                dataSource: 'LIVE',
                summary: {
                    newUsers: sumValues(daily.map((point) => point.newUsers)),
                    examStarts: sumValues(daily.map((point) => point.examStarts)),
                    examCompletions: sumValues(daily.map((point) => point.examCompletions)),
                    collaborationSessions: sumValues(daily.map((point) => point.collaborationSessions)),
                    paidPremiumActivations: sumValues(daily.map((point) => point.paidPremiumActivations)),
                    manualPremiumGrants: sumValues(daily.map((point) => point.manualPremiumGrants))
                },
                daily
            };
        });
    }

    async getPremiumInsights(actorId: number, actorRole: string, days: number): Promise<AdminPremiumInsightsResponse> {
        await this.assertSuperadminReadAccess(actorId, actorRole, 'GET_ADMIN_ANALYTICS_PREMIUM');

        return this.measure('premium', actorRole, async () => {
            const now = new Date();
            const next7Days = subtractDays(now, -7);
            const next30Days = subtractDays(now, -30);
            const windowStart = getLagosDayStart(addLagosDateDays(getLagosDateValue(now), -(days - 1)));
            const rollups = await this.getRollupsForWindow(days, now);

            const [
                activePremiumUsers,
                activePaidSubscriptions,
                activeAdminEntitlements,
                autoRenewEnabledSubscriptions,
                expiringIn7Days,
                expiringIn30Days,
                reusableAuthorizations
            ] = await Promise.all([
                prisma.user.count({ where: { isPremium: true } }),
                prisma.subscription.count({
                    where: {
                        status: 'ACTIVE',
                        endDate: { gt: now }
                    }
                }),
                prisma.premiumEntitlement.count({
                    where: {
                        status: 'ACTIVE',
                        endsAt: { gt: now }
                    }
                }),
                prisma.subscription.count({
                    where: {
                        status: 'ACTIVE',
                        endDate: { gt: now },
                        autoRenew: true
                    }
                }),
                prisma.user.count({
                    where: {
                        isPremium: true,
                        subscriptionEndDate: {
                            gt: now,
                            lte: next7Days
                        }
                    }
                }),
                prisma.user.count({
                    where: {
                        isPremium: true,
                        subscriptionEndDate: {
                            gt: now,
                            lte: next30Days
                        }
                    }
                }),
                prisma.subscriptionPayment.count({
                    where: {
                        status: 'SUCCESS',
                        paidAt: { gte: windowStart }
                    }
                }),
                prisma.subscriptionPayment.aggregate({
                    where: {
                        status: 'SUCCESS',
                        paidAt: { gte: windowStart }
                    },
                    _sum: {
                        amountPaid: true
                    }
                }),
                prisma.subscription.count({
                    where: {
                        authorizationReusable: true
                    }
                })
            ]);

            const current = {
                activePremiumUsers,
                activePaidSubscriptions,
                activeAdminEntitlements,
                autoRenewEnabledSubscriptions,
                expiringIn7Days,
                expiringIn30Days
            };

            if (rollups) {
                return this.buildPremiumFromRollups(days, rollups, now, current, reusableAuthorizations);
            }

            const [
                successfulPayments,
                successfulRevenue,
                manualGrants,
                promotionalGrants,
                correctiveGrants,
                revocations,
                paymentRows,
                grantRows,
                revocationRows
            ] = await Promise.all([
                prisma.subscriptionPayment.count({
                    where: {
                        status: 'SUCCESS',
                        paidAt: { gte: windowStart }
                    }
                }),
                prisma.subscriptionPayment.aggregate({
                    where: {
                        status: 'SUCCESS',
                        paidAt: { gte: windowStart }
                    },
                    _sum: {
                        amountPaid: true
                    }
                }),
                prisma.premiumEntitlement.count({
                    where: {
                        kind: 'MANUAL',
                        createdAt: { gte: windowStart }
                    }
                }),
                prisma.premiumEntitlement.count({
                    where: {
                        kind: 'PROMOTIONAL',
                        createdAt: { gte: windowStart }
                    }
                }),
                prisma.premiumEntitlement.count({
                    where: {
                        kind: 'CORRECTIVE',
                        createdAt: { gte: windowStart }
                    }
                }),
                prisma.premiumEntitlement.count({
                    where: {
                        revokedAt: { gte: windowStart }
                    }
                }),
                prisma.$queryRaw<DailyRevenueRow[]>`
                    SELECT TO_CHAR((("paidAt" + interval '1 hour')::date), 'YYYY-MM-DD') AS "day",
                           COUNT(*)::bigint AS "count",
                           COALESCE(SUM("amountPaid"), 0) AS "revenue"
                    FROM "SubscriptionPayment"
                    WHERE "status" = 'SUCCESS'
                      AND "paidAt" IS NOT NULL
                      AND "paidAt" >= ${windowStart}
                    GROUP BY 1
                    ORDER BY 1 ASC
                `,
                prisma.$queryRaw<DailyCountRow[]>`
                    SELECT TO_CHAR((("createdAt" + interval '1 hour')::date), 'YYYY-MM-DD') AS "day",
                           COUNT(*)::bigint AS "count"
                    FROM "PremiumEntitlement"
                    WHERE "kind" = 'MANUAL'
                      AND "createdAt" >= ${windowStart}
                    GROUP BY 1
                    ORDER BY 1 ASC
                `,
                prisma.$queryRaw<DailyCountRow[]>`
                    SELECT TO_CHAR((("revokedAt" + interval '1 hour')::date), 'YYYY-MM-DD') AS "day",
                           COUNT(*)::bigint AS "count"
                    FROM "PremiumEntitlement"
                    WHERE "revokedAt" IS NOT NULL
                      AND "revokedAt" >= ${windowStart}
                    GROUP BY 1
                    ORDER BY 1 ASC
                `
            ]);

            const paymentSeries = mergeDailyRevenue(days, paymentRows);
            const grantSeries = mergeDailyCounts(days, grantRows);
            const revocationSeries = mergeDailyCounts(days, revocationRows);

            const daily: AdminPremiumPoint[] = buildDailyKeys(days).map((date) => ({
                date,
                successfulPayments: paymentSeries[date]?.count ?? 0,
                revenueNaira: paymentSeries[date]?.revenue ?? 0,
                manualGrants: grantSeries[date] ?? 0,
                revocations: revocationSeries[date] ?? 0
            }));

            return {
                generatedAt: now,
                windowDays: days,
                dataSource: 'LIVE',
                current,
                revenue: {
                    successfulPayments,
                    successfulRevenueNaira: toNumber(successfulRevenue._sum.amountPaid),
                    reusableAuthorizations
                },
                adminActions: {
                    manualGrants,
                    promotionalGrants,
                    correctiveGrants,
                    revocations
                },
                daily
            };
        });
    }

    async getUser360(
        actorId: number,
        actorRole: string,
        userId: number,
        institutionCode?: string | null
    ): Promise<AdminUser360Response> {
        await this.assertAdminReadAccess(actorId, actorRole, 'GET_ADMIN_USER_360');

        return this.measure('user_360', actorRole, async () => {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    email: true,
                    fullName: true,
                    role: true,
                    isVerified: true,
                    isBanned: true,
                    bannedAt: true,
                    bannedReason: true,
                    aspiringCourse: true,
                    targetScore: true,
                    emailUnsubscribed: true,
                    createdAt: true,
                    updatedAt: true,
                    isPremium: true,
                    deviceAccessMode: true,
                    subscriptionEndDate: true,
                    totalSp: true,
                    weeklySp: true,
                    currentStreak: true,
                    longestStreak: true,
                    lastActivityDate: true,
                    streakFreezesAvailable: true,
                    realExamsCompleted: true,
                    completedCollaborationExams: true,
                    hasTakenFreeExam: true,
                    aiExplanationsUsedToday: true
                }
            });

            if (!user) {
                throw new NotFoundError('User not found.');
            }

            if (actorRole !== 'SUPERADMIN' && user.role !== 'USER') {
                await auditService.logUnauthorizedAttempt(
                    actorId,
                    actorRole,
                    'GET_ADMIN_USER_360',
                    'USER',
                    String(userId)
                );
                throw new ForbiddenError('Only superadmins can inspect admin or superadmin user profiles in the control center.');
            }

            const institution = await institutionContextService.resolveForUser(userId, institutionCode);

            const [
                scopedStats,
                coverage,
                subscription,
                activeEntitlements,
                latestSuccessfulPayment,
                completedExams,
                abandonedExams,
                inProgressExams,
                bookmarkedQuestions,
                questionReportsSubmitted,
                hostedCollaborationSessions,
                joinedCollaborationSessions,
                lastStartedExam,
                lastCompletedExam,
                lastStudyActivity,
                activeSessions,
                registeredDevices,
                recentAuditEvents,
                recentAdminActions,
                recentExams,
                recentBookmarks,
                hostedSessions,
                participantSessions
            ] = await Promise.all([
                prisma.userInstitutionStats.findUnique({
                    where: {
                        userId_institutionId: {
                            userId,
                            institutionId: institution.id
                        }
                    },
                    select: {
                        totalSp: true,
                        weeklySp: true,
                        realExamsCompleted: true,
                        completedCollaborationExams: true
                    }
                }),
                buildPremiumCoverageStateTx(prisma, userId),
                prisma.subscription.findUnique({
                    where: { userId },
                    select: {
                        status: true,
                        provider: true,
                        planType: true,
                        autoRenew: true,
                        startDate: true,
                        endDate: true,
                        lastPaymentVerifiedAt: true
                    }
                }),
                prisma.premiumEntitlement.findMany({
                    where: {
                        userId,
                        status: 'ACTIVE'
                    },
                    select: {
                        id: true,
                        kind: true,
                        status: true,
                        startsAt: true,
                        endsAt: true
                    },
                    orderBy: [
                        { endsAt: 'desc' },
                        { createdAt: 'desc' }
                    ]
                }),
                actorRole === 'SUPERADMIN'
                    ? prisma.subscriptionPayment.findFirst({
                        where: {
                            userId,
                            status: 'SUCCESS',
                            paidAt: { not: null }
                        },
                        select: {
                            reference: true,
                            amountPaid: true,
                            currency: true,
                            provider: true,
                            channel: true,
                            paidAt: true
                        },
                        orderBy: [
                            { paidAt: 'desc' },
                            { createdAt: 'desc' }
                        ]
                    })
                    : Promise.resolve(null),
                prisma.exam.count({
                    where: {
                        userId,
                        institutionId: institution.id,
                        status: 'COMPLETED'
                    }
                }),
                prisma.exam.count({
                    where: {
                        userId,
                        institutionId: institution.id,
                        status: 'ABANDONED'
                    }
                }),
                prisma.exam.count({
                    where: {
                        userId,
                        institutionId: institution.id,
                        status: 'IN_PROGRESS'
                    }
                }),
                prisma.bookmarkedQuestion.count({
                    where: {
                        userId,
                        question: {
                            institutionId: institution.id
                        },
                        OR: [
                            { expiresAt: null },
                            { expiresAt: { gt: new Date() } }
                        ]
                    }
                }),
                prisma.questionReport.count({
                    where: {
                        userId,
                        question: {
                            institutionId: institution.id
                        }
                    }
                }),
                prisma.collaborationSession.count({
                    where: {
                        hostUserId: userId,
                        institutionId: institution.id
                    }
                }),
                prisma.sessionParticipant.count({
                    where: {
                        userId,
                        session: {
                            institutionId: institution.id
                        }
                    }
                }),
                prisma.exam.findFirst({
                    where: {
                        userId,
                        institutionId: institution.id
                    },
                    orderBy: [
                        { startedAt: 'desc' },
                        { id: 'desc' }
                    ],
                    select: { startedAt: true }
                }),
                prisma.exam.findFirst({
                    where: {
                        userId,
                        institutionId: institution.id,
                        completedAt: { not: null }
                    },
                    orderBy: [
                        { completedAt: 'desc' },
                        { id: 'desc' }
                    ],
                    select: { completedAt: true }
                }),
                prisma.studyActivity.findFirst({
                    where: { userId },
                    orderBy: { activityDate: 'desc' },
                    select: { activityDate: true }
                }),
                prisma.userSession.findMany({
                    where: {
                        userId,
                        isActive: true
                    },
                    select: {
                        id: true,
                        deviceId: true,
                        createdAt: true,
                        expiresAt: true,
                        tokenVersion: true,
                        authPolicyVersion: true
                    },
                    orderBy: [
                        { createdAt: 'desc' },
                        { id: 'desc' }
                    ],
                    take: ADMIN_ANALYTICS_CONFIG.USER_360_RECENT_LIMIT
                }),
                prisma.userDevice.findMany({
                    where: {
                        userId,
                        isVerified: true
                    },
                    select: {
                        deviceId: true,
                        deviceName: true,
                        isVerified: true,
                        isActive: true,
                        verifiedAt: true,
                        lastLoginAt: true,
                        registrationMethod: true
                    },
                    orderBy: [
                        { lastLoginAt: 'desc' },
                        { createdAt: 'desc' }
                    ],
                    take: ADMIN_ANALYTICS_CONFIG.USER_360_RECENT_LIMIT
                }),
                prisma.auditLog.findMany({
                    where: { userId },
                    select: {
                        action: true,
                        createdAt: true,
                        deviceId: true,
                        ipAddress: true
                    },
                    orderBy: [
                        { createdAt: 'desc' },
                        { id: 'desc' }
                    ],
                    take: ADMIN_ANALYTICS_CONFIG.USER_360_AUDIT_LIMIT
                }),
                prisma.adminAuditLog.findMany({
                    where: {
                        targetType: 'USER',
                        targetId: String(userId)
                    },
                    select: {
                        action: true,
                        actorId: true,
                        actorRole: true,
                        createdAt: true,
                        reason: true
                    },
                    orderBy: [
                        { createdAt: 'desc' },
                        { id: 'desc' }
                    ],
                    take: ADMIN_ANALYTICS_CONFIG.USER_360_AUDIT_LIMIT
                }),
                prisma.exam.findMany({
                    where: {
                        userId,
                        institutionId: institution.id
                    },
                    select: {
                        id: true,
                        examType: true,
                        status: true,
                        score: true,
                        percentage: true,
                        isCollaboration: true,
                        startedAt: true,
                        completedAt: true
                    },
                    orderBy: [
                        { startedAt: 'desc' },
                        { id: 'desc' }
                    ],
                    take: ADMIN_ANALYTICS_CONFIG.USER_360_RECENT_LIMIT
                }),
                prisma.bookmarkedQuestion.findMany({
                    where: {
                        userId,
                        question: {
                            institutionId: institution.id
                        }
                    },
                    select: {
                        id: true,
                        questionId: true,
                        createdAt: true,
                        expiresAt: true,
                        question: {
                            select: {
                                subject: true
                            }
                        }
                    },
                    orderBy: [
                        { createdAt: 'desc' },
                        { id: 'desc' }
                    ],
                    take: ADMIN_ANALYTICS_CONFIG.USER_360_RECENT_LIMIT
                }),
                prisma.collaborationSession.findMany({
                    where: {
                        hostUserId: userId,
                        institutionId: institution.id
                    },
                    select: {
                        id: true,
                        sessionCode: true,
                        sessionType: true,
                        status: true,
                        createdAt: true,
                        startedAt: true,
                        endedAt: true
                    },
                    orderBy: [
                        { createdAt: 'desc' },
                        { id: 'desc' }
                    ],
                    take: ADMIN_ANALYTICS_CONFIG.USER_360_RECENT_LIMIT
                }),
                prisma.sessionParticipant.findMany({
                    where: {
                        userId,
                        session: {
                            institutionId: institution.id
                        }
                    },
                    select: {
                        session: {
                            select: {
                                id: true,
                                sessionCode: true,
                                sessionType: true,
                                status: true,
                                createdAt: true,
                                startedAt: true,
                                endedAt: true
                            }
                        }
                    },
                    orderBy: [
                        { joinedAt: 'desc' },
                        { id: 'desc' }
                    ],
                    take: ADMIN_ANALYTICS_CONFIG.USER_360_RECENT_LIMIT
                })
            ]);

            const streakSnapshot = deriveStreakSnapshot(
                user.currentStreak,
                user.longestStreak,
                user.lastActivityDate ? new Date(user.lastActivityDate) : null,
                new Date(),
                user.streakFreezesAvailable
            );

            const recentCollaborationSessions = [
                ...hostedSessions.map((session: {
                    id: number;
                    sessionCode: string;
                    sessionType: string;
                    status: string;
                    createdAt: Date;
                    startedAt: Date | null;
                    endedAt: Date | null;
                }) => ({
                    sessionId: session.id,
                    sessionCode: session.sessionCode,
                    sessionType: session.sessionType,
                    status: session.status,
                    role: 'HOST' as const,
                    createdAt: session.createdAt,
                    startedAt: session.startedAt,
                    endedAt: session.endedAt
                })),
                ...participantSessions.map(({ session }: {
                    session: {
                        id: number;
                        sessionCode: string;
                        sessionType: string;
                        status: string;
                        createdAt: Date;
                        startedAt: Date | null;
                        endedAt: Date | null;
                    };
                }) => ({
                    sessionId: session.id,
                    sessionCode: session.sessionCode,
                    sessionType: session.sessionType,
                    status: session.status,
                    role: 'PARTICIPANT' as const,
                    createdAt: session.createdAt,
                    startedAt: session.startedAt,
                    endedAt: session.endedAt
                }))
            ]
                .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
                .slice(0, ADMIN_ANALYTICS_CONFIG.USER_360_RECENT_LIMIT);

            return {
                generatedAt: new Date(),
                institution,
                user: {
                    id: user.id,
                    email: user.email,
                    fullName: user.fullName,
                    role: user.role,
                    isVerified: user.isVerified,
                    isBanned: user.isBanned,
                    bannedAt: user.bannedAt,
                    bannedReason: user.bannedReason,
                    aspiringCourse: user.aspiringCourse,
                    targetScore: user.targetScore,
                    emailUnsubscribed: user.emailUnsubscribed,
                    createdAt: user.createdAt,
                    updatedAt: user.updatedAt
                },
                premium: {
                    isPremium: user.isPremium,
                    deviceAccessMode: user.deviceAccessMode,
                    subscriptionEndDate: user.subscriptionEndDate,
                    coverage,
                    subscription: subscription
                        ? {
                            status: subscription.status,
                            provider: subscription.provider,
                            planType: subscription.planType,
                            autoRenew: subscription.autoRenew,
                            startDate: subscription.startDate,
                            endDate: subscription.endDate,
                            lastPaymentVerifiedAt: subscription.lastPaymentVerifiedAt
                        }
                        : null,
                    activeEntitlements: activeEntitlements.map((entitlement: {
                        id: bigint;
                        kind: 'MANUAL' | 'PROMOTIONAL' | 'CORRECTIVE';
                        status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
                        startsAt: Date;
                        endsAt: Date;
                    }) => ({
                        id: entitlement.id.toString(),
                        kind: entitlement.kind,
                        status: entitlement.status,
                        startsAt: entitlement.startsAt,
                        endsAt: entitlement.endsAt
                    })),
                    latestSuccessfulPayment: latestSuccessfulPayment && latestSuccessfulPayment.paidAt
                        ? {
                            reference: latestSuccessfulPayment.reference,
                            amountPaid: toNumber(latestSuccessfulPayment.amountPaid),
                            currency: latestSuccessfulPayment.currency,
                            provider: latestSuccessfulPayment.provider,
                            channel: latestSuccessfulPayment.channel ?? null,
                            paidAt: latestSuccessfulPayment.paidAt
                        }
                        : null
                },
                engagement: {
                    totalSp: scopedStats?.totalSp ?? 0,
                    weeklySp: scopedStats?.weeklySp ?? 0,
                    currentStreak: streakSnapshot.currentStreak,
                    longestStreak: user.longestStreak,
                    streakFreezesAvailable: streakSnapshot.streakFreezesAvailable,
                    realExamsCompleted: scopedStats?.realExamsCompleted ?? 0,
                    completedCollaborationExams: scopedStats?.completedCollaborationExams ?? 0,
                    hasTakenFreeExam: user.hasTakenFreeExam,
                    aiExplanationsUsedToday: user.aiExplanationsUsedToday,
                    completedExams,
                    abandonedExams,
                    inProgressExams,
                    bookmarkedQuestions,
                    questionReportsSubmitted,
                    hostedCollaborationSessions,
                    joinedCollaborationSessions,
                    lastExamStartedAt: lastStartedExam?.startedAt ?? null,
                    lastExamCompletedAt: lastCompletedExam?.completedAt ?? null,
                    lastStudyActivityDate: lastStudyActivity?.activityDate ?? null
                },
                security: {
                    activeSessionsCount: activeSessions.length,
                    verifiedDevicesCount: registeredDevices.length,
                    activeSessions: activeSessions.map((session: {
                        id: string;
                        deviceId: string;
                        createdAt: Date;
                        expiresAt: Date | null;
                        tokenVersion: number;
                        authPolicyVersion: number;
                    }) => ({
                        sessionId: session.id,
                        deviceId: session.deviceId,
                        createdAt: session.createdAt,
                        expiresAt: session.expiresAt,
                        tokenVersion: session.tokenVersion,
                        authPolicyVersion: session.authPolicyVersion
                    })),
                    registeredDevices: registeredDevices.map((device: {
                        deviceId: string;
                        deviceName: string;
                        isVerified: boolean;
                        isActive: boolean;
                        verifiedAt: Date | null;
                        lastLoginAt: Date | null;
                        registrationMethod: string | null;
                    }) => ({
                        deviceId: device.deviceId,
                        deviceName: device.deviceName,
                        isVerified: device.isVerified,
                        isActive: device.isActive,
                        verifiedAt: device.verifiedAt,
                        lastLoginAt: device.lastLoginAt,
                        registrationMethod: device.registrationMethod ?? null
                    })),
                    recentAuditEvents: recentAuditEvents.map((event: {
                        action: string;
                        createdAt: Date;
                        deviceId: string | null;
                        ipAddress: string | null;
                    }) => ({
                        action: event.action,
                        createdAt: event.createdAt,
                        deviceId: event.deviceId ?? null,
                        ipAddress: event.ipAddress ?? null
                    })),
                    recentAdminActions: recentAdminActions.map((event: {
                        action: import('./admin.types').AdminAuditAction;
                        actorId: number;
                        actorRole: string;
                        createdAt: Date;
                        reason: string | null;
                    }) => ({
                        action: event.action,
                        actorId: event.actorId,
                        actorRole: event.actorRole,
                        createdAt: event.createdAt,
                        reason: event.reason ?? null
                    }))
                },
                recent: {
                    exams: recentExams.map((exam: {
                        id: number;
                        examType: string;
                        status: string;
                        score: number;
                        percentage: number | null;
                        isCollaboration: boolean;
                        startedAt: Date;
                        completedAt: Date | null;
                    }) => ({
                        id: exam.id,
                        examType: exam.examType,
                        status: exam.status,
                        score: exam.score,
                        percentage: exam.percentage,
                        isCollaboration: exam.isCollaboration,
                        startedAt: exam.startedAt,
                        completedAt: exam.completedAt
                    })),
                    bookmarks: recentBookmarks.map((bookmark: {
                        id: number;
                        questionId: number;
                        createdAt: Date;
                        expiresAt: Date | null;
                        question: {
                            subject: string;
                        };
                    }) => ({
                        id: bookmark.id,
                        questionId: bookmark.questionId,
                        subject: bookmark.question.subject,
                        createdAt: bookmark.createdAt,
                        expiresAt: bookmark.expiresAt
                    })),
                    collaborationSessions: recentCollaborationSessions
                }
            };
        });
    }

    async getSystemHealth(actorId: number, actorRole: string): Promise<AdminSystemHealthResponse> {
        await this.assertAdminReadAccess(actorId, actorRole, 'GET_ADMIN_ANALYTICS_SYSTEM_HEALTH');

        return this.measure('system_health', actorRole, async () => {
            const now = new Date();
            const last24Hours = subtractDays(now, 1);
            const metrics = getGlobalMetricsRegistry();
            const projectionConfig = getProjectionReadConfig();

            let databaseReachable = true;
            try {
                await prisma.$queryRaw`SELECT 1`;
            } catch {
                databaseReachable = false;
            }

            const [settings, leaderboardProjectionBacklog, pendingStepUpChallenges, pendingQuestionReports, recentEmailFailures, latestRollup] = await Promise.all([
                prisma.systemSettings.findUnique({
                    where: { id: 1 },
                    select: { emailEnabled: true }
                }),
                prisma.leaderboardProjectionEvent.count({
                    where: { processedAt: null }
                }),
                prisma.adminStepUpChallenge.count({
                    where: {
                        otpExpiresAt: { gt: now },
                        verifiedAt: null
                    }
                }),
                prisma.questionReport.count({
                    where: { status: 'PENDING' }
                }),
                prisma.emailLog.count({
                    where: {
                        sentAt: { gte: last24Hours },
                        status: { notIn: ['sent', 'delivered'] }
                    }
                }),
                prisma.adminAnalyticsDailyRollup.findFirst({
                    orderBy: { date: 'desc' },
                    select: {
                        date: true,
                        updatedAt: true
                    }
                })
            ]);

            const rollupLagDays = latestRollup
                ? Math.max(0, getLagosDayDifference(now, latestRollup.date))
                : null;

            return {
                generatedAt: now,
                runtime: {
                    environment: process.env.NODE_ENV || 'development',
                    uptimeSeconds: Math.floor(process.uptime()),
                    jobsEnabled: process.env.JOBS_ENABLED === 'true',
                    redisEnabled: process.env.REDIS_ENABLED === 'true',
                    leaderboardProjectionEnabled: isLeaderboardProjectionEnabled(),
                    leaderboardRedisReadEnabled: projectionConfig.redisReadEnabled
                },
                dependencies: {
                    databaseReachable,
                    emailEnabled: settings?.emailEnabled ?? true
                },
                analytics: {
                    latestRollupDate: latestRollup ? getLagosDateKey(latestRollup.date) : null,
                    latestRollupUpdatedAt: latestRollup?.updatedAt ?? null,
                    rollupLagDays
                },
                queues: {
                    leaderboardProjectionBacklog,
                    pendingStepUpChallenges,
                    pendingQuestionReports,
                    recentEmailFailuresLast24Hours: recentEmailFailures
                },
                live: {
                    activeWsConnections: metrics?.getGaugeTotal('active_ws_connections') ?? 0,
                    wsOutboundQueueLength: metrics?.getGaugeTotal('ws_outbound_queue_len') ?? 0,
                    totalWsConnections: metrics?.getCounterTotal('ws_connections_total') ?? 0,
                    totalWsConnectionsReplaced: metrics?.getCounterTotal('ws_connection_replaced_total') ?? 0,
                    totalWsDroppedOutboundEvents: metrics?.getCounterTotal('ws_outbound_queue_dropped_total') ?? 0,
                    totalHttpRequests: metrics?.getCounterTotal('http_requests_total') ?? 0
                }
            };
        });
    }
}

export const adminAnalyticsService = new AdminAnalyticsService();

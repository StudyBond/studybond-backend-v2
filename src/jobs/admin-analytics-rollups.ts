import prisma from '../config/database';
import { ADMIN_ANALYTICS_CONFIG } from '../config/constants';
import { getGlobalMetricsRegistry } from '../shared/metrics/global';
import { addLagosDateDays, getLagosDateKey, getLagosDateValue, getLagosDayStart } from '../shared/streaks/domain';

function toWindowBounds(date: Date): { dayValue: Date; start: Date; endExclusive: Date } {
  const dayValue = getLagosDateValue(date);
  const start = getLagosDayStart(dayValue);
  const endExclusive = getLagosDayStart(addLagosDateDays(dayValue, 1));
  return { dayValue, start, endExclusive };
}

async function refreshDailyRollup(date: Date): Promise<void> {
  const { dayValue, start, endExclusive } = toWindowBounds(date);

  const [
    newUsers,
    examsStarted,
    examsCompleted,
    collaborationSessions,
    successfulPayments,
    successfulRevenue,
    manualPremiumGrants,
    promotionalPremiumGrants,
    correctivePremiumGrants,
    premiumRevocations
  ] = await Promise.all([
    prisma.user.count({
      where: {
        createdAt: {
          gte: start,
          lt: endExclusive
        }
      }
    }),
    prisma.exam.count({
      where: {
        startedAt: {
          gte: start,
          lt: endExclusive
        }
      }
    }),
    prisma.exam.count({
      where: {
        status: 'COMPLETED',
        completedAt: {
          gte: start,
          lt: endExclusive
        }
      }
    }),
    prisma.collaborationSession.count({
      where: {
        createdAt: {
          gte: start,
          lt: endExclusive
        }
      }
    }),
    prisma.subscriptionPayment.count({
      where: {
        status: 'SUCCESS',
        paidAt: {
          gte: start,
          lt: endExclusive
        }
      }
    }),
    prisma.subscriptionPayment.aggregate({
      where: {
        status: 'SUCCESS',
        paidAt: {
          gte: start,
          lt: endExclusive
        }
      },
      _sum: {
        amountPaid: true
      }
    }),
    prisma.premiumEntitlement.count({
      where: {
        kind: 'MANUAL',
        createdAt: {
          gte: start,
          lt: endExclusive
        }
      }
    }),
    prisma.premiumEntitlement.count({
      where: {
        kind: 'PROMOTIONAL',
        createdAt: {
          gte: start,
          lt: endExclusive
        }
      }
    }),
    prisma.premiumEntitlement.count({
      where: {
        kind: 'CORRECTIVE',
        createdAt: {
          gte: start,
          lt: endExclusive
        }
      }
    }),
    prisma.premiumEntitlement.count({
      where: {
        revokedAt: {
          gte: start,
          lt: endExclusive
        }
      }
    })
  ]);

  await prisma.adminAnalyticsDailyRollup.upsert({
    where: {
      date: dayValue
    },
    update: {
      newUsers,
      examsStarted,
      examsCompleted,
      collaborationSessions,
      successfulPayments,
      successfulRevenueNaira: successfulRevenue._sum.amountPaid ?? 0,
      manualPremiumGrants,
      promotionalPremiumGrants,
      correctivePremiumGrants,
      premiumRevocations,
      generatedAt: new Date()
    },
    create: {
      date: dayValue,
      newUsers,
      examsStarted,
      examsCompleted,
      collaborationSessions,
      successfulPayments,
      successfulRevenueNaira: successfulRevenue._sum.amountPaid ?? 0,
      manualPremiumGrants,
      promotionalPremiumGrants,
      correctivePremiumGrants,
      premiumRevocations
    }
  });
}

export async function refreshAdminAnalyticsRollups(
  now = new Date(),
  lookbackDays = ADMIN_ANALYTICS_CONFIG.ROLLUP_LOOKBACK_DAYS
): Promise<{
  daysProcessed: number;
  latestDate: string | null;
}> {
  const metrics = getGlobalMetricsRegistry();
  const startedAt = Date.now();
  const days = Math.max(1, lookbackDays);
  const today = getLagosDateValue(now);
  const start = addLagosDateDays(today, -(days - 1));
  let latestDate: string | null = null;

  for (let offset = 0; offset < days; offset += 1) {
    const date = addLagosDateDays(start, offset);
    await refreshDailyRollup(date);
    latestDate = getLagosDateKey(date);
  }

  const durationMs = Date.now() - startedAt;
  metrics?.incrementCounter('admin_analytics_rollup_runs_total');
  metrics?.incrementCounter('admin_analytics_rollup_days_processed_total', days);
  metrics?.observeHistogram('admin_analytics_rollup_duration_ms', durationMs);
  metrics?.setGauge('admin_analytics_rollup_last_duration_ms', durationMs);
  metrics?.setGauge('admin_analytics_rollup_last_days_processed', days);

  return {
    daysProcessed: days,
    latestDate
  };
}

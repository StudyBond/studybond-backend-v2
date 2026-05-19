import { EmailType, SubscriptionStatus } from '@prisma/client';
import prisma from '../config/database';
import { SUBSCRIPTION_ALERT_CONFIG } from '../config/constants';
import { transactionalEmailService } from '../shared/email/email.service';
import {
  buildSubscriptionExpiryWarningTemplate,
  buildSubscriptionExpiredNoticeTemplate
} from '../shared/email/email.templates';
import { getGlobalMetricsRegistry } from '../shared/metrics/global';

// ============================================
// TYPES
// ============================================

interface AlertResult {
  candidates: number;
  sent: number;
  skipped: number;
  failures: number;
}

interface SubscriptionAlertResult {
  warnings: AlertResult;
  expiredNotices: AlertResult;
  durationMs: number;
}

// ============================================
// WARNING EMAILS (7 days & 1 day before expiry)
// ============================================

async function runExpiryWarningAlerts(now: Date): Promise<AlertResult> {
  const result: AlertResult = { candidates: 0, sent: 0, skipped: 0, failures: 0 };

  for (const warningDays of SUBSCRIPTION_ALERT_CONFIG.WARNING_DAYS) {
    // Find subscriptions expiring within the warning window
    // Window: between warningDays and warningDays-1 days from now
    const windowStart = new Date(now.getTime() + (warningDays - 1) * 24 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + warningDays * 24 * 60 * 60 * 1000);

    const subscriptions = await prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        endDate: {
          gte: windowStart,
          lt: windowEnd,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            isBanned: true,
            emailUnsubscribed: true,
            emailPreferences: true,
          },
        },
      },
      take: SUBSCRIPTION_ALERT_CONFIG.BATCH_SIZE,
    });

    result.candidates += subscriptions.length;
    if (subscriptions.length === 0) continue;

    // Check which users already received a warning for this specific window
    const userIds = subscriptions.map((s: { user: { id: number } }) => s.user.id);
    const alreadyWarned = new Set(
      (await prisma.emailLog.findMany({
        where: {
          userId: { in: userIds },
          emailType: EmailType.SUBSCRIPTION_EXPIRY_WARNING,
          status: { in: ['sent', 'preview'] },
          metadata: {
            path: ['warningDays'],
            equals: warningDays,
          },
        },
        select: { userId: true },
      })).map((row: { userId: number }) => row.userId)
    );

    for (const sub of subscriptions) {
      const { user } = sub;

      if (user.isBanned) {
        result.skipped += 1;
        continue;
      }

      if (alreadyWarned.has(user.id)) {
        result.skipped += 1;
        continue;
      }

      try {
        const daysRemaining = Math.max(1, Math.ceil(
          (sub.endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
        ));

        const template = buildSubscriptionExpiryWarningTemplate(
          user.fullName,
          daysRemaining,
          sub.autoRenew,
          SUBSCRIPTION_ALERT_CONFIG.APP_BASE_URL
        );

        await transactionalEmailService.send({
          userId: user.id,
          emailType: EmailType.SUBSCRIPTION_EXPIRY_WARNING,
          to: { email: user.email, name: user.fullName },
          subject: template.subject,
          html: template.html,
          text: template.text,
          metadata: {
            campaignKind: 'subscription_expiry_warning',
            warningDays,
            daysRemaining,
            autoRenew: sub.autoRenew,
            endDate: sub.endDate.toISOString(),
          },
        });

        result.sent += 1;
      } catch {
        result.failures += 1;
      }
    }
  }

  return result;
}

// ============================================
// EXPIRED NOTICE (subscription just expired)
// ============================================

async function runExpiredNoticeAlerts(now: Date): Promise<AlertResult> {
  const result: AlertResult = { candidates: 0, sent: 0, skipped: 0, failures: 0 };

  // Find subscriptions that expired in the last 24 hours
  const expiredSince = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: SubscriptionStatus.EXPIRED,
      endDate: {
        gte: expiredSince,
        lt: now,
      },
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          fullName: true,
          isBanned: true,
          emailUnsubscribed: true,
          emailPreferences: true,
        },
      },
    },
    take: SUBSCRIPTION_ALERT_CONFIG.BATCH_SIZE,
  });

  result.candidates = subscriptions.length;
  if (subscriptions.length === 0) return result;

  // Check who already received the expired notice
  const userIds = subscriptions.map((s: { user: { id: number } }) => s.user.id);
  const alreadyNotified = new Set(
    (await prisma.emailLog.findMany({
      where: {
        userId: { in: userIds },
        emailType: EmailType.SUBSCRIPTION_EXPIRED_NOTICE,
        status: { in: ['sent', 'preview'] },
        sentAt: { gte: expiredSince },
      },
      select: { userId: true },
    })).map((row: { userId: number }) => row.userId)
  );

  for (const sub of subscriptions) {
    const { user } = sub;

    if (user.isBanned) {
      result.skipped += 1;
      continue;
    }

    if (alreadyNotified.has(user.id)) {
      result.skipped += 1;
      continue;
    }

    try {
      const template = buildSubscriptionExpiredNoticeTemplate(
        user.fullName,
        SUBSCRIPTION_ALERT_CONFIG.APP_BASE_URL
      );

      await transactionalEmailService.send({
        userId: user.id,
        emailType: EmailType.SUBSCRIPTION_EXPIRED_NOTICE,
        to: { email: user.email, name: user.fullName },
        subject: template.subject,
        html: template.html,
        text: template.text,
        metadata: {
          campaignKind: 'subscription_expired_notice',
          endDate: sub.endDate.toISOString(),
        },
      });

      result.sent += 1;
    } catch {
      result.failures += 1;
    }
  }

  return result;
}

// ============================================
// ORCHESTRATOR
// ============================================

/**
 * Runs subscription lifecycle alerts:
 * 1. Expiry warnings (7 days & 1 day before)
 * 2. Expired notices (within 24 hours of expiration)
 *
 * These are NOT marketing emails — they are transactional notifications
 * for paying customers. They bypass the marketing email preference
 * (users who paid deserve to know their subscription is ending).
 */
export async function runSubscriptionAlerts(now = new Date()): Promise<SubscriptionAlertResult> {
  const metrics = getGlobalMetricsRegistry();
  const startedAt = Date.now();

  const warnings = await runExpiryWarningAlerts(now);
  const expiredNotices = await runExpiredNoticeAlerts(now);

  const durationMs = Date.now() - startedAt;

  metrics?.incrementCounter('subscription_alert_runs_total');
  metrics?.incrementCounter('subscription_alert_emails_total', warnings.sent, { type: 'warning', status: 'sent' });
  metrics?.incrementCounter('subscription_alert_emails_total', expiredNotices.sent, { type: 'expired_notice', status: 'sent' });
  metrics?.observeHistogram('subscription_alert_duration_ms', durationMs);

  return {
    warnings,
    expiredNotices,
    durationMs,
  };
}

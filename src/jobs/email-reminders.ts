import { EmailType } from '@prisma/client';
import { streaksService } from '../modules/streaks/streaks.service';
import { transactionalEmailService } from '../shared/email/email.service';
import { buildStreakAlertTemplate, buildSubscriptionPromptTemplate } from '../shared/email/email.templates';
import { getGlobalMetricsRegistry } from '../shared/metrics/global';
import { getNextMilestone } from '../shared/streaks/domain';

const PREMIUM_STREAK_MESSAGES = [
  'Your StudyBond streak is sweating a little. A quick exam tonight keeps it safe.',
  'You are too close to building something great to let today slip away.',
  'A few focused minutes tonight keeps your momentum alive.',
  'You have already done the hard part by showing up consistently. Protect that today.',
  'Your future self will thank you for not letting this streak break tonight.'
];

function deterministicReminderMessage(userId: number, currentStreak: number, now = new Date()): string {
  const daySeed = Number(now.toISOString().slice(0, 10).replace(/-/g, ''));
  const index = Math.abs((userId * 31) + (currentStreak * 17) + daySeed) % PREMIUM_STREAK_MESSAGES.length;
  return PREMIUM_STREAK_MESSAGES[index]!;
}

export async function runStreakReminderCheck(now = new Date()): Promise<{
  premiumCandidates: number;
  premiumSent: number;
  freeCandidates: number;
  freeSent: number;
  failures: number;
}> {
  const metrics = getGlobalMetricsRegistry();
  const startedAt = Date.now();

  const [premiumCandidates, freeCandidates] = await Promise.all([
    streaksService.listPremiumReminderCandidates(now),
    streaksService.listFreePromptCandidates(now)
  ]);

  let premiumSent = 0;
  let freeSent = 0;
  let failures = 0;

  for (const candidate of premiumCandidates) {
    try {
      const nextMilestone = getNextMilestone(candidate.currentStreak);
      const reminderMessage = deterministicReminderMessage(candidate.id, candidate.currentStreak, now);
      const template = buildStreakAlertTemplate(
        candidate.fullName,
        candidate.currentStreak,
        reminderMessage,
        nextMilestone?.label ?? null
      );

      await transactionalEmailService.send({
        userId: candidate.id,
        emailType: EmailType.STREAK_ALERT,
        to: {
          email: candidate.email,
          name: candidate.fullName
        },
        subject: template.subject,
        html: template.html,
        text: template.text,
        metadata: {
          reminderKind: 'premium_streak_alert',
          currentStreak: candidate.currentStreak,
          status: candidate.status
        }
      });

      await streaksService.markReminderSent(candidate.id, now);
      premiumSent += 1;
    } catch {
      failures += 1;
    }
  }

  for (const candidate of freeCandidates) {
    try {
      const template = buildSubscriptionPromptTemplate(
        candidate.fullName,
        candidate.currentStreak,
        candidate.aspiringCourse,
        candidate.targetScore
      );

      await transactionalEmailService.send({
        userId: candidate.id,
        emailType: EmailType.SUBSCRIPTION_PROMPT,
        to: {
          email: candidate.email,
          name: candidate.fullName
        },
        subject: template.subject,
        html: template.html,
        text: template.text,
        metadata: {
          reminderKind: 'free_upgrade_prompt',
          currentStreak: candidate.currentStreak,
          status: candidate.status
        }
      });

      freeSent += 1;
    } catch {
      failures += 1;
    }
  }

  const durationMs = Date.now() - startedAt;
  metrics?.incrementCounter('streak_reminder_runs_total');
  metrics?.incrementCounter('streak_reminder_emails_total', premiumSent, { audience: 'premium', status: 'sent' });
  metrics?.incrementCounter('streak_reminder_emails_total', freeSent, { audience: 'free', status: 'sent' });
  metrics?.incrementCounter('streak_reminder_emails_total', failures, { audience: 'mixed', status: 'failed' });
  metrics?.observeHistogram('streak_reminder_duration_ms', durationMs);

  return {
    premiumCandidates: premiumCandidates.length,
    premiumSent,
    freeCandidates: freeCandidates.length,
    freeSent,
    failures
  };
}

export async function runStreakReconciliation(now = new Date()): Promise<{
  reconciledUsers: number;
  batchesProcessed: number;
}> {
  const metrics = getGlobalMetricsRegistry();
  const startedAt = Date.now();
  const result = await streaksService.reconcileBrokenStreaks(now);
  const durationMs = Date.now() - startedAt;

  metrics?.incrementCounter('streak_reconciliation_runs_total');
  metrics?.incrementCounter('streak_reconciled_users_total', result.reconciledUsers);
  metrics?.observeHistogram('streak_reconciliation_duration_ms', durationMs);
  metrics?.setGauge('streak_reconciliation_last_reconciled_count', result.reconciledUsers);

  return result;
}

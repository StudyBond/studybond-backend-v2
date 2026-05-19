import { EmailType, Prisma } from '@prisma/client';
import prisma from '../config/database';
import { MARKETING_CONFIG } from '../config/constants';
import { transactionalEmailService } from '../shared/email/email.service';
import {
  buildWelcomeEmailTemplate,
  buildInactivityNudgeTemplate,
  buildMilestoneCelebrationTemplate
} from '../shared/email/email.templates';
import { canReceiveMarketingEmail } from '../shared/email/email-preferences';
import { getGlobalMetricsRegistry } from '../shared/metrics/global';
import { getLagosDateValue } from '../shared/streaks/domain';

// ============================================
// TYPES
// ============================================

interface CampaignResult {
  candidates: number;
  sent: number;
  skipped: number;
  failures: number;
}

interface MarketingCampaignResult {
  welcome: CampaignResult;
  inactivityNudge: CampaignResult;
  milestoneCelebration: CampaignResult;
  durationMs: number;
}

const MARKETING_EMAIL_TYPES: EmailType[] = [
  EmailType.WELCOME_EMAIL,
  EmailType.SUBSCRIPTION_PROMPT,
  EmailType.INACTIVITY_NUDGE,
  EmailType.MILESTONE_CELEBRATION,
];

const marketingUserSelect = {
  id: true,
  email: true,
  fullName: true,
  aspiringCourse: true,
  isPremium: true,
  isVerified: true,
  isBanned: true,
  emailUnsubscribed: true,
  emailPreferences: true,
  hasTakenFreeExam: true,
  realExamsCompleted: true,
  createdAt: true,
} satisfies Prisma.UserSelect;



// ============================================
// SHARED GUARDS
// ============================================

/**
 * Resolves the eligibility cutoff date from configuration.
 * If MARKETING_ELIGIBLE_AFTER is set, only users who signed up on or after
 * that date are eligible. This prevents flooding existing users on first deploy.
 */
function getEligibleAfterDate(): Date | null {
  if (!MARKETING_CONFIG.ELIGIBLE_AFTER) {
    return null;
  }

  const parsed = new Date(MARKETING_CONFIG.ELIGIBLE_AFTER);
  if (Number.isNaN(parsed.getTime())) {
    console.error('[MARKETING_CAMPAIGN] Invalid MARKETING_ELIGIBLE_AFTER date:', MARKETING_CONFIG.ELIGIBLE_AFTER);
    return null;
  }

  return parsed;
}

/**
 * Checks whether a user has already received a marketing-category email today.
 * Used to enforce the daily cap of 1 marketing email per user.
 */
async function hasReceivedMarketingEmailToday(userId: number, now: Date): Promise<boolean> {
  const todayStart = getLagosDateValue(now);

  const existing = await prisma.emailLog.findFirst({
    where: {
      userId,
      emailType: { in: MARKETING_EMAIL_TYPES },
      status: { in: ['sent', 'preview'] },
      sentAt: { gte: todayStart }
    },
    select: { id: true }
  });

  return existing !== null;
}

// ============================================
// CAMPAIGN 1: WELCOME EMAIL
// ============================================

async function runWelcomeEmailCampaign(now: Date): Promise<CampaignResult> {
  const result: CampaignResult = { candidates: 0, sent: 0, skipped: 0, failures: 0 };

  const eligibleAfter = getEligibleAfterDate();
  const welcomeDelayMs = MARKETING_CONFIG.WELCOME_DELAY_MINUTES * 60 * 1000;
  const earliestVerification = new Date(now.getTime() - 24 * 60 * 60 * 1000); // last 24 hours
  const latestVerification = new Date(now.getTime() - welcomeDelayMs); // at least 15 min ago

  const whereClause: Prisma.UserWhereInput = {
    isPremium: false,
    isVerified: true,
    isBanned: false,
    createdAt: {
      gte: earliestVerification,
      lte: latestVerification,
    },
  };

  if (eligibleAfter) {
    whereClause.createdAt = {
      ...(whereClause.createdAt as Prisma.DateTimeFilter),
      gte: eligibleAfter > earliestVerification ? eligibleAfter : earliestVerification
    };
  }

  const users = await prisma.user.findMany({
    where: whereClause,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MARKETING_CONFIG.BATCH_SIZE,
    select: marketingUserSelect,
  });

  result.candidates = users.length;
  if (users.length === 0) return result;

  // Find users who already received a welcome email
  const alreadyWelcomed = new Set(
    (await prisma.emailLog.findMany({
      where: {
        userId: { in: users.map((u: { id: number }) => u.id) },
        emailType: EmailType.WELCOME_EMAIL,
        status: { in: ['sent', 'preview'] },
      },
      select: { userId: true },
    })).map((row: { userId: number }) => row.userId)
  );

  for (const user of users) {
    if (alreadyWelcomed.has(user.id)) {
      result.skipped += 1;
      continue;
    }

    if (!canReceiveMarketingEmail(user)) {
      result.skipped += 1;
      continue;
    }

    if (await hasReceivedMarketingEmailToday(user.id, now)) {
      result.skipped += 1;
      continue;
    }

    try {
      const template = buildWelcomeEmailTemplate(
        user.fullName,
        user.aspiringCourse,
        MARKETING_CONFIG.APP_BASE_URL
      );

      await transactionalEmailService.send({
        userId: user.id,
        emailType: EmailType.WELCOME_EMAIL,
        to: { email: user.email, name: user.fullName },
        subject: template.subject,
        html: template.html,
        text: template.text,
        metadata: { campaignKind: 'welcome_email' },
      });

      result.sent += 1;
    } catch {
      result.failures += 1;
    }
  }

  return result;
}

// ============================================
// CAMPAIGN 2: INACTIVITY NUDGE
// ============================================

async function runInactivityNudgeCampaign(now: Date): Promise<CampaignResult> {
  const result: CampaignResult = { candidates: 0, sent: 0, skipped: 0, failures: 0 };

  const eligibleAfter = getEligibleAfterDate();
  const minDaysAgo = new Date(now.getTime() - MARKETING_CONFIG.INACTIVITY_NUDGE_MIN_DAYS_SINCE_SIGNUP * 24 * 60 * 60 * 1000);

  const whereClause: Prisma.UserWhereInput = {
    isPremium: false,
    isVerified: true,
    isBanned: false,
    hasTakenFreeExam: false,
    createdAt: { lte: minDaysAgo },
  };

  if (eligibleAfter) {
    whereClause.createdAt = {
      ...(whereClause.createdAt as Prisma.DateTimeFilter),
      gte: eligibleAfter
    };
  }

  const users = await prisma.user.findMany({
    where: whereClause,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MARKETING_CONFIG.BATCH_SIZE,
    select: marketingUserSelect,
  });

  result.candidates = users.length;
  if (users.length === 0) return result;

  // Check existing nudge history for all candidates in one query
  const cooldownThreshold = new Date(
    now.getTime() - MARKETING_CONFIG.INACTIVITY_NUDGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
  );

  const nudgeLogs = await prisma.emailLog.findMany({
    where: {
      userId: { in: users.map((u: { id: number }) => u.id) },
      emailType: EmailType.INACTIVITY_NUDGE,
      status: { in: ['sent', 'preview'] },
    },
    select: { userId: true, sentAt: true },
  });

  // Build per-user nudge counts and recency
  const nudgeCountByUser = new Map<number, number>();
  const recentNudgeUsers = new Set<number>();

  for (const log of nudgeLogs) {
    nudgeCountByUser.set(log.userId, (nudgeCountByUser.get(log.userId) || 0) + 1);
    if (log.sentAt >= cooldownThreshold) {
      recentNudgeUsers.add(log.userId);
    }
  }

  for (const user of users) {
    // Lifetime cap check
    const totalNudges = nudgeCountByUser.get(user.id) || 0;
    if (totalNudges >= MARKETING_CONFIG.INACTIVITY_NUDGE_MAX_TOTAL) {
      result.skipped += 1;
      continue;
    }

    // Cooldown check
    if (recentNudgeUsers.has(user.id)) {
      result.skipped += 1;
      continue;
    }

    if (!canReceiveMarketingEmail(user)) {
      result.skipped += 1;
      continue;
    }

    if (await hasReceivedMarketingEmailToday(user.id, now)) {
      result.skipped += 1;
      continue;
    }

    try {
      const daysSinceSignup = Math.floor(
        (now.getTime() - user.createdAt.getTime()) / (24 * 60 * 60 * 1000)
      );

      const template = buildInactivityNudgeTemplate(
        user.fullName,
        daysSinceSignup,
        user.aspiringCourse,
        MARKETING_CONFIG.APP_BASE_URL
      );

      await transactionalEmailService.send({
        userId: user.id,
        emailType: EmailType.INACTIVITY_NUDGE,
        to: { email: user.email, name: user.fullName },
        subject: template.subject,
        html: template.html,
        text: template.text,
        metadata: {
          campaignKind: 'inactivity_nudge',
          daysSinceSignup,
          nudgeNumber: totalNudges + 1,
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
// CAMPAIGN 3: MILESTONE CELEBRATION
// ============================================

const MILESTONE_LABELS: Record<number, string> = {
  5: '5 exams completed — you are on a roll!',
  10: '10 exams completed — double digits!',
};

async function runMilestoneCelebrationCampaign(now: Date): Promise<CampaignResult> {
  const result: CampaignResult = { candidates: 0, sent: 0, skipped: 0, failures: 0 };

  const eligibleAfter = getEligibleAfterDate();
  const lowestThreshold = MARKETING_CONFIG.MILESTONE_THRESHOLDS[0];

  const whereClause: Prisma.UserWhereInput = {
    isPremium: false,
    isVerified: true,
    isBanned: false,
    hasTakenFreeExam: true,
    realExamsCompleted: { gte: lowestThreshold },
  };

  if (eligibleAfter) {
    whereClause.createdAt = { gte: eligibleAfter };
  }

  const users = await prisma.user.findMany({
    where: whereClause,
    orderBy: [{ realExamsCompleted: 'desc' }, { id: 'asc' }],
    take: MARKETING_CONFIG.BATCH_SIZE,
    select: marketingUserSelect,
  });

  result.candidates = users.length;
  if (users.length === 0) return result;

  // Fetch existing milestone celebration logs for all candidates
  const celebrationLogs = await prisma.emailLog.findMany({
    where: {
      userId: { in: users.map((u: { id: number }) => u.id) },
      emailType: EmailType.MILESTONE_CELEBRATION,
      status: { in: ['sent', 'preview'] },
    },
    select: { userId: true, metadata: true },
  });

  // Build set of already-celebrated milestones per user
  const celebratedMilestones = new Map<number, Set<number>>();

  for (const log of celebrationLogs) {
    const existing = celebratedMilestones.get(log.userId) || new Set();
    const meta = log.metadata as { milestoneThreshold?: number } | null;
    if (meta?.milestoneThreshold) {
      existing.add(meta.milestoneThreshold);
    }
    celebratedMilestones.set(log.userId, existing);
  }

  for (const user of users) {
    // Determine the highest uncelebrated milestone
    const userCelebrated = celebratedMilestones.get(user.id) || new Set();
    let targetMilestone: number | null = null;

    // Check thresholds from highest to lowest to celebrate the highest uncelebrated one
    for (let i = MARKETING_CONFIG.MILESTONE_THRESHOLDS.length - 1; i >= 0; i -= 1) {
      const threshold = MARKETING_CONFIG.MILESTONE_THRESHOLDS[i];
      if (user.realExamsCompleted >= threshold && !userCelebrated.has(threshold)) {
        targetMilestone = threshold;
        break;
      }
    }

    if (targetMilestone === null) {
      result.skipped += 1;
      continue;
    }

    if (!canReceiveMarketingEmail(user)) {
      result.skipped += 1;
      continue;
    }

    if (await hasReceivedMarketingEmailToday(user.id, now)) {
      result.skipped += 1;
      continue;
    }

    try {
      const milestoneLabel = MILESTONE_LABELS[targetMilestone] || `${targetMilestone} exams completed!`;

      const template = buildMilestoneCelebrationTemplate(
        user.fullName,
        milestoneLabel,
        targetMilestone,
        MARKETING_CONFIG.APP_BASE_URL
      );

      await transactionalEmailService.send({
        userId: user.id,
        emailType: EmailType.MILESTONE_CELEBRATION,
        to: { email: user.email, name: user.fullName },
        subject: template.subject,
        html: template.html,
        text: template.text,
        metadata: {
          campaignKind: 'milestone_celebration',
          milestoneThreshold: targetMilestone,
          actualExamCount: user.realExamsCompleted,
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
 * Runs all marketing campaigns in sequence.
 *
 * Campaign order matters — welcome emails take priority, then inactivity
 * nudges, then milestone celebrations. The daily cap ensures a user only
 * receives one marketing email per day, so earlier campaigns "win" the slot.
 */
export async function runMarketingCampaigns(now = new Date()): Promise<MarketingCampaignResult> {
  const metrics = getGlobalMetricsRegistry();
  const startedAt = Date.now();

  const welcome = await runWelcomeEmailCampaign(now);
  const inactivityNudge = await runInactivityNudgeCampaign(now);
  const milestoneCelebration = await runMilestoneCelebrationCampaign(now);

  const durationMs = Date.now() - startedAt;

  // Record metrics
  const totalFailed = welcome.failures + inactivityNudge.failures + milestoneCelebration.failures;

  metrics?.incrementCounter('marketing_campaign_runs_total');
  metrics?.incrementCounter('marketing_campaign_emails_total', welcome.sent, { campaign: 'welcome', status: 'sent' });
  metrics?.incrementCounter('marketing_campaign_emails_total', inactivityNudge.sent, { campaign: 'inactivity_nudge', status: 'sent' });
  metrics?.incrementCounter('marketing_campaign_emails_total', milestoneCelebration.sent, { campaign: 'milestone_celebration', status: 'sent' });
  metrics?.incrementCounter('marketing_campaign_emails_total', totalFailed, { campaign: 'mixed', status: 'failed' });
  metrics?.observeHistogram('marketing_campaign_duration_ms', durationMs);

  return {
    welcome,
    inactivityNudge,
    milestoneCelebration,
    durationMs,
  };
}

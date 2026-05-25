import { FastifyInstance } from 'fastify';
import cron from 'node-cron';
import { ADMIN_ANALYTICS_CONFIG, AUTH_CONFIG, BOOKMARK_CONFIG, MARKETING_CONFIG, NOTIFICATIONS_CONFIG, STREAK_CONFIG, SUBSCRIPTION_ALERT_CONFIG } from '../config/constants';
import { refreshAdminAnalyticsRollups } from './admin-analytics-rollups';
import { runExpiredBookmarkCleanup } from './bookmark-cleanup';
import { runStreakReconciliation, runStreakReminderCheck } from './email-reminders';
import { runMarketingCampaigns } from './marketing-campaigns';
import { runNotificationMaintenance } from './notification-maintenance';
import { runPasswordChangeAlertCheck } from './password-change-alerts';
import { runSubscriptionExpiryCheck } from './subscription-check';
import { runSubscriptionAlerts } from './subscription-expiry-alerts';
import { runWeeklyLeaderboardReset } from './weekly-reset';

const JOBS_ENABLED = process.env.JOBS_ENABLED === 'true';
const JOBS_TIMEZONE = process.env.JOBS_TIMEZONE || 'Africa/Lagos';
const LEADERBOARD_WEEKLY_RESET_CRON = process.env.LEADERBOARD_WEEKLY_RESET_CRON || '59 23 * * 0';

export function setupBackgroundJobs(app: FastifyInstance): void {
  if (!JOBS_ENABLED) {
    app.log.info('Background jobs are disabled (JOBS_ENABLED=false).');
    return;
  }

  const subscriptionExpiryTask = cron.schedule('0 0 * * *', async () => {
    app.log.info('Running subscription expiry reconciliation job.');
    const result = await runSubscriptionExpiryCheck();
    app.log.info({ expiredUsers: result.expiredUsers }, 'Subscription expiry reconciliation finished.');
  }, {
    timezone: JOBS_TIMEZONE
  });

  const passwordChangeAlertTask = cron.schedule(AUTH_CONFIG.PASSWORD_CHANGE_ALERT_CRON, async () => {
    app.log.info('Running password change security alert job.');
    const result = await runPasswordChangeAlertCheck();
    app.log.info(result, 'Password change security alert job finished.');
  }, {
    timezone: JOBS_TIMEZONE
  });

  const bookmarkCleanupTask = cron.schedule(BOOKMARK_CONFIG.EXPIRY_CLEANUP_CRON, async () => {
    app.log.info('Running expired bookmark cleanup job.');
    const result = await runExpiredBookmarkCleanup();
    app.log.info(result, 'Expired bookmark cleanup job finished.');
  }, {
    timezone: JOBS_TIMEZONE
  });

  const adminAnalyticsRollupTask = cron.schedule(ADMIN_ANALYTICS_CONFIG.ROLLUP_CRON, async () => {
    app.log.info('Running admin analytics rollup refresh job.');
    const result = await refreshAdminAnalyticsRollups();
    app.log.info(result, 'Admin analytics rollup refresh job finished.');
  }, {
    timezone: JOBS_TIMEZONE
  });

  const streakReminderTask = cron.schedule(STREAK_CONFIG.REMINDER_CRON, async () => {
    app.log.info('Running streak reminder job.');
    const result = await runStreakReminderCheck();
    app.log.info(result, 'Streak reminder job finished.');
  }, {
    timezone: JOBS_TIMEZONE
  });

  const streakReconciliationTask = cron.schedule(STREAK_CONFIG.RECONCILIATION_CRON, async () => {
    app.log.info('Running streak reconciliation job.');
    const result = await runStreakReconciliation();
    app.log.info(result, 'Streak reconciliation job finished.');
  }, {
    timezone: JOBS_TIMEZONE
  });

  const marketingCampaignTask = cron.schedule(MARKETING_CONFIG.CAMPAIGN_CRON, async () => {
    app.log.info('Running marketing campaign job.');
    const result = await runMarketingCampaigns();
    app.log.info(result, 'Marketing campaign job finished.');
  }, {
    timezone: JOBS_TIMEZONE
  });

  const subscriptionAlertTask = cron.schedule(SUBSCRIPTION_ALERT_CONFIG.CRON, async () => {
    app.log.info('Running subscription expiry alert job.');
    const result = await runSubscriptionAlerts();
    app.log.info(result, 'Subscription expiry alert job finished.');
  }, {
    timezone: JOBS_TIMEZONE
  });

  const notificationMaintenanceTask = cron.schedule(NOTIFICATIONS_CONFIG.CLEANUP_CRON, async () => {
    app.log.info('Running notification maintenance job.');
    const result = await runNotificationMaintenance();
    app.log.info(result, 'Notification maintenance job finished.');
  }, {
    timezone: JOBS_TIMEZONE
  });

  const weeklyLeaderboardResetTask = cron.schedule(LEADERBOARD_WEEKLY_RESET_CRON, async () => {
    app.log.info('Running weekly leaderboard reset job.');
    await runWeeklyLeaderboardReset(app);
  }, {
    timezone: JOBS_TIMEZONE
  });

  app.addHook('onClose', async () => {
    subscriptionExpiryTask.stop();
    passwordChangeAlertTask.stop();
    bookmarkCleanupTask.stop();
    adminAnalyticsRollupTask.stop();
    streakReminderTask.stop();
    streakReconciliationTask.stop();
    marketingCampaignTask.stop();
    subscriptionAlertTask.stop();
    notificationMaintenanceTask.stop();
    weeklyLeaderboardResetTask.stop();
  });

  app.log.info({ timezone: JOBS_TIMEZONE }, 'Background jobs scheduled.');
}

import { FastifyInstance } from 'fastify';
import cron from 'node-cron';
import { ADMIN_ANALYTICS_CONFIG, AUTH_CONFIG, BOOKMARK_CONFIG, STREAK_CONFIG } from '../config/constants';
import { refreshAdminAnalyticsRollups } from './admin-analytics-rollups';
import { runExpiredBookmarkCleanup } from './bookmark-cleanup';
import { runStreakReconciliation, runStreakReminderCheck } from './email-reminders';
import { runPasswordChangeAlertCheck } from './password-change-alerts';
import { runWeeklyLeaderboardReset } from './weekly-reset';
import { runSubscriptionExpiryCheck } from './subscription-check';

const JOBS_ENABLED = process.env.JOBS_ENABLED === 'true';
const JOBS_TIMEZONE = process.env.JOBS_TIMEZONE || 'Africa/Lagos';

export function setupBackgroundJobs(app: FastifyInstance): void {
  if (!JOBS_ENABLED) {
    app.log.info('Background jobs are disabled (JOBS_ENABLED=false).');
    return;
  }

  const weeklyResetTask = cron.schedule('59 23 * * 0', async () => {
    app.log.info('Running weekly leaderboard reset job.');
    await runWeeklyLeaderboardReset(app);
  }, {
    timezone: JOBS_TIMEZONE
  });

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

  app.addHook('onClose', async () => {
    weeklyResetTask.stop();
    subscriptionExpiryTask.stop();
    passwordChangeAlertTask.stop();
    bookmarkCleanupTask.stop();
    adminAnalyticsRollupTask.stop();
    streakReminderTask.stop();
    streakReconciliationTask.stop();
  });

  app.log.info({ timezone: JOBS_TIMEZONE }, 'Background jobs scheduled.');
}

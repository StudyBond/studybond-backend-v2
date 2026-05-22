import { notificationsService } from '../modules/notifications/notifications.service';

export async function runNotificationMaintenance(now = new Date()) {
  return notificationsService.cleanupExpiredActivityNotifications(now);
}

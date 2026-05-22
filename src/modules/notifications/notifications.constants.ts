import {
  NotificationCategory,
  NotificationKind,
  NotificationPriority,
} from "@prisma/client";

export const NOTIFICATION_WEBSOCKET_EVENTS = {
  SUMMARY: "notification.summary",
  ACTIVITY_CREATED: "notification.activity.created",
  ACTIVITY_UPDATED: "notification.activity.updated",
  ERROR: "notification.error",
} as const;

export const NOTIFICATION_PREFERENCE_KEYS = [
  "streaks",
  "achievements",
  "collaboration",
  "subscription",
  "reports",
  "announcements",
] as const;

export type NotificationPreferenceKey =
  (typeof NOTIFICATION_PREFERENCE_KEYS)[number];

export type NotificationPreferences = Record<NotificationPreferenceKey, boolean>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  streaks: true,
  achievements: true,
  collaboration: true,
  subscription: true,
  reports: true,
  announcements: true,
};

export const CATEGORY_TO_PREFERENCE_KEY: Record<
  NotificationCategory,
  NotificationPreferenceKey
> = {
  STREAKS: "streaks",
  ACHIEVEMENTS: "achievements",
  COLLABORATION: "collaboration",
  SUBSCRIPTION: "subscription",
  REPORTS: "reports",
  ANNOUNCEMENTS: "announcements",
};

export const KIND_TO_CATEGORY: Record<NotificationKind, NotificationCategory> = {
  STREAK_MILESTONE: NotificationCategory.STREAKS,
  STREAK_FREEZER_AWARDED: NotificationCategory.STREAKS,
  STREAK_AT_RISK: NotificationCategory.STREAKS,
  ACHIEVEMENT_UNLOCKED: NotificationCategory.ACHIEVEMENTS,
  SUBSCRIPTION_ACTIVATED: NotificationCategory.SUBSCRIPTION,
  SUBSCRIPTION_EXTENDED: NotificationCategory.SUBSCRIPTION,
  SUBSCRIPTION_EXPIRY_WARNING: NotificationCategory.SUBSCRIPTION,
  SUBSCRIPTION_EXPIRED: NotificationCategory.SUBSCRIPTION,
  REPORT_REVIEWED: NotificationCategory.REPORTS,
  REPORT_RESOLVED: NotificationCategory.REPORTS,
  COLLAB_SESSION_STARTED: NotificationCategory.COLLABORATION,
  COLLAB_SESSION_CANCELLED: NotificationCategory.COLLABORATION,
  COLLAB_SESSION_COMPLETED: NotificationCategory.COLLABORATION,
};

export const KIND_TO_DEFAULT_PRIORITY: Record<
  NotificationKind,
  NotificationPriority
> = {
  STREAK_MILESTONE: NotificationPriority.HIGH,
  STREAK_FREEZER_AWARDED: NotificationPriority.HIGH,
  STREAK_AT_RISK: NotificationPriority.HIGH,
  ACHIEVEMENT_UNLOCKED: NotificationPriority.HIGH,
  SUBSCRIPTION_ACTIVATED: NotificationPriority.HIGH,
  SUBSCRIPTION_EXTENDED: NotificationPriority.HIGH,
  SUBSCRIPTION_EXPIRY_WARNING: NotificationPriority.HIGH,
  SUBSCRIPTION_EXPIRED: NotificationPriority.URGENT,
  REPORT_REVIEWED: NotificationPriority.DEFAULT,
  REPORT_RESOLVED: NotificationPriority.DEFAULT,
  COLLAB_SESSION_STARTED: NotificationPriority.HIGH,
  COLLAB_SESSION_CANCELLED: NotificationPriority.HIGH,
  COLLAB_SESSION_COMPLETED: NotificationPriority.DEFAULT,
};

export function resolveNotificationPreferences(
  raw: unknown
): NotificationPreferences {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }

  const candidate = raw as Record<string, unknown>;
  return NOTIFICATION_PREFERENCE_KEYS.reduce<NotificationPreferences>(
    (preferences, key) => {
      preferences[key] =
        typeof candidate[key] === "boolean"
          ? (candidate[key] as boolean)
          : DEFAULT_NOTIFICATION_PREFERENCES[key];
      return preferences;
    },
    { ...DEFAULT_NOTIFICATION_PREFERENCES }
  );
}

export function mergeNotificationPreferences(
  current: unknown,
  updates: Partial<NotificationPreferences>
): NotificationPreferences {
  return {
    ...resolveNotificationPreferences(current),
    ...updates,
  };
}

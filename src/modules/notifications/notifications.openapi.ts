import { z } from "zod";
import {
  isoDateTimeSchema,
  paginationSchema,
  successEnvelopeSchema,
} from "../../shared/openapi/responses";

export const notificationPreferencesSchema = z
  .object({
    streaks: z.boolean(),
    achievements: z.boolean(),
    collaboration: z.boolean(),
    subscription: z.boolean(),
    reports: z.boolean(),
    announcements: z.boolean(),
  })
  .strict();

export const notificationSummaryCountsSchema = z
  .object({
    unreadActivityCount: z.number().int().nonnegative(),
    unreadAnnouncementCount: z.number().int().nonnegative(),
    totalUnreadCount: z.number().int().nonnegative(),
  })
  .strict();

export const notificationActivityItemSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    category: z.string(),
    priority: z.string(),
    title: z.string(),
    body: z.string(),
    deeplink: z.string().nullable(),
    payload: z.unknown().nullable(),
    sourceType: z.string(),
    sourceId: z.string().nullable(),
    availableAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema.nullable(),
    readAt: isoDateTimeSchema.nullable(),
    dismissedAt: isoDateTimeSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    isRead: z.boolean(),
    isDismissed: z.boolean(),
  })
  .strict();

export const notificationAnnouncementItemSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    body: z.string(),
    deeplink: z.string().nullable(),
    priority: z.string(),
    audience: z.string(),
    institutionId: z.number().int().positive().nullable(),
    institutionCode: z.string().nullable(),
    institutionName: z.string().nullable(),
    verifiedOnly: z.boolean(),
    startAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema.nullable(),
    createdAt: isoDateTimeSchema,
    isRead: z.boolean(),
    isDismissed: z.boolean(),
    readAt: isoDateTimeSchema.nullable(),
    dismissedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export const notificationSummarySchema = z
  .object({
    counts: notificationSummaryCountsSchema,
    recentActivity: z.array(notificationActivityItemSchema),
    activeAnnouncements: z.array(notificationAnnouncementItemSchema),
    preferences: notificationPreferencesSchema,
  })
  .strict();

export const notificationActivityListSchema = z
  .object({
    items: z.array(notificationActivityItemSchema),
    pagination: paginationSchema,
    counts: notificationSummaryCountsSchema,
  })
  .strict();

export const notificationAnnouncementsListSchema = z
  .object({
    items: z.array(notificationAnnouncementItemSchema),
    pagination: paginationSchema,
    counts: notificationSummaryCountsSchema,
  })
  .strict();

export const notificationPreferencesResponseSchema = z
  .object({
    preferences: notificationPreferencesSchema,
  })
  .strict();

export const notificationActivityMutationSchema = z
  .object({
    notification: notificationActivityItemSchema,
    counts: notificationSummaryCountsSchema,
  })
  .strict();

export const notificationReadAllSchema = z
  .object({
    updatedCount: z.number().int().nonnegative(),
    counts: notificationSummaryCountsSchema,
  })
  .strict();

export const notificationAnnouncementMutationSchema = z
  .object({
    announcement: notificationAnnouncementItemSchema,
    counts: notificationSummaryCountsSchema,
  })
  .strict();

export const adminAnnouncementRecordSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    body: z.string(),
    deeplink: z.string().nullable(),
    priority: z.string(),
    targetAudience: z.string(),
    institutionId: z.number().int().positive().nullable(),
    institutionCode: z.string().nullable(),
    institutionName: z.string().nullable(),
    verifiedOnly: z.boolean(),
    startAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema.nullable(),
    cancelledAt: isoDateTimeSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    createdByAdminId: z.number().int().positive(),
  })
  .strict();

export const adminAnnouncementsListSchema = z
  .object({
    items: z.array(adminAnnouncementRecordSchema),
    pagination: paginationSchema,
  })
  .strict();

export const adminAnnouncementMutationSchema = z
  .object({
    announcement: adminAnnouncementRecordSchema,
  })
  .strict();

export const notificationsSummaryEnvelopeSchema =
  successEnvelopeSchema(notificationSummarySchema);
export const notificationsActivityEnvelopeSchema =
  successEnvelopeSchema(notificationActivityListSchema);
export const notificationsAnnouncementsEnvelopeSchema =
  successEnvelopeSchema(notificationAnnouncementsListSchema);
export const notificationsPreferencesEnvelopeSchema =
  successEnvelopeSchema(notificationPreferencesResponseSchema);
export const notificationsActivityMutationEnvelopeSchema =
  successEnvelopeSchema(notificationActivityMutationSchema);
export const notificationsReadAllEnvelopeSchema =
  successEnvelopeSchema(notificationReadAllSchema);
export const notificationsAnnouncementMutationEnvelopeSchema =
  successEnvelopeSchema(notificationAnnouncementMutationSchema);
export const adminAnnouncementsEnvelopeSchema =
  successEnvelopeSchema(adminAnnouncementsListSchema);
export const adminAnnouncementMutationEnvelopeSchema =
  successEnvelopeSchema(adminAnnouncementMutationSchema);

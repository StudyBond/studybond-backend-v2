import { z } from "zod";
import { NOTIFICATIONS_CONFIG } from "../../config/constants";

const notificationIdPattern = /^\d+$/;

export const notificationStateFilterSchema = z.enum(["all", "unread"]).default("all");
export const notificationPrioritySchema = z.enum(["LOW", "DEFAULT", "HIGH", "URGENT"]);
export const notificationAudienceSchema = z.enum(["ALL", "PREMIUM", "FREE"]);

export const notificationsSummaryQuerySchema = z
  .object({
    recentLimit: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .optional(),
  })
  .strict();

export const notificationActivityQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(NOTIFICATIONS_CONFIG.ACTIVITY_PAGE_SIZE),
    state: notificationStateFilterSchema,
    category: z
      .enum([
        "STREAKS",
        "ACHIEVEMENTS",
        "COLLABORATION",
        "SUBSCRIPTION",
        "REPORTS",
      ])
      .optional(),
  })
  .strict();

export const notificationAnnouncementsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(NOTIFICATIONS_CONFIG.ANNOUNCEMENT_PAGE_SIZE),
    state: notificationStateFilterSchema,
  })
  .strict();

export const notificationIdParamSchema = z
  .object({
    notificationId: z.string().regex(notificationIdPattern, "Invalid notification id."),
  })
  .strict();

export const announcementIdParamSchema = z
  .object({
    announcementId: z.string().regex(notificationIdPattern, "Invalid announcement id."),
  })
  .strict();

export const notificationPreferencesPatchSchema = z
  .object({
    streaks: z.boolean().optional(),
    achievements: z.boolean().optional(),
    collaboration: z.boolean().optional(),
    subscription: z.boolean().optional(),
    reports: z.boolean().optional(),
    announcements: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((entry) => typeof entry === "boolean"),
    "Provide at least one notification preference to update."
  );

export const notificationsWsAuthQuerySchema = z
  .object({
    token: z.string().trim().min(1).optional(),
  })
  .strict();

export const adminAnnouncementCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(4000),
    deeplink: z.string().trim().min(1).max(512).optional().nullable(),
    priority: notificationPrioritySchema.default("DEFAULT"),
    targetAudience: notificationAudienceSchema.default("ALL"),
    institutionCode: z.string().trim().min(2).max(24).optional().nullable(),
    verifiedOnly: z.boolean().default(false),
    startAt: z.string().datetime(),
    expiresAt: z.string().datetime().optional().nullable(),
  })
  .strict()
  .refine(
    (value) =>
      !value.expiresAt || new Date(value.expiresAt).getTime() > new Date(value.startAt).getTime(),
    "expiresAt must be after startAt."
  );

export const adminAnnouncementsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    status: z
      .enum(["all", "scheduled", "active", "expired", "cancelled"])
      .default("all"),
  })
  .strict();

export type NotificationSummaryQuery = z.infer<typeof notificationsSummaryQuerySchema>;
export type NotificationActivityQuery = z.infer<typeof notificationActivityQuerySchema>;
export type NotificationAnnouncementsQuery = z.infer<typeof notificationAnnouncementsQuerySchema>;
export type NotificationPreferencesPatch = z.infer<typeof notificationPreferencesPatchSchema>;
export type AdminAnnouncementCreateInput = z.infer<typeof adminAnnouncementCreateSchema>;
export type AdminAnnouncementsQuery = z.infer<typeof adminAnnouncementsQuerySchema>;

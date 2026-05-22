import { FastifyInstance } from "fastify";
import { authenticate } from "../../shared/decorators/authenticate";
import { requireSuperadmin } from "../../shared/decorators/requireAdmin";
import { withStandardErrorResponses } from "../../shared/openapi/responses";
import { sensitiveAdminHeadersSchema } from "../admin/admin.schema";
import { notificationsController } from "./notifications.controller";
import {
  adminAnnouncementsEnvelopeSchema,
  adminAnnouncementMutationEnvelopeSchema,
  notificationsActivityEnvelopeSchema,
  notificationsActivityMutationEnvelopeSchema,
  notificationsAnnouncementMutationEnvelopeSchema,
  notificationsAnnouncementsEnvelopeSchema,
  notificationsPreferencesEnvelopeSchema,
  notificationsReadAllEnvelopeSchema,
  notificationsSummaryEnvelopeSchema,
} from "./notifications.openapi";
import {
  adminAnnouncementCreateSchema,
  adminAnnouncementsQuerySchema,
  announcementIdParamSchema,
  notificationActivityQuerySchema,
  notificationAnnouncementsQuerySchema,
  notificationIdParamSchema,
  notificationPreferencesPatchSchema,
  notificationsSummaryQuerySchema,
  notificationsWsAuthQuerySchema,
} from "./notifications.schema";

export async function notificationsRoutes(app: FastifyInstance, options: { wsHandler: any }) {
  app.get("/notifications/summary", {
    preHandler: [authenticate],
    schema: {
      tags: ["Notifications"],
      summary: "Get notifications summary",
      querystring: notificationsSummaryQuerySchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: notificationsSummaryEnvelopeSchema,
      }),
    },
  }, notificationsController.getSummary);

  app.get("/notifications/activity", {
    preHandler: [authenticate],
    schema: {
      tags: ["Notifications"],
      summary: "List activity notifications",
      querystring: notificationActivityQuerySchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: notificationsActivityEnvelopeSchema,
      }),
    },
  }, notificationsController.getActivity);

  app.get("/notifications/announcements", {
    preHandler: [authenticate],
    schema: {
      tags: ["Notifications"],
      summary: "List visible announcements",
      querystring: notificationAnnouncementsQuerySchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: notificationsAnnouncementsEnvelopeSchema,
      }),
    },
  }, notificationsController.getAnnouncements);

  app.get("/notifications/preferences", {
    preHandler: [authenticate],
    schema: {
      tags: ["Notifications"],
      summary: "Get notification preferences",
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: notificationsPreferencesEnvelopeSchema,
      }),
    },
  }, notificationsController.getPreferences);

  app.patch("/notifications/preferences", {
    preHandler: [authenticate],
    schema: {
      tags: ["Notifications"],
      summary: "Update notification preferences",
      body: notificationPreferencesPatchSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: notificationsPreferencesEnvelopeSchema,
      }),
    },
  }, notificationsController.updatePreferences);

  app.patch("/notifications/activity/read-all", {
    preHandler: [authenticate],
    schema: {
      tags: ["Notifications"],
      summary: "Mark all visible activity notifications as read",
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: notificationsReadAllEnvelopeSchema,
      }),
    },
  }, notificationsController.markAllActivityRead);

  app.patch("/notifications/activity/:notificationId/read", {
    preHandler: [authenticate],
    schema: {
      tags: ["Notifications"],
      summary: "Mark one activity notification as read",
      params: notificationIdParamSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: notificationsActivityMutationEnvelopeSchema,
      }),
    },
  }, notificationsController.markActivityRead);

  app.patch("/notifications/activity/:notificationId/dismiss", {
    preHandler: [authenticate],
    schema: {
      tags: ["Notifications"],
      summary: "Dismiss one activity notification",
      params: notificationIdParamSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: notificationsActivityMutationEnvelopeSchema,
      }),
    },
  }, notificationsController.dismissActivity);

  app.patch("/notifications/announcements/:announcementId/read", {
    preHandler: [authenticate],
    schema: {
      tags: ["Notifications"],
      summary: "Mark one announcement as read",
      params: announcementIdParamSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: notificationsAnnouncementMutationEnvelopeSchema,
      }),
    },
  }, notificationsController.markAnnouncementRead);

  app.patch("/notifications/announcements/:announcementId/dismiss", {
    preHandler: [authenticate],
    schema: {
      tags: ["Notifications"],
      summary: "Dismiss one announcement",
      params: announcementIdParamSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: notificationsAnnouncementMutationEnvelopeSchema,
      }),
    },
  }, notificationsController.dismissAnnouncement);

  app.get("/notifications/ws", {
    websocket: true,
    schema: {
      hide: true,
      querystring: notificationsWsAuthQuerySchema,
    },
  }, options.wsHandler);

  app.get("/admin/notifications/announcements", {
    preHandler: [authenticate, requireSuperadmin],
    schema: {
      tags: ["Admin"],
      summary: "List admin announcements",
      querystring: adminAnnouncementsQuerySchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: adminAnnouncementsEnvelopeSchema,
      }),
    },
  }, notificationsController.listAdminAnnouncements);

  app.post("/admin/notifications/announcements", {
    preHandler: [authenticate, requireSuperadmin],
    schema: {
      tags: ["Admin"],
      summary: "Create admin announcement",
      headers: sensitiveAdminHeadersSchema,
      body: adminAnnouncementCreateSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        201: adminAnnouncementMutationEnvelopeSchema,
      }),
    },
  }, notificationsController.createAdminAnnouncement);

  app.patch("/admin/notifications/announcements/:announcementId/cancel", {
    preHandler: [authenticate, requireSuperadmin],
    schema: {
      tags: ["Admin"],
      summary: "Cancel admin announcement",
      headers: sensitiveAdminHeadersSchema,
      params: announcementIdParamSchema,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: adminAnnouncementMutationEnvelopeSchema,
      }),
    },
  }, notificationsController.cancelAdminAnnouncement);
}

import { FastifyReply, FastifyRequest } from "fastify";
import { parseWithSchema } from "../../shared/utils/validation";
import {
  adminAnnouncementCreateSchema,
  adminAnnouncementsQuerySchema,
  announcementIdParamSchema,
  notificationActivityQuerySchema,
  notificationAnnouncementsQuerySchema,
  notificationIdParamSchema,
  notificationPreferencesPatchSchema,
  notificationsSummaryQuerySchema,
} from "./notifications.schema";
import { notificationsService } from "./notifications.service";

interface AuthenticatedRequestUser {
  userId: number;
  role: string;
  sessionId?: string;
}

export class NotificationsController {
  private getUser(request: FastifyRequest): AuthenticatedRequestUser {
    return request.user as AuthenticatedRequestUser;
  }

  private getAdminContext(request: FastifyRequest) {
    const user = this.getUser(request);
    return {
      actorId: user.userId,
      actorRole: user.role,
      sessionId: user.sessionId,
      ipAddress: request.ip,
      idempotencyKey:
        typeof request.headers["idempotency-key"] === "string"
          ? request.headers["idempotency-key"]
          : undefined,
      stepUpToken:
        typeof request.headers["x-admin-step-up-token"] === "string"
          ? request.headers["x-admin-step-up-token"]
          : undefined,
    };
  }

  getSummary = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = this.getUser(request);
    const query = parseWithSchema(
      notificationsSummaryQuerySchema,
      request.query ?? {},
      "Invalid notifications summary query."
    );
    const data = await notificationsService.getSummary(user.userId, query);
    return reply.send({ success: true, data });
  };

  getActivity = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = this.getUser(request);
    const query = parseWithSchema(
      notificationActivityQuerySchema,
      request.query ?? {},
      "Invalid notifications activity query."
    );
    const data = await notificationsService.getActivity(user.userId, query);
    return reply.send({ success: true, data });
  };

  getAnnouncements = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = this.getUser(request);
    const query = parseWithSchema(
      notificationAnnouncementsQuerySchema,
      request.query ?? {},
      "Invalid notifications announcements query."
    );
    const data = await notificationsService.getAnnouncements(user.userId, query);
    return reply.send({ success: true, data });
  };

  getPreferences = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = this.getUser(request);
    const data = await notificationsService.getPreferences(user.userId);
    return reply.send({ success: true, data });
  };

  updatePreferences = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = this.getUser(request);
    const payload = parseWithSchema(
      notificationPreferencesPatchSchema,
      request.body,
      "Invalid notification preferences payload."
    );
    const data = await notificationsService.updatePreferences(user.userId, payload);
    return reply.send({ success: true, data });
  };

  markActivityRead = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = this.getUser(request);
    const params = parseWithSchema(
      notificationIdParamSchema,
      request.params,
      "Invalid notification id."
    );
    const data = await notificationsService.markActivityRead(
      user.userId,
      params.notificationId
    );
    return reply.send({ success: true, data });
  };

  markAllActivityRead = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = this.getUser(request);
    const data = await notificationsService.markAllActivityRead(user.userId);
    return reply.send({ success: true, data });
  };

  dismissActivity = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = this.getUser(request);
    const params = parseWithSchema(
      notificationIdParamSchema,
      request.params,
      "Invalid notification id."
    );
    const data = await notificationsService.dismissActivity(
      user.userId,
      params.notificationId
    );
    return reply.send({ success: true, data });
  };

  markAnnouncementRead = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = this.getUser(request);
    const params = parseWithSchema(
      announcementIdParamSchema,
      request.params,
      "Invalid announcement id."
    );
    const data = await notificationsService.markAnnouncementRead(
      user.userId,
      params.announcementId
    );
    return reply.send({ success: true, data });
  };

  dismissAnnouncement = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = this.getUser(request);
    const params = parseWithSchema(
      announcementIdParamSchema,
      request.params,
      "Invalid announcement id."
    );
    const data = await notificationsService.dismissAnnouncement(
      user.userId,
      params.announcementId
    );
    return reply.send({ success: true, data });
  };

  createAdminAnnouncement = async (request: FastifyRequest, reply: FastifyReply) => {
    const payload = parseWithSchema(
      adminAnnouncementCreateSchema,
      request.body,
      "Invalid announcement payload."
    );
    const context = this.getAdminContext(request);
    const data = await notificationsService.createAdminAnnouncement(
      context.actorId,
      context.actorRole,
      payload,
      context
    );
    return reply.status(201).send({ success: true, data });
  };

  listAdminAnnouncements = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = parseWithSchema(
      adminAnnouncementsQuerySchema,
      request.query ?? {},
      "Invalid admin announcements query."
    );
    const context = this.getAdminContext(request);
    const data = await notificationsService.listAdminAnnouncements(
      context.actorId,
      context.actorRole,
      query
    );
    return reply.send({ success: true, data });
  };

  cancelAdminAnnouncement = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = parseWithSchema(
      announcementIdParamSchema,
      request.params,
      "Invalid announcement id."
    );
    const context = this.getAdminContext(request);
    const data = await notificationsService.cancelAdminAnnouncement(
      context.actorId,
      context.actorRole,
      params.announcementId,
      context
    );
    return reply.send({ success: true, data });
  };
}

export const notificationsController = new NotificationsController();

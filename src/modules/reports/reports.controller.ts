import { FastifyReply, FastifyRequest } from 'fastify';
import { parseWithSchema } from '../../shared/utils/validation';
import {
  adminReportQuerySchema,
  createReportSchema,
  hardDeleteReportSchema,
  reportIdParamSchema,
  reportQuerySchema,
  updateReportStatusSchema
} from './reports.schema';
import { reportsService } from './reports.service';

interface AuthenticatedRequestUser {
  userId: number;
  role: 'USER' | 'ADMIN' | 'SUPERADMIN';
}

export class ReportsController {
  createReport = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const payload = parseWithSchema(createReportSchema, req.body, 'Invalid report payload');
    const data = await reportsService.createReport(userId, payload);

    return reply.status(201).send({
      success: true,
      data
    });
  };

  getUserReports = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const query = parseWithSchema(reportQuerySchema, req.query, 'Invalid report query parameters');
    const data = await reportsService.getUserReports(userId, query);

    return reply.status(200).send({
      success: true,
      data
    });
  };

  getUserReportById = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const params = parseWithSchema(reportIdParamSchema, req.params, 'Invalid report id');
    const data = await reportsService.getReportById(userId, params.reportId);

    return reply.status(200).send({
      success: true,
      data
    });
  };

  deleteUserReport = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const params = parseWithSchema(reportIdParamSchema, req.params, 'Invalid report id');
    const data = await reportsService.deleteReport(userId, params.reportId);

    return reply.status(200).send({
      success: true,
      data
    });
  };

  listAdminReports = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user as AuthenticatedRequestUser;
    const query = parseWithSchema(adminReportQuerySchema, req.query, 'Invalid admin report query parameters');
    const data = await reportsService.listAdminReports(user.userId, user.role, query, req.ip);

    return reply.status(200).send({
      success: true,
      data
    });
  };

  getAdminReportById = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user as AuthenticatedRequestUser;
    const params = parseWithSchema(reportIdParamSchema, req.params, 'Invalid report id');
    const data = await reportsService.getAdminReportById(user.userId, user.role, params.reportId, req.ip);

    return reply.status(200).send({
      success: true,
      data
    });
  };

  updateAdminReportStatus = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user as AuthenticatedRequestUser;
    const params = parseWithSchema(reportIdParamSchema, req.params, 'Invalid report id');
    const payload = parseWithSchema(updateReportStatusSchema, req.body, 'Invalid report moderation payload');
    const data = await reportsService.updateReportStatus(user.userId, user.role, params.reportId, payload, req.ip);

    return reply.status(200).send({
      success: true,
      data
    });
  };

  hardDeleteAdminReport = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user as AuthenticatedRequestUser;
    const params = parseWithSchema(reportIdParamSchema, req.params, 'Invalid report id');
    const payload = parseWithSchema(hardDeleteReportSchema, req.body, 'Invalid hard delete payload');
    const data = await reportsService.hardDeleteReport(user.userId, user.role, params.reportId, payload.reason, req.ip);

    return reply.status(200).send({
      success: true,
      data
    });
  };
}

export const reportsController = new ReportsController();

import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { auditService } from '../admin/audit.service';
import { hasRoleAtLeast } from '../../shared/decorators/requireAdmin';
import { AppError } from '../../shared/errors/AppError';
import { ForbiddenError } from '../../shared/errors/ForbiddenError';
import { NotFoundError } from '../../shared/errors/NotFoundError';
import {
  AdminReportQuery,
  CreateReportInput,
  ReportQuery,
  UpdateReportStatusInput
} from './reports.schema';

type ReportTx = Prisma.TransactionClient;

const reportQuestionSelect = {
  id: true,
  questionText: true,
  subject: true,
  topic: true,
  questionType: true,
  questionPool: true,
  hasImage: true,
  imageUrl: true
} satisfies Prisma.QuestionSelect;

const reportUserSelect = {
  id: true,
  email: true,
  fullName: true
} satisfies Prisma.UserSelect;

const userReportInclude = {
  question: {
    select: reportQuestionSelect
  }
} satisfies Prisma.QuestionReportInclude;

const adminReportInclude = {
  question: {
    select: reportQuestionSelect
  },
  user: {
    select: reportUserSelect
  },
  reviewedByAdmin: {
    select: reportUserSelect
  },
  resolvedByAdmin: {
    select: reportUserSelect
  }
} satisfies Prisma.QuestionReportInclude;

type UserOwnedReport = Prisma.QuestionReportGetPayload<{
  include: typeof userReportInclude;
}>;

type AdminVisibleReport = Prisma.QuestionReportGetPayload<{
  include: typeof adminReportInclude;
}>;

function serializeUserReport(report: UserOwnedReport) {
  return {
    id: report.id,
    questionId: report.questionId,
    issueType: report.issueType,
    description: report.description,
    status: report.status,
    adminNote: report.adminNote,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    reviewedAt: report.reviewedAt ? report.reviewedAt.toISOString() : null,
    resolvedAt: report.resolvedAt ? report.resolvedAt.toISOString() : null,
    question: {
      id: report.question.id,
      questionText: report.question.questionText,
      subject: report.question.subject,
      topic: report.question.topic,
      questionType: report.question.questionType,
      questionPool: report.question.questionPool,
      hasImage: report.question.hasImage,
      imageUrl: report.question.imageUrl
    }
  };
}

function serializeAdminReport(report: AdminVisibleReport) {
  return {
    id: report.id,
    issueType: report.issueType,
    description: report.description,
    status: report.status,
    adminNote: report.adminNote,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    reviewedAt: report.reviewedAt ? report.reviewedAt.toISOString() : null,
    resolvedAt: report.resolvedAt ? report.resolvedAt.toISOString() : null,
    reporter: {
      id: report.user.id,
      email: report.user.email,
      fullName: report.user.fullName
    },
    question: {
      id: report.question.id,
      questionText: report.question.questionText,
      subject: report.question.subject,
      topic: report.question.topic,
      questionType: report.question.questionType,
      questionPool: report.question.questionPool,
      hasImage: report.question.hasImage,
      imageUrl: report.question.imageUrl
    },
    reviewedByAdmin: report.reviewedByAdmin
      ? {
          id: report.reviewedByAdmin.id,
          email: report.reviewedByAdmin.email,
          fullName: report.reviewedByAdmin.fullName
        }
      : null,
    resolvedByAdmin: report.resolvedByAdmin
      ? {
          id: report.resolvedByAdmin.id,
          email: report.resolvedByAdmin.email,
          fullName: report.resolvedByAdmin.fullName
        }
      : null
  };
}

export class ReportsService {
  private async createAdminAuditLogTx(
    tx: ReportTx,
    entry: {
      actorId: number;
      actorRole: string;
      action: 'REPORT_REVIEWED' | 'REPORT_RESOLVED' | 'REPORT_HARD_DELETED';
      targetId: string;
      metadata?: Prisma.InputJsonValue;
      reason?: string;
      ipAddress?: string;
    }
  ): Promise<void> {
    await tx.adminAuditLog.create({
      data: {
        actorId: entry.actorId,
        actorRole: entry.actorRole,
        action: entry.action as any,
        targetType: 'REPORT',
        targetId: entry.targetId,
        metadata: entry.metadata,
        reason: entry.reason,
        ipAddress: entry.ipAddress
      }
    });
  }

  private async assertAdminAccess(
    actorId: number,
    actorRole: string,
    attemptedAction: string,
    targetId?: string,
    ipAddress?: string
  ): Promise<void> {
    if (hasRoleAtLeast(actorRole, 'ADMIN')) {
      return;
    }

    await auditService.logUnauthorizedAttempt(
      actorId,
      actorRole,
      attemptedAction,
      'REPORT',
      targetId,
      ipAddress
    );

    throw new ForbiddenError('Admin access is required for this action.');
  }

  private async assertSuperadminAccess(
    actorId: number,
    actorRole: string,
    attemptedAction: string,
    targetId?: string,
    ipAddress?: string
  ): Promise<void> {
    if (actorRole === 'SUPERADMIN') {
      return;
    }

    await auditService.logUnauthorizedAttempt(
      actorId,
      actorRole,
      attemptedAction,
      'REPORT',
      targetId,
      ipAddress
    );

    throw new ForbiddenError('Superadmin access is required for this action.');
  }

  async createReport(userId: number, data: CreateReportInput) {
    const question = await prisma.question.findUnique({
      where: { id: data.questionId },
      select: { id: true }
    });

    if (!question) {
      throw new NotFoundError('Question not found.');
    }

    try {
      const report = await prisma.questionReport.create({
        data: {
          userId,
          questionId: data.questionId,
          issueType: data.issueType,
          description: data.description ?? null
        },
        include: userReportInclude
      });

      return serializeUserReport(report);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(
          'You already reported this issue for this question.',
          409,
          'REPORT_ALREADY_EXISTS'
        );
      }

      throw error;
    }
  }

  async getUserReports(userId: number, query: ReportQuery) {
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;

    const where: Prisma.QuestionReportWhereInput = {
      userId,
      ...(query.status ? { status: query.status } : {})
    };

    const [reports, total] = await Promise.all([
      prisma.questionReport.findMany({
        where,
        include: userReportInclude,
        orderBy: [
          { createdAt: 'desc' },
          { id: 'desc' }
        ],
        skip,
        take: limit
      }),
      prisma.questionReport.count({ where })
    ]);

    return {
      reports: reports.map(serializeUserReport),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit))
      }
    };
  }

  async getReportById(userId: number, reportId: number) {
    const report = await prisma.questionReport.findFirst({
      where: {
        id: reportId,
        userId
      },
      include: userReportInclude
    });

    if (!report) {
      throw new NotFoundError('Report not found.');
    }

    return serializeUserReport(report);
  }

  async deleteReport(userId: number, reportId: number) {
    const report = await prisma.questionReport.findFirst({
      where: {
        id: reportId,
        userId
      },
      select: {
        id: true,
        status: true
      }
    });

    if (!report) {
      throw new NotFoundError('Report not found.');
    }

    if (report.status !== 'PENDING') {
      throw new AppError(
        `This report has already been ${report.status.toLowerCase()} and can no longer be deleted.`,
        400,
        'REPORT_DELETE_LOCKED'
      );
    }

    await prisma.questionReport.delete({
      where: { id: reportId }
    });

    return {
      success: true,
      message: 'Report deleted successfully.'
    };
  }

  async listAdminReports(
    actorId: number,
    actorRole: string,
    query: AdminReportQuery,
    ipAddress?: string
  ) {
    await this.assertAdminAccess(actorId, actorRole, 'LIST_REPORTS', undefined, ipAddress);

    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;

    const baseWhere: Prisma.QuestionReportWhereInput = {
      ...(query.issueType ? { issueType: query.issueType } : {}),
      ...(query.questionId ? { questionId: query.questionId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.subject
        ? {
            question: {
              subject: query.subject
            }
          }
        : {})
    };

    const where: Prisma.QuestionReportWhereInput = {
      ...baseWhere,
      ...(query.status ? { status: query.status } : {})
    };

    const [reports, total, pendingCount, reviewedCount, resolvedCount] = await Promise.all([
      prisma.questionReport.findMany({
        where,
        include: adminReportInclude,
        orderBy: [
          { status: 'asc' },
          { createdAt: 'asc' },
          { id: 'asc' }
        ],
        skip,
        take: limit
      }),
      prisma.questionReport.count({ where }),
      prisma.questionReport.count({ where: { ...baseWhere, status: 'PENDING' } }),
      prisma.questionReport.count({ where: { ...baseWhere, status: 'REVIEWED' } }),
      prisma.questionReport.count({ where: { ...baseWhere, status: 'RESOLVED' } })
    ]);

    return {
      reports: reports.map(serializeAdminReport),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit))
      },
      summary: {
        pending: pendingCount,
        reviewed: reviewedCount,
        resolved: resolvedCount,
        totalTracked: pendingCount + reviewedCount + resolvedCount
      }
    };
  }

  async getAdminReportById(
    actorId: number,
    actorRole: string,
    reportId: number,
    ipAddress?: string
  ) {
    await this.assertAdminAccess(actorId, actorRole, 'GET_REPORT', String(reportId), ipAddress);

    const report = await prisma.questionReport.findUnique({
      where: { id: reportId },
      include: adminReportInclude
    });

    if (!report) {
      throw new NotFoundError('Report not found.');
    }

    return serializeAdminReport(report);
  }

  async updateReportStatus(
    actorId: number,
    actorRole: string,
    reportId: number,
    input: UpdateReportStatusInput,
    ipAddress?: string
  ) {
    await this.assertAdminAccess(actorId, actorRole, 'UPDATE_REPORT_STATUS', String(reportId), ipAddress);

    return prisma.$transaction(async (tx: ReportTx) => {
      const existing = await tx.questionReport.findUnique({
        where: { id: reportId },
        include: adminReportInclude
      });

      if (!existing) {
        throw new NotFoundError('Report not found.');
      }

      if (existing.status === input.status) {
        throw new AppError(
          `This report is already marked as ${input.status.toLowerCase()}.`,
          400,
          'REPORT_STATUS_UNCHANGED'
        );
      }

      if (existing.status === 'RESOLVED') {
        throw new AppError(
          'Resolved reports are final. Create a new report if the issue appears again later.',
          400,
          'REPORT_STATUS_LOCKED'
        );
      }

      const now = new Date();
      const updateData: Prisma.QuestionReportUpdateInput = {
        status: input.status,
        adminNote: input.adminNote
      };

      let auditAction: 'REPORT_REVIEWED' | 'REPORT_RESOLVED';

      if (input.status === 'REVIEWED') {
        auditAction = 'REPORT_REVIEWED';
        updateData.reviewedAt = existing.reviewedAt ?? now;
        updateData.reviewedByAdmin = {
          connect: { id: actorId }
        };
      } else {
        auditAction = 'REPORT_RESOLVED';
        updateData.reviewedAt = existing.reviewedAt ?? now;
        if (!existing.reviewedByAdminId) {
          updateData.reviewedByAdmin = {
            connect: { id: actorId }
          };
        }
        updateData.resolvedAt = now;
        updateData.resolvedByAdmin = {
          connect: { id: actorId }
        };
      }

      const updated = await tx.questionReport.update({
        where: { id: reportId },
        data: updateData,
        include: adminReportInclude
      });

      await this.createAdminAuditLogTx(tx, {
        actorId,
        actorRole,
        action: auditAction,
        targetId: String(reportId),
        metadata: {
          previousStatus: existing.status,
          nextStatus: updated.status,
          issueType: existing.issueType,
          questionId: existing.questionId,
          reporterUserId: existing.userId
        },
        reason: input.adminNote,
        ipAddress
      });

      return serializeAdminReport(updated);
    });
  }

  async hardDeleteReport(
    actorId: number,
    actorRole: string,
    reportId: number,
    reason: string,
    ipAddress?: string
  ) {
    await this.assertSuperadminAccess(actorId, actorRole, 'HARD_DELETE_REPORT', String(reportId), ipAddress);

    return prisma.$transaction(async (tx: ReportTx) => {
      const report = await tx.questionReport.findUnique({
        where: { id: reportId },
        include: adminReportInclude
      });

      if (!report) {
        throw new NotFoundError('Report not found.');
      }

      await this.createAdminAuditLogTx(tx, {
        actorId,
        actorRole,
        action: 'REPORT_HARD_DELETED',
        targetId: String(report.id),
        metadata: {
          issueType: report.issueType,
          status: report.status,
          questionId: report.questionId,
          reporterUserId: report.userId,
          description: report.description,
          adminNote: report.adminNote
        },
        reason,
        ipAddress
      });

      await tx.questionReport.delete({
        where: { id: report.id }
      });

      return {
        success: true,
        message: 'Report permanently deleted.'
      };
    });
  }
}

export const reportsService = new ReportsService();

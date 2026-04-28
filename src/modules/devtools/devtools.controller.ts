import { EmailType } from '@prisma/client';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../../shared/errors/AppError';
import { devOtpPreviewService } from '../../shared/devtools/otp-preview.service';

type OtpPreviewQuery = {
  email?: string;
  emailType?: EmailType;
  limit?: number;
};

export class DevToolsController {
  private assertOtpPreviewAccess(request: FastifyRequest): void {
    if (!devOtpPreviewService.isEnabled()) {
      throw new AppError('Route GET /internal/dev/otp-previews was not found.', 404, 'ROUTE_NOT_FOUND');
    }

    const token = typeof request.headers['x-dev-tools-token'] === 'string'
      ? request.headers['x-dev-tools-token']
      : undefined;

    if (!devOtpPreviewService.isAuthorized(token)) {
      throw new AppError(
        'The dev tools token is missing or invalid for this environment.',
        401,
        'DEV_TOOLS_UNAUTHORIZED'
      );
    }
  }

  listOtpPreviews = async (request: FastifyRequest, reply: FastifyReply) => {
    this.assertOtpPreviewAccess(request);

    const query = request.query as OtpPreviewQuery;
    const previews = await devOtpPreviewService.list({
      email: query.email,
      emailType: query.emailType,
      limit: query.limit
    });

    return reply.send({
      previews,
      meta: {
        count: previews.length,
        limit: query.limit ?? 5,
        filters: {
          email: query.email ?? null,
          emailType: query.emailType ?? null
        }
      }
    });
  };

  clearOtpPreviews = async (request: FastifyRequest, reply: FastifyReply) => {
    this.assertOtpPreviewAccess(request);

    const query = request.query as OtpPreviewQuery;
    const deletedCount = await devOtpPreviewService.clear({
      email: query.email,
      emailType: query.emailType
    });

    return reply.send({
      success: true,
      deletedCount
    });
  };
}

export const devToolsController = new DevToolsController();

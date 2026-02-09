// ============================================
// ADMIN CONTROLLER
// ============================================
// Request handlers for admin/superadmin operations
// All permission checks are enforced at route level + service level

import { FastifyRequest, FastifyReply } from 'fastify';
import { adminService } from './admin.service';
import { auditService } from './audit.service';
import { getAuthUser } from '../../shared/decorators/requireAdmin';
import { AppError } from '../../shared/errors/AppError';

// Types for request bodies/params (kept for manual casting if needed)
interface IdParam {
    id: string;
}

interface PaginationQuery {
    page?: string;
    limit?: string;
}

interface UserListQuery extends PaginationQuery {
    role?: string;
    isBanned?: string;
    isPremium?: string;
    search?: string;
}

interface PromoteBody {
    newRole: 'ADMIN' | 'SUPERADMIN';
}

interface BanBody {
    reason?: string;
}

interface DeviceRemoveBody {
    userId: number;
    reason?: string;
}

interface EmailToggleBody {
    enabled: boolean;
}

export class AdminController {

    private getIpAddress(request: FastifyRequest): string | undefined {
        return request.ip || (request.headers['x-forwarded-for'] as string) || undefined;
    }

    // ========================================
    // USER MANAGEMENT (ADMIN + SUPERADMIN)
    // ========================================

    /**
     * GET /admin/users
     * List users with filtering
     */
    getUsers = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const query = request.query as UserListQuery;

        const result = await adminService.getUsers({
            page: query.page ? parseInt(query.page) : 1,
            limit: query.limit ? parseInt(query.limit) : 20,
            role: query.role as any,
            isBanned: query.isBanned === 'true' ? true : query.isBanned === 'false' ? false : undefined,
            isPremium: query.isPremium === 'true' ? true : query.isPremium === 'false' ? false : undefined,
            search: query.search
        });

        return reply.send(result);
    };

    /**
     * POST /admin/users/:id/ban
     * Ban a user
     */
    banUser = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const params = request.params as IdParam;
        const body = request.body as BanBody;

        const userId = parseInt(params.id);
        const ipAddress = this.getIpAddress(request);

        if (isNaN(userId)) {
            throw new AppError('Invalid user ID', 400);
        }

        const result = await adminService.banUser(
            user.id,
            user.role,
            { userId, reason: body?.reason },
            ipAddress
        );

        return reply.send(result);
    };

    /**
     * POST /admin/users/:id/unban
     * Unban a user
     */
    unbanUser = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const params = request.params as IdParam;

        const userId = parseInt(params.id);
        const ipAddress = this.getIpAddress(request);

        if (isNaN(userId)) {
            throw new AppError('Invalid user ID', 400);
        }

        const result = await adminService.unbanUser(
            user.id,
            user.role,
            userId,
            ipAddress
        );

        return reply.send(result);
    };

    /**
     * DELETE /admin/devices/:id
     * Remove a device from a user account
     */
    removeDevice = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const params = request.params as { id: string };
        const body = request.body as DeviceRemoveBody;

        const deviceId = params.id;
        const { userId, reason } = body;
        const ipAddress = this.getIpAddress(request);

        const result = await adminService.removeDevice(
            user.id,
            user.role,
            { deviceId, userId, reason },
            ipAddress
        );

        return reply.send(result);
    };

    // ========================================
    // ROLE MANAGEMENT (SUPERADMIN ONLY)
    // ========================================

    /**
     * POST /admin/users/:id/promote
     * Promote a user to ADMIN or SUPERADMIN
     */
    promoteUser = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const params = request.params as IdParam;
        const body = request.body as PromoteBody;

        const userId = parseInt(params.id);
        const { newRole } = body;
        const ipAddress = this.getIpAddress(request);

        if (isNaN(userId)) {
            throw new AppError('Invalid user ID', 400);
        }

        if (!newRole || !['ADMIN', 'SUPERADMIN'].includes(newRole)) {
            throw new AppError('Invalid role. Must be ADMIN or SUPERADMIN', 400);
        }

        const result = await adminService.promoteUser(
            user.id,
            user.role,
            { userId, newRole },
            ipAddress
        );

        return reply.send(result);
    };

    /**
     * POST /admin/users/:id/demote
     * Demote a user to USER role
     */
    demoteUser = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const params = request.params as IdParam;
        const userId = parseInt(params.id);
        const ipAddress = this.getIpAddress(request);

        if (isNaN(userId)) {
            throw new AppError('Invalid user ID', 400);
        }

        const result = await adminService.demoteUser(
            user.id,
            user.role,
            { userId },
            ipAddress
        );

        return reply.send(result);
    };

    // ========================================
    // SUPERADMIN ONLY FEATURES
    // ========================================

    /**
     * GET /admin/premium-users
     * List premium subscribers (SUPERADMIN only)
     */
    getPremiumUsers = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const query = request.query as PaginationQuery;
        const page = query.page ? parseInt(query.page) : 1;
        const limit = query.limit ? parseInt(query.limit) : 20;

        const result = await adminService.getPremiumUsers(page, limit);
        return reply.send(result);
    };

    /**
     * GET /admin/system/settings
     * Get system settings
     */
    getSystemSettings = async (
        _request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const settings = await adminService.getSystemSettings();
        return reply.send(settings);
    };

    /**
     * POST /admin/system/email-toggle
     * Toggle email system (SUPERADMIN only)
     */
    toggleEmailSystem = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const body = request.body as EmailToggleBody;
        const { enabled } = body;
        const ipAddress = this.getIpAddress(request);

        if (typeof enabled !== 'boolean') {
            throw new AppError('enabled must be a boolean', 400);
        }

        const result = await adminService.toggleEmailSystem(
            user.id,
            user.role,
            enabled,
            ipAddress
        );

        return reply.send(result);
    };

    // ========================================
    // AUDIT LOGS (SUPERADMIN ONLY)
    // ========================================

    /**
     * GET /admin/audit-logs
     * View admin audit logs
     */
    getAuditLogs = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const query = request.query as {
            page?: string;
            limit?: string;
            actorId?: string;
            action?: string;
            targetType?: string;
            startDate?: string;
            endDate?: string;
        };

        const result = await auditService.getAuditLogs({
            page: query.page ? parseInt(query.page) : 1,
            limit: query.limit ? parseInt(query.limit) : 50,
            actorId: query.actorId ? parseInt(query.actorId) : undefined,
            action: query.action as any,
            targetType: query.targetType as any,
            startDate: query.startDate ? new Date(query.startDate) : undefined,
            endDate: query.endDate ? new Date(query.endDate) : undefined
        });

        return reply.send(result);
    };
}

// Singleton instance
export const adminController = new AdminController();

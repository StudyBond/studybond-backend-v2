// ============================================
// AUDIT SERVICE
// ============================================
// Centralized logging for all admin/superadmin actions
// Every sensitive operation MUST go through this service

import prisma from '../../config/database';
import { AuditLogEntry, AdminAuditAction, TargetType } from './admin.types';

export class AuditService {

    /**
     * Log an admin/superadmin action
     * This is the single source of truth for admin activity
     */
    async logAction(entry: AuditLogEntry): Promise<void> {
        try {
            await prisma.adminAuditLog.create({
                data: {
                    actorId: entry.actorId,
                    actorRole: entry.actorRole,
                    action: entry.action as any, // Prisma enum
                    targetType: entry.targetType,
                    targetId: entry.targetId,
                    metadata: entry.metadata as any, // Cast to any to satisfy Prisma InputJsonValue
                    reason: entry.reason,
                    ipAddress: entry.ipAddress
                }
            });
        } catch (error) {
            // Log failure should never break the primary operation
            // But we should log it somewhere for investigation
            console.error('[AUDIT_LOG_FAILURE]', { entry, error });
        }
    }

    /**
     * Log a successful role promotion
     */
    async logRolePromotion(
        actorId: number,
        actorRole: string,
        targetUserId: number,
        oldRole: string,
        newRole: string,
        ipAddress?: string
    ): Promise<void> {
        await this.logAction({
            actorId,
            actorRole,
            action: 'ROLE_PROMOTED',
            targetType: 'USER',
            targetId: String(targetUserId),
            metadata: { oldRole, newRole } as any,
            ipAddress
        });
    }

    /**
     * Log a successful role demotion
     */
    async logRoleDemotion(
        actorId: number,
        actorRole: string,
        targetUserId: number,
        oldRole: string,
        newRole: string,
        ipAddress?: string
    ): Promise<void> {
        await this.logAction({
            actorId,
            actorRole,
            action: 'ROLE_DEMOTED',
            targetType: 'USER',
            targetId: String(targetUserId),
            metadata: { oldRole, newRole } as any,
            ipAddress
        });
    }

    /**
     * Log a failed role change attempt (security event)
     */
    async logRoleChangeAttemptFailed(
        actorId: number,
        actorRole: string,
        targetUserId: number,
        attemptedAction: 'ROLE_PROMOTION_ATTEMPT_FAILED' | 'ROLE_DEMOTION_ATTEMPT_FAILED',
        reason: string,
        ipAddress?: string
    ): Promise<void> {
        await this.logAction({
            actorId,
            actorRole,
            action: attemptedAction,
            targetType: 'USER',
            targetId: String(targetUserId),
            reason,
            ipAddress
        });
    }

    /**
     * Log user ban action
     */
    async logUserBan(
        actorId: number,
        actorRole: string,
        targetUserId: number,
        reason?: string,
        ipAddress?: string
    ): Promise<void> {
        await this.logAction({
            actorId,
            actorRole,
            action: 'USER_BANNED',
            targetType: 'USER',
            targetId: String(targetUserId),
            reason,
            ipAddress
        });
    }

    /**
     * Log user unban action
     */
    async logUserUnban(
        actorId: number,
        actorRole: string,
        targetUserId: number,
        ipAddress?: string
    ): Promise<void> {
        await this.logAction({
            actorId,
            actorRole,
            action: 'USER_UNBANNED',
            targetType: 'USER',
            targetId: String(targetUserId),
            ipAddress
        });
    }

    /**
     * Log device removal action
     */
    async logDeviceRemoval(
        actorId: number,
        actorRole: string,
        deviceId: string,
        targetUserId: number,
        reason?: string,
        ipAddress?: string
    ): Promise<void> {
        await this.logAction({
            actorId,
            actorRole,
            action: 'DEVICE_REMOVED',
            targetType: 'DEVICE',
            targetId: deviceId,
            metadata: { targetUserId } as any,
            reason,
            ipAddress
        });
    }

    /**
     * Log email system toggle (SUPERADMIN only)
     */
    async logEmailToggle(
        actorId: number,
        actorRole: string,
        newState: boolean,
        ipAddress?: string
    ): Promise<void> {
        await this.logAction({
            actorId,
            actorRole,
            action: 'EMAIL_SYSTEM_TOGGLED',
            targetType: 'SYSTEM',
            metadata: { emailEnabled: newState } as any,
            ipAddress
        });
    }

    /**
     * Log question deletion
     */
    async logQuestionDeletion(
        actorId: number,
        actorRole: string,
        questionId: number,
        reason?: string,
        ipAddress?: string
    ): Promise<void> {
        await this.logAction({
            actorId,
            actorRole,
            action: 'QUESTION_DELETED',
            targetType: 'QUESTION',
            targetId: String(questionId),
            reason,
            ipAddress
        });
    }

    /**
     * Log unauthorized action attempt (security event)
     */
    async logUnauthorizedAttempt(
        actorId: number,
        actorRole: string,
        attemptedAction: string,
        targetType: TargetType,
        targetId?: string,
        ipAddress?: string
    ): Promise<void> {
        await this.logAction({
            actorId,
            actorRole,
            action: 'UNAUTHORIZED_ACTION_ATTEMPT',
            targetType,
            targetId,
            metadata: { attemptedAction } as any,
            ipAddress
        });
    }

    /**
     * Get audit logs with filtering (for internal review)
     */
    async getAuditLogs(options: {
        actorId?: number;
        action?: AdminAuditAction;
        targetType?: TargetType;
        startDate?: Date;
        endDate?: Date;
        page?: number;
        limit?: number;
    }) {
        const page = options.page || 1;
        const limit = options.limit || 50;
        const skip = (page - 1) * limit;

        const where: any = {};

        if (options.actorId) where.actorId = options.actorId;
        if (options.action) where.action = options.action;
        if (options.targetType) where.targetType = options.targetType;
        if (options.startDate || options.endDate) {
            where.createdAt = {};
            if (options.startDate) where.createdAt.gte = options.startDate;
            if (options.endDate) where.createdAt.lte = options.endDate;
        }

        const [logs, total] = await Promise.all([
            prisma.adminAuditLog.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    actor: {
                        select: {
                            id: true,
                            email: true,
                            fullName: true
                        }
                    }
                }
            }),
            prisma.adminAuditLog.count({ where })
        ]);

        return {
            logs,
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }
}

// Singleton instance for consistent usage
export const auditService = new AuditService();

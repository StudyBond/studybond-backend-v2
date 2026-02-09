// ============================================
// ADMIN SERVICE
// ============================================
// Business logic for admin/superadmin operations
// Security-critical: All role/permission checks enforced here

import prisma from '../../config/database';
import { Role } from '@prisma/client';
import { AppError } from '../../shared/errors/AppError';
import { auditService } from './audit.service';
import {
    BanUserInput,
    PromoteUserInput,
    DemoteUserInput,
    DeviceRemovalInput,
    UserListQuery,
    AdminUserResponse,
    PremiumUserResponse,
    SystemSettingsResponse
} from './admin.types';

export class AdminService {

    // ========================================
    // ROLE MANAGEMENT (SUPERADMIN ONLY)
    // ========================================

    /**
     * Promote a user to ADMIN or SUPERADMIN
     * Rules:
     * - Only SUPERADMIN can promote
     * - Cannot promote to role equal or higher than self
     * - Cannot self-promote
     */
    async promoteUser(
        actorId: number,
        actorRole: string,
        input: PromoteUserInput,
        ipAddress?: string
    ): Promise<{ success: boolean; message: string }> {
        const { userId, newRole } = input;

        // Prevent self-promotion
        if (actorId === userId) {
            await auditService.logRoleChangeAttemptFailed(
                actorId, actorRole, userId,
                'ROLE_PROMOTION_ATTEMPT_FAILED',
                'Cannot promote self',
                ipAddress
            );
            throw new AppError('Cannot modify your own role', 400);
        }

        // Check actor can manage roles
        if (actorRole !== 'SUPERADMIN') {
            await auditService.logRoleChangeAttemptFailed(
                actorId, actorRole, userId,
                'ROLE_PROMOTION_ATTEMPT_FAILED',
                'Actor not SUPERADMIN',
                ipAddress
            );
            throw new AppError('Only SUPERADMIN can promote users', 403);
        }

        // Get target user
        const targetUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, role: true, fullName: true }
        });

        if (!targetUser) {
            throw new AppError('User not found', 404);
        }

        // Map string newRole to Prisma Role enum
        const prismaNewRole = newRole === 'SUPERADMIN' ? Role.SUPERADMIN : Role.ADMIN;

        // Cannot promote if already at target role
        if (targetUser.role === prismaNewRole) {
            throw new AppError(`User is already ${newRole}`, 400);
        }

        // Cannot promote SUPERADMIN (already max)
        if (targetUser.role === Role.SUPERADMIN) {
            throw new AppError('Cannot modify SUPERADMIN role', 400);
        }

        // Perform promotion
        const oldRole = targetUser.role;
        await prisma.user.update({
            where: { id: userId },
            data: { role: prismaNewRole }
        });

        await auditService.logRolePromotion(
            actorId, actorRole, userId,
            oldRole, newRole, ipAddress
        );

        return {
            success: true,
            message: `User promoted from ${oldRole} to ${newRole}`
        };
    }

    /**
     * Demote a user to USER role
     * Rules:
     * - Only SUPERADMIN can demote
     * - Cannot demote another SUPERADMIN
     * - Cannot self-demote
     * - Cannot demote the LAST SUPERADMIN
     */
    async demoteUser(
        actorId: number,
        actorRole: string,
        input: DemoteUserInput,
        ipAddress?: string
    ): Promise<{ success: boolean; message: string }> {
        const { userId } = input;

        // Prevent self-demotion
        if (actorId === userId) {
            await auditService.logRoleChangeAttemptFailed(
                actorId, actorRole, userId,
                'ROLE_DEMOTION_ATTEMPT_FAILED',
                'Cannot demote self',
                ipAddress
            );
            throw new AppError('Cannot modify your own role', 400);
        }

        // Check actor can manage roles
        if (actorRole !== 'SUPERADMIN') {
            await auditService.logRoleChangeAttemptFailed(
                actorId, actorRole, userId,
                'ROLE_DEMOTION_ATTEMPT_FAILED',
                'Actor not SUPERADMIN',
                ipAddress
            );
            throw new AppError('Only SUPERADMIN can demote users', 403);
        }

        // Get target user
        const targetUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, role: true, fullName: true }
        });

        if (!targetUser) {
            throw new AppError('User not found', 404);
        }

        // Cannot demote SUPERADMIN
        if (targetUser.role === Role.SUPERADMIN) {
            await auditService.logRoleChangeAttemptFailed(
                actorId, actorRole, userId,
                'ROLE_DEMOTION_ATTEMPT_FAILED',
                'Cannot demote SUPERADMIN',
                ipAddress
            );
            throw new AppError('Cannot demote a SUPERADMIN', 403);
        }

        // Cannot demote USER (already lowest)
        if (targetUser.role === Role.USER) {
            throw new AppError('User is already at base role', 400);
        }

        // Safe to demote ADMIN to USER
        if (targetUser.role === Role.ADMIN) {
            const oldRole = targetUser.role;
            await prisma.user.update({
                where: { id: userId },
                data: { role: Role.USER }
            });

            await auditService.logRoleDemotion(
                actorId, actorRole, userId,
                oldRole, 'USER', ipAddress
            );

            return {
                success: true,
                message: `User demoted from ${oldRole} to USER`
            };
        }

        throw new AppError('Invalid demotion operation', 400);
    }

    // ========================================
    // USER MANAGEMENT (ADMIN + SUPERADMIN)
    // ========================================

    /**
     * Ban a user
     * Cannot ban ADMIN or SUPERADMIN
     */
    async banUser(
        actorId: number,
        actorRole: string,
        input: BanUserInput,
        ipAddress?: string
    ): Promise<{ success: boolean; message: string }> {
        const { userId, reason } = input;

        // Cannot ban self
        if (actorId === userId) {
            throw new AppError('Cannot ban yourself', 400);
        }

        const targetUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, role: true, isBanned: true, fullName: true }
        });

        if (!targetUser) {
            throw new AppError('User not found', 404);
        }

        // Cannot ban admins or superadmins
        if (targetUser.role !== Role.USER) {
            await auditService.logUnauthorizedAttempt(
                actorId, actorRole,
                'BAN_USER', 'USER', String(userId), ipAddress
            );
            throw new AppError('Cannot ban admin or superadmin users', 403);
        }

        if (targetUser.isBanned) {
            throw new AppError('User is already banned', 400);
        }

        await prisma.user.update({
            where: { id: userId },
            data: {
                isBanned: true,
                bannedAt: new Date(),
                bannedReason: reason
            }
        });

        await auditService.logUserBan(
            actorId, actorRole, userId, reason, ipAddress
        );

        return {
            success: true,
            message: `User ${targetUser.fullName} has been banned`
        };
    }

    /**
     * Unban a user
     */
    async unbanUser(
        actorId: number,
        actorRole: string,
        userId: number,
        ipAddress?: string
    ): Promise<{ success: boolean; message: string }> {
        const targetUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, isBanned: true, fullName: true }
        });

        if (!targetUser) {
            throw new AppError('User not found', 404);
        }

        if (!targetUser.isBanned) {
            throw new AppError('User is not banned', 400);
        }

        await prisma.user.update({
            where: { id: userId },
            data: {
                isBanned: false,
                bannedAt: null,
                bannedReason: null
            }
        });

        await auditService.logUserUnban(
            actorId, actorRole, userId, ipAddress
        );

        return {
            success: true,
            message: `User ${targetUser.fullName} has been unbanned`
        };
    }

    /**
     * Remove a device from a user account
     * Helps users who are locked out (max 2 devices)
     */
    async removeDevice(
        actorId: number,
        actorRole: string,
        input: DeviceRemovalInput,
        ipAddress?: string
    ): Promise<{ success: boolean; message: string }> {
        const { deviceId, userId, reason } = input;

        const device = await prisma.userDevice.findFirst({
            where: { id: deviceId, userId }
        });

        if (!device) {
            throw new AppError('Device not found for this user', 404);
        }

        await prisma.userDevice.delete({
            where: { id: deviceId }
        });

        await auditService.logDeviceRemoval(
            actorId, actorRole, deviceId, userId, reason, ipAddress
        );

        return {
            success: true,
            message: 'Device removed successfully'
        };
    }

    /**
     * Get users with filtering
     */
    async getUsers(query: UserListQuery): Promise<{
        users: AdminUserResponse[];
        meta: { page: number; limit: number; total: number; totalPages: number };
    }> {
        const page = query.page || 1;
        const limit = query.limit || 20;
        const skip = (page - 1) * limit;

        const where: any = {};
        if (query.role) where.role = query.role;
        if (query.isBanned !== undefined) where.isBanned = query.isBanned;
        if (query.isPremium !== undefined) where.isPremium = query.isPremium;
        if (query.search) {
            where.OR = [
                { email: { contains: query.search, mode: 'insensitive' } },
                { fullName: { contains: query.search, mode: 'insensitive' } }
            ];
        }

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                skip,
                take: limit,
                orderBy: { id: 'desc' },
                select: {
                    id: true,
                    email: true,
                    fullName: true,
                    role: true,
                    isBanned: true,
                    isPremium: true,
                    createdAt: true,
                    _count: { select: { devices: true } }
                }
            }),
            prisma.user.count({ where })
        ]);

        return {
            users: users.map(u => ({
                id: u.id,
                email: u.email,
                fullName: u.fullName,
                role: u.role,
                isBanned: u.isBanned,
                isPremium: u.isPremium,
                createdAt: u.createdAt,
                deviceCount: u._count.devices
            })),
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    // ========================================
    // SUPERADMIN ONLY FEATURES
    // ========================================

    /**
     * Get premium users (SUPERADMIN only)
     */
    async getPremiumUsers(page = 1, limit = 20): Promise<{
        users: PremiumUserResponse[];
        meta: { page: number; limit: number; total: number; totalPages: number };
    }> {
        const skip = (page - 1) * limit;

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where: { isPremium: true },
                skip,
                take: limit,
                orderBy: { subscriptionEndDate: 'desc' },
                select: {
                    id: true,
                    email: true,
                    fullName: true,
                    isPremium: true,
                    subscriptionEndDate: true,
                    createdAt: true
                }
            }),
            prisma.user.count({ where: { isPremium: true } })
        ]);

        return {
            users,
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * Toggle email system (SUPERADMIN only)
     * High-risk operation - kills all platform email if disabled
     */
    async toggleEmailSystem(
        actorId: number,
        actorRole: string,
        enabled: boolean,
        ipAddress?: string
    ): Promise<SystemSettingsResponse> {
        // Ensure singleton exists (upsert with id=1)
        const settings = await prisma.systemSettings.upsert({
            where: { id: 1 },
            update: {
                emailEnabled: enabled,
                updatedByUserId: actorId
            },
            create: {
                id: 1,
                emailEnabled: enabled,
                updatedByUserId: actorId
            }
        });

        await auditService.logEmailToggle(
            actorId, actorRole, enabled, ipAddress
        );

        return {
            emailEnabled: settings.emailEnabled,
            updatedAt: settings.updatedAt
        };
    }

    /**
     * Get system settings
     */
    async getSystemSettings(): Promise<SystemSettingsResponse> {
        const settings = await prisma.systemSettings.findUnique({
            where: { id: 1 }
        });

        if (!settings) {
            // Return default if not configured
            return {
                emailEnabled: true,
                updatedAt: new Date()
            };
        }

        return {
            emailEnabled: settings.emailEnabled,
            updatedAt: settings.updatedAt
        };
    }

    /**
     * Check if email is enabled globally
     * Used by email services before sending
     */
    async isEmailEnabled(): Promise<boolean> {
        const settings = await prisma.systemSettings.findUnique({
            where: { id: 1 },
            select: { emailEnabled: true }
        });
        return settings?.emailEnabled ?? true;
    }

    /**
     * Get count of superadmins (for last-superadmin protection)
     */
    async getSuperadminCount(): Promise<number> {
        return prisma.user.count({
            where: { role: Role.SUPERADMIN }
        });
    }
}

// Singleton instance
export const adminService = new AdminService();

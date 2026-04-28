import { PremiumEntitlementStatus, Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { ADMIN_CONFIG, AUTH_CONFIG } from '../../config/constants';
import { hasRoleAtLeast } from '../../shared/decorators/requireAdmin';
import { AppError } from '../../shared/errors/AppError';
import { ForbiddenError } from '../../shared/errors/ForbiddenError';
import { NotFoundError } from '../../shared/errors/NotFoundError';
import { reconcilePremiumAccessTx } from '../../shared/auth/accessPolicy';
import {
    buildRouteKey,
    IdempotencyContext,
    idempotencyService,
    resolveIdempotencyKey
} from '../../shared/idempotency/idempotency';
import { auditService } from './audit.service';
import { adminStepUpService } from './admin-step-up.service';
import {
    AdminAuditLogQuery,
    AdminRequestContext,
    AdminStepUpRequestResponse,
    AdminStepUpVerifyInput,
    AdminStepUpVerifyResponse,
    AdminUserResponse,
    BanUserInput,
    DemoteUserInput,
    DeviceRemovalInput,
    PremiumUserResponse,
    PremiumGrantInput,
    PremiumCoverageState,
    PremiumHistoryEntitlement,
    PremiumHistoryResponse,
    PromoteUserInput,
    PremiumRevokeInput,
    SystemSettingsResponse,
    UserListQuery
} from './admin.types';
import { buildPremiumCoverageStateTx } from './premium-coverage';

type AdminTx = Prisma.TransactionClient;

function addDaysUtc(baseDate: Date, days: number): Date {
    const next = new Date(baseDate);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
}

export class AdminService {
    private async createAdminAuditLogTx(
        tx: AdminTx,
        entry: {
            actorId: number;
            actorRole: string;
            action: string;
            targetType: string;
            targetId?: string;
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
                targetType: entry.targetType,
                targetId: entry.targetId,
                metadata: entry.metadata,
                reason: entry.reason,
                ipAddress: entry.ipAddress
            }
        });
    }

    private buildIdempotencyContext(
        actorId: number,
        routeKey: string,
        idempotencyKey: string | undefined,
        payload: unknown
    ): IdempotencyContext {
        return {
            userId: actorId,
            routeKey,
            idempotencyKey: resolveIdempotencyKey(idempotencyKey, routeKey.replace(/\s+/g, '_').toLowerCase()),
            payload,
            ttlSeconds: ADMIN_CONFIG.IDEMPOTENCY_TTL_SECONDS
        };
    }

    private async executeMutation<T>(
        actorId: number,
        routeKey: string,
        idempotencyKey: string | undefined,
        payload: unknown,
        compute: () => Promise<T>
    ): Promise<T> {
        return idempotencyService.execute(
            this.buildIdempotencyContext(actorId, routeKey, idempotencyKey, payload),
            compute
        );
    }

    private runTransaction<T>(
        operation: (tx: AdminTx) => Promise<T>,
        options: {
            maxWaitMs?: number;
            timeoutMs?: number;
        } = {}
    ): Promise<T> {
        return prisma.$transaction(operation, {
            maxWait: options.maxWaitMs ?? AUTH_CONFIG.TX_MAX_WAIT_MS,
            timeout: options.timeoutMs ?? AUTH_CONFIG.TX_TIMEOUT_MS
        });
    }

    private async assertAdminAccess(
        actorId: number,
        actorRole: string,
        attemptedAction: string,
        targetType: 'USER' | 'DEVICE' | 'SYSTEM' | 'QUESTION' | 'REPORT',
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
            targetType,
            targetId,
            ipAddress
        );
        throw new ForbiddenError('Admin access is required for this action.');
    }

    private async assertSuperadminAccess(
        actorId: number,
        actorRole: string,
        attemptedAction: string,
        targetType: 'USER' | 'DEVICE' | 'SYSTEM' | 'QUESTION' | 'REPORT',
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
            targetType,
            targetId,
            ipAddress
        );
        throw new ForbiddenError('Superadmin access is required for this action.');
    }

    private assertSensitiveStepUpContext(context: AdminRequestContext): void {
        if (!context.sessionId) {
            throw new AppError(
                'Your admin session context is missing. Please sign in again before retrying this action.',
                401,
                'SESSION_INVALID'
            );
        }
    }

    private assertPremiumTargetRole(targetRole: string): void {
        if (targetRole !== 'USER') {
            throw new ForbiddenError('Premium admin actions are only allowed for regular user accounts.');
        }
    }

    private mapPremiumHistoryEntitlement(
        entitlement: {
            id: bigint;
            kind: 'MANUAL' | 'PROMOTIONAL' | 'CORRECTIVE';
            status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
            startsAt: Date;
            endsAt: Date;
            note: string;
            createdAt: Date;
            revokedAt: Date | null;
            grantedByAdmin: { id: number; email: string; fullName: string };
            revokedByAdmin: { id: number; email: string; fullName: string } | null;
        }
    ): PremiumHistoryEntitlement {
        return {
            id: entitlement.id.toString(),
            kind: entitlement.kind,
            status: entitlement.status,
            startsAt: entitlement.startsAt,
            endsAt: entitlement.endsAt,
            note: entitlement.note,
            createdAt: entitlement.createdAt,
            revokedAt: entitlement.revokedAt,
            grantedByAdmin: entitlement.grantedByAdmin,
            revokedByAdmin: entitlement.revokedByAdmin
        };
    }

    async requestStepUp(
        actorId: number,
        actorRole: string,
        context: AdminRequestContext = {}
    ): Promise<AdminStepUpRequestResponse> {
        this.assertSensitiveStepUpContext(context);
        return adminStepUpService.requestChallenge(actorId, actorRole, context);
    }

    async verifyStepUp(
        actorId: number,
        actorRole: string,
        input: AdminStepUpVerifyInput,
        context: AdminRequestContext = {}
    ): Promise<AdminStepUpVerifyResponse> {
        this.assertSensitiveStepUpContext(context);
        return adminStepUpService.verifyChallenge(actorId, actorRole, input, context);
    }

    async promoteUser(
        actorId: number,
        actorRole: string,
        input: PromoteUserInput,
        context: AdminRequestContext = {}
    ): Promise<{ success: boolean; message: string }> {
        const { userId, newRole, reason } = input;

        if (actorId === userId) {
            await auditService.logRoleChangeAttemptFailed(
                actorId,
                actorRole,
                userId,
                'ROLE_PROMOTION_ATTEMPT_FAILED',
                'Cannot promote self',
                context.ipAddress
            );
            throw new AppError('Cannot modify your own role', 400);
        }

        await this.assertSuperadminAccess(
            actorId,
            actorRole,
            'PROMOTE_USER',
            'USER',
            String(userId),
            context.ipAddress
        );

        const routeKey = buildRouteKey('POST', '/api/admin/users/:userId/promote', { userId });
        return this.executeMutation(
            actorId,
            routeKey,
            context.idempotencyKey,
            { userId, newRole, reason },
            async () => this.runTransaction(async (tx: AdminTx) => {
                const stepUp = await adminStepUpService.assertVerifiedForSensitiveActionTx(
                    tx,
                    actorId,
                    actorRole,
                    context,
                    'PROMOTE_USER',
                    String(userId)
                );

                const targetUser = await tx.user.findUnique({
                    where: { id: userId },
                    select: { id: true, role: true, fullName: true }
                });

                if (!targetUser) {
                    throw new NotFoundError('User not found');
                }

                const prismaNewRole = newRole === 'SUPERADMIN' ? 'SUPERADMIN' : 'ADMIN';
                if (targetUser.role === prismaNewRole) {
                    throw new AppError(`User is already ${newRole}`, 400);
                }

                if (targetUser.role === 'SUPERADMIN') {
                    throw new AppError('Cannot modify SUPERADMIN role directly. Demote first if needed.', 400);
                }

                const oldRole = targetUser.role;
                await tx.user.update({
                    where: { id: userId },
                    data: { role: prismaNewRole }
                });

                await this.createAdminAuditLogTx(tx, {
                    actorId,
                    actorRole,
                    action: 'ROLE_PROMOTED',
                    targetType: 'USER',
                    targetId: String(userId),
                    metadata: {
                        oldRole,
                        newRole: prismaNewRole,
                        stepUpChallengeId: stepUp.challengeId
                    },
                    reason,
                    ipAddress: context.ipAddress
                });

                return {
                    success: true,
                    message: `User promoted from ${oldRole} to ${prismaNewRole}`
                };
            })
        );
    }

    async demoteUser(
        actorId: number,
        actorRole: string,
        input: DemoteUserInput,
        context: AdminRequestContext = {}
    ): Promise<{ success: boolean; message: string }> {
        const { userId, reason } = input;

        if (actorId === userId) {
            await auditService.logRoleChangeAttemptFailed(
                actorId,
                actorRole,
                userId,
                'ROLE_DEMOTION_ATTEMPT_FAILED',
                'Cannot demote self',
                context.ipAddress
            );
            throw new AppError('Cannot modify your own role', 400);
        }

        await this.assertSuperadminAccess(
            actorId,
            actorRole,
            'DEMOTE_USER',
            'USER',
            String(userId),
            context.ipAddress
        );

        const routeKey = buildRouteKey('POST', '/api/admin/users/:userId/demote', { userId });
        return this.executeMutation(
            actorId,
            routeKey,
            context.idempotencyKey,
            { userId, reason },
            async () => this.runTransaction(async (tx: AdminTx) => {
                const stepUp = await adminStepUpService.assertVerifiedForSensitiveActionTx(
                    tx,
                    actorId,
                    actorRole,
                    context,
                    'DEMOTE_USER',
                    String(userId)
                );

                const targetUser = await tx.user.findUnique({
                    where: { id: userId },
                    select: { id: true, role: true, fullName: true }
                });

                if (!targetUser) {
                    throw new NotFoundError('User not found');
                }

                if (targetUser.role === 'USER') {
                    throw new AppError('User is already at base role', 400);
                }

                let newRole: 'ADMIN' | 'USER';
                if (targetUser.role === 'SUPERADMIN') {
                    const superadminCount = await tx.user.count({
                        where: { role: 'SUPERADMIN' }
                    });

                    if (superadminCount <= 1) {
                        await auditService.logRoleChangeAttemptFailed(
                            actorId,
                            actorRole,
                            userId,
                            'ROLE_DEMOTION_ATTEMPT_FAILED',
                            'Cannot demote the last SUPERADMIN',
                            context.ipAddress
                        );
                        throw new ForbiddenError('Cannot demote the last SUPERADMIN.');
                    }

                    newRole = 'ADMIN';
                } else {
                    newRole = 'USER';
                }

                const oldRole = targetUser.role;
                await tx.user.update({
                    where: { id: userId },
                    data: { role: newRole }
                });

                await this.createAdminAuditLogTx(tx, {
                    actorId,
                    actorRole,
                    action: 'ROLE_DEMOTED',
                    targetType: 'USER',
                    targetId: String(userId),
                    metadata: {
                        oldRole,
                        newRole,
                        stepUpChallengeId: stepUp.challengeId
                    },
                    reason,
                    ipAddress: context.ipAddress
                });

                return {
                    success: true,
                    message: `User demoted from ${oldRole} to ${newRole}`
                };
            })
        );
    }

    async banUser(
        actorId: number,
        actorRole: string,
        input: BanUserInput,
        context: AdminRequestContext = {}
    ): Promise<{ success: boolean; message: string }> {
        const { userId, reason } = input;

        if (actorId === userId) {
            throw new AppError('Cannot ban yourself', 400);
        }

        await this.assertAdminAccess(
            actorId,
            actorRole,
            'BAN_USER',
            'USER',
            String(userId),
            context.ipAddress
        );

        const routeKey = buildRouteKey('POST', '/api/admin/users/:userId/ban', { userId });
        return this.executeMutation(
            actorId,
            routeKey,
            context.idempotencyKey,
            { userId, reason },
            async () => this.runTransaction(async (tx: AdminTx) => {
                const targetUser = await tx.user.findUnique({
                    where: { id: userId },
                    select: { id: true, role: true, isBanned: true, fullName: true }
                });

                if (!targetUser) {
                    throw new NotFoundError('User not found');
                }

                if (targetUser.role !== 'USER') {
                    await auditService.logUnauthorizedAttempt(
                        actorId,
                        actorRole,
                        'BAN_USER',
                        'USER',
                        String(userId),
                        context.ipAddress
                    );
                    throw new ForbiddenError('Cannot ban admin or superadmin users.');
                }

                if (targetUser.isBanned) {
                    throw new AppError('User is already banned', 400);
                }

                await tx.user.update({
                    where: { id: userId },
                    data: {
                        isBanned: true,
                        bannedAt: new Date(),
                        bannedReason: reason
                    }
                });

                await tx.userSession.updateMany({
                    where: {
                        userId,
                        isActive: true
                    },
                    data: {
                        isActive: false
                    }
                });

                await this.createAdminAuditLogTx(tx, {
                    actorId,
                    actorRole,
                    action: 'USER_BANNED',
                    targetType: 'USER',
                    targetId: String(userId),
                    reason,
                    ipAddress: context.ipAddress
                });

                return {
                    success: true,
                    message: `User ${targetUser.fullName} has been banned`
                };
            })
        );
    }

    async unbanUser(
        actorId: number,
        actorRole: string,
        userId: number,
        context: AdminRequestContext = {}
    ): Promise<{ success: boolean; message: string }> {
        await this.assertAdminAccess(
            actorId,
            actorRole,
            'UNBAN_USER',
            'USER',
            String(userId),
            context.ipAddress
        );

        const routeKey = buildRouteKey('POST', '/api/admin/users/:userId/unban', { userId });
        return this.executeMutation(
            actorId,
            routeKey,
            context.idempotencyKey,
            { userId },
            async () => this.runTransaction(async (tx: AdminTx) => {
                const targetUser = await tx.user.findUnique({
                    where: { id: userId },
                    select: { id: true, isBanned: true, fullName: true }
                });

                if (!targetUser) {
                    throw new NotFoundError('User not found');
                }

                if (!targetUser.isBanned) {
                    throw new AppError('User is not banned', 400);
                }

                await tx.user.update({
                    where: { id: userId },
                    data: {
                        isBanned: false,
                        bannedAt: null,
                        bannedReason: null
                    }
                });

                await this.createAdminAuditLogTx(tx, {
                    actorId,
                    actorRole,
                    action: 'USER_UNBANNED',
                    targetType: 'USER',
                    targetId: String(userId),
                    ipAddress: context.ipAddress
                });

                return {
                    success: true,
                    message: `User ${targetUser.fullName} has been unbanned`
                };
            })
        );
    }

    async removeDevice(
        actorId: number,
        actorRole: string,
        input: DeviceRemovalInput,
        context: AdminRequestContext = {}
    ): Promise<{ success: boolean; message: string }> {
        const { deviceId, userId, reason } = input;

        await this.assertAdminAccess(
            actorId,
            actorRole,
            'REMOVE_DEVICE',
            'DEVICE',
            deviceId,
            context.ipAddress
        );

        const routeKey = buildRouteKey('POST', '/api/admin/users/:userId/devices/:deviceId/remove', {
            userId,
            deviceId
        });

        return this.executeMutation(
            actorId,
            routeKey,
            context.idempotencyKey,
            { userId, deviceId, reason },
            async () => this.runTransaction(async (tx: AdminTx) => {
                const device = await tx.userDevice.findFirst({
                    where: {
                        userId,
                        OR: [
                            { id: deviceId },
                            { deviceId }
                        ]
                    },
                    select: {
                        id: true,
                        deviceId: true
                    }
                });

                if (!device) {
                    throw new NotFoundError('Device not found for this user');
                }

                await tx.userSession.updateMany({
                    where: {
                        userId,
                        deviceId: device.deviceId,
                        isActive: true
                    },
                    data: {
                        isActive: false
                    }
                });

                await tx.userDevice.delete({
                    where: { id: device.id }
                });

                await this.createAdminAuditLogTx(tx, {
                    actorId,
                    actorRole,
                    action: 'DEVICE_REMOVED',
                    targetType: 'DEVICE',
                    targetId: device.deviceId,
                    metadata: {
                        targetUserId: userId,
                        deviceRecordId: device.id
                    },
                    reason,
                    ipAddress: context.ipAddress
                });

                return {
                    success: true,
                    message: 'Device removed successfully'
                };
            })
        );
    }

    async getUsers(
        actorId: number,
        actorRole: string,
        query: UserListQuery
    ): Promise<{
        users: AdminUserResponse[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
    }> {
        await this.assertAdminAccess(actorId, actorRole, 'LIST_USERS', 'USER');

        const page = query.page || 1;
        const limit = query.limit || 30;
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
            users: users.map((u: any) => ({
                id: u.id,
                email: u.email,
                fullName: u.fullName,
                role: u.role,
                isBanned: u.isBanned,
                isPremium: u.isPremium,
                createdAt: u.createdAt,
                deviceCount: u._count.devices
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async getPremiumUsers(
        actorId: number,
        actorRole: string,
        page = 1,
        limit = 30
    ): Promise<{
        users: PremiumUserResponse[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
    }> {
        await this.assertSuperadminAccess(actorId, actorRole, 'LIST_PREMIUM_USERS', 'USER');

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
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async getPremiumHistory(
        actorId: number,
        actorRole: string,
        userId: number
    ): Promise<PremiumHistoryResponse> {
        await this.assertSuperadminAccess(actorId, actorRole, 'GET_PREMIUM_HISTORY', 'USER', String(userId));

        const reconciledUser = await this.runTransaction(async (tx: AdminTx) => {
            const targetUser = await tx.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    email: true,
                    fullName: true,
                    role: true
                }
            });

            if (!targetUser) {
                throw new NotFoundError('User not found');
            }

            this.assertPremiumTargetRole(targetUser.role);

            const reconciledUser = await reconcilePremiumAccessTx(tx, userId);
            if (!reconciledUser) {
                throw new NotFoundError('User not found');
            }

            return {
                id: reconciledUser.id,
                email: reconciledUser.email,
                fullName: reconciledUser.fullName,
                isPremium: reconciledUser.isPremium,
                subscriptionEndDate: reconciledUser.subscriptionEndDate
            };
        }, {
            timeoutMs: ADMIN_CONFIG.PREMIUM_MUTATION_TX_TIMEOUT_MS
        });

        const [coverageState, subscription, entitlements] = await Promise.all([
            buildPremiumCoverageStateTx(prisma as any, userId),
            prisma.subscription.findUnique({
                where: { userId },
                select: {
                    status: true,
                    provider: true,
                    planType: true,
                    autoRenew: true,
                    paymentReference: true,
                    startDate: true,
                    endDate: true
                }
            }),
            prisma.premiumEntitlement.findMany({
                where: { userId },
                include: {
                    grantedByAdmin: {
                        select: {
                            id: true,
                            email: true,
                            fullName: true
                        }
                    },
                    revokedByAdmin: {
                        select: {
                            id: true,
                            email: true,
                            fullName: true
                        }
                    }
                },
                orderBy: [
                    { createdAt: 'desc' }
                ]
            })
        ]);

        return {
            user: {
                id: reconciledUser.id,
                email: reconciledUser.email,
                fullName: reconciledUser.fullName,
                isPremium: reconciledUser.isPremium,
                subscriptionEndDate: reconciledUser.subscriptionEndDate
            },
            currentAccess: coverageState,
            subscription: subscription
                ? {
                    status: subscription.status,
                    provider: subscription.provider,
                    planType: subscription.planType,
                    autoRenew: subscription.autoRenew,
                    paymentReference: subscription.paymentReference,
                    startDate: subscription.startDate,
                    endDate: subscription.endDate
                }
                : null,
            entitlements: entitlements.map((entitlement: {
                id: bigint;
                kind: 'MANUAL' | 'PROMOTIONAL' | 'CORRECTIVE';
                status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
                startsAt: Date;
                endsAt: Date;
                note: string;
                createdAt: Date;
                revokedAt: Date | null;
                grantedByAdmin: { id: number; email: string; fullName: string };
                revokedByAdmin: { id: number; email: string; fullName: string } | null;
            }) => this.mapPremiumHistoryEntitlement({
                id: entitlement.id,
                kind: entitlement.kind,
                status: entitlement.status,
                startsAt: entitlement.startsAt,
                endsAt: entitlement.endsAt,
                note: entitlement.note,
                createdAt: entitlement.createdAt,
                revokedAt: entitlement.revokedAt,
                grantedByAdmin: entitlement.grantedByAdmin,
                revokedByAdmin: entitlement.revokedByAdmin
            }))
        };
    }

    async grantPremium(
        actorId: number,
        actorRole: string,
        input: PremiumGrantInput,
        context: AdminRequestContext = {}
    ): Promise<{
        success: boolean;
        message: string;
        currentAccess: PremiumCoverageState;
        entitlement: {
            id: string;
            kind: PremiumGrantInput['kind'];
            status: 'ACTIVE';
            startsAt: Date;
            endsAt: Date;
            note: string;
        };
    }> {
        return this.createPremiumEntitlementMutation(actorId, actorRole, input, context, 'grant');
    }

    async extendPremium(
        actorId: number,
        actorRole: string,
        input: PremiumGrantInput,
        context: AdminRequestContext = {}
    ): Promise<{
        success: boolean;
        message: string;
        currentAccess: PremiumCoverageState;
        entitlement: {
            id: string;
            kind: PremiumGrantInput['kind'];
            status: 'ACTIVE';
            startsAt: Date;
            endsAt: Date;
            note: string;
        };
    }> {
        return this.createPremiumEntitlementMutation(actorId, actorRole, input, context, 'extend');
    }

    async revokePremium(
        actorId: number,
        actorRole: string,
        input: PremiumRevokeInput,
        context: AdminRequestContext = {}
    ): Promise<{
        success: boolean;
        message: string;
        revokedCount: number;
        currentAccess: PremiumCoverageState;
    }> {
        const { userId, note } = input;

        await this.assertSuperadminAccess(
            actorId,
            actorRole,
            'REVOKE_PREMIUM',
            'USER',
            String(userId),
            context.ipAddress
        );

        const routeKey = buildRouteKey('POST', '/api/admin/users/:userId/premium/revoke', { userId });
        return this.executeMutation(
            actorId,
            routeKey,
            context.idempotencyKey,
            input,
            async () => this.runTransaction(async (tx: AdminTx) => {
                const stepUp = await adminStepUpService.assertVerifiedForSensitiveActionTx(
                    tx,
                    actorId,
                    actorRole,
                    context,
                    'REVOKE_PREMIUM',
                    String(userId)
                );

                const targetUser = await tx.user.findUnique({
                    where: { id: userId },
                    select: {
                        id: true,
                        email: true,
                        fullName: true,
                        role: true
                    }
                });

                if (!targetUser) {
                    throw new NotFoundError('User not found');
                }

                this.assertPremiumTargetRole(targetUser.role);

                await reconcilePremiumAccessTx(tx, userId);
                const coverageBefore = await buildPremiumCoverageStateTx(tx, userId);

                const activeEntitlements = await tx.premiumEntitlement.findMany({
                    where: {
                        userId,
                        status: PremiumEntitlementStatus.ACTIVE
                    },
                    select: {
                        id: true
                    }
                });

                if (activeEntitlements.length === 0) {
                    throw new AppError('There are no active admin-issued premium entitlements to revoke.', 400);
                }

                const now = new Date();
                const revokedIds = activeEntitlements.map((entitlement) => entitlement.id);

                await tx.premiumEntitlement.updateMany({
                    where: {
                        id: {
                            in: revokedIds
                        }
                    },
                    data: {
                        status: PremiumEntitlementStatus.REVOKED,
                        revokedAt: now,
                        revokedByAdminId: actorId
                    }
                });

                const reconciledUser = await reconcilePremiumAccessTx(tx, userId);
                if (!reconciledUser) {
                    throw new NotFoundError('User not found');
                }

                const coverageAfter = await buildPremiumCoverageStateTx(tx, userId);

                await this.createAdminAuditLogTx(tx, {
                    actorId,
                    actorRole,
                    action: 'PREMIUM_REVOKED',
                    targetType: 'USER',
                    targetId: String(userId),
                    metadata: {
                        revokedCount: revokedIds.length,
                        previousIsPremium: coverageBefore.isPremium,
                        previousEffectiveEndDate: coverageBefore.effectiveEndDate?.toISOString() || null,
                        nextIsPremium: coverageAfter.isPremium,
                        nextEffectiveEndDate: coverageAfter.effectiveEndDate?.toISOString() || null,
                        stepUpChallengeId: stepUp.challengeId
                    },
                    reason: note,
                    ipAddress: context.ipAddress
                });

                await tx.auditLog.create({
                    data: {
                        userId,
                        action: 'PREMIUM_REVOKED_MANUALLY',
                        metadata: {
                            actorId,
                            note,
                            revokedCount: revokedIds.length,
                            isPremiumAfter: reconciledUser.isPremium,
                            effectiveEndDateAfter: coverageAfter.effectiveEndDate?.toISOString() || null
                        }
                    }
                });

                return {
                    success: true,
                    message: coverageAfter.isPremium
                        ? 'Admin-issued premium entitlements were revoked. Paid premium access is still active.'
                        : 'Admin-issued premium entitlements were revoked successfully.',
                    revokedCount: revokedIds.length,
                    currentAccess: coverageAfter
                };
            }, {
                timeoutMs: ADMIN_CONFIG.PREMIUM_MUTATION_TX_TIMEOUT_MS
            })
        );
    }

    async toggleEmailSystem(
        actorId: number,
        actorRole: string,
        enabled: boolean,
        context: AdminRequestContext = {}
    ): Promise<SystemSettingsResponse> {
        await this.assertSuperadminAccess(
            actorId,
            actorRole,
            'TOGGLE_EMAIL_SYSTEM',
            'SYSTEM',
            'email',
            context.ipAddress
        );

        const routeKey = buildRouteKey('POST', '/api/admin/system/email-toggle');
        return this.executeMutation(
            actorId,
            routeKey,
            context.idempotencyKey,
            { enabled },
            async () => this.runTransaction(async (tx: AdminTx) => {
                const stepUp = await adminStepUpService.assertVerifiedForSensitiveActionTx(
                    tx,
                    actorId,
                    actorRole,
                    context,
                    'TOGGLE_EMAIL_SYSTEM',
                    'email'
                );

                const settings = await tx.systemSettings.upsert({
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

                await this.createAdminAuditLogTx(tx, {
                    actorId,
                    actorRole,
                    action: 'EMAIL_SYSTEM_TOGGLED',
                    targetType: 'SYSTEM',
                    metadata: {
                        emailEnabled: enabled,
                        stepUpChallengeId: stepUp.challengeId
                    },
                    ipAddress: context.ipAddress
                });

                return {
                    emailEnabled: settings.emailEnabled,
                    updatedAt: settings.updatedAt
                };
            })
        );
    }

    async getSystemSettings(actorId: number, actorRole: string): Promise<SystemSettingsResponse> {
        await this.assertSuperadminAccess(actorId, actorRole, 'GET_SYSTEM_SETTINGS', 'SYSTEM');

        const settings = await prisma.systemSettings.findUnique({
            where: { id: 1 }
        });

        if (!settings) {
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

    async getAuditLogs(
        actorId: number,
        actorRole: string,
        query: AdminAuditLogQuery
    ) {
        await this.assertSuperadminAccess(actorId, actorRole, 'GET_ADMIN_AUDIT_LOGS', 'SYSTEM');
        return auditService.getAuditLogs(query);
    }

    async isEmailEnabled(): Promise<boolean> {
        const settings = await prisma.systemSettings.findUnique({
            where: { id: 1 },
            select: { emailEnabled: true }
        });
        return settings?.emailEnabled ?? true;
    }

    async getSuperadminCount(): Promise<number> {
        return prisma.user.count({
            where: { role: 'SUPERADMIN' }
        });
    }

    private async createPremiumEntitlementMutation(
        actorId: number,
        actorRole: string,
        input: PremiumGrantInput,
        context: AdminRequestContext,
        operation: 'grant' | 'extend'
    ): Promise<{
        success: boolean;
        message: string;
        currentAccess: PremiumCoverageState;
        entitlement: {
            id: string;
            kind: PremiumGrantInput['kind'];
            status: 'ACTIVE';
            startsAt: Date;
            endsAt: Date;
            note: string;
        };
    }> {
        const { userId, kind, durationDays, note } = input;

        await this.assertSuperadminAccess(
            actorId,
            actorRole,
            operation === 'grant' ? 'GRANT_PREMIUM' : 'EXTEND_PREMIUM',
            'USER',
            String(userId),
            context.ipAddress
        );

        const routeKey = buildRouteKey(
            'POST',
            operation === 'grant'
                ? '/api/admin/users/:userId/premium/grants'
                : '/api/admin/users/:userId/premium/extend',
            { userId }
        );

        return this.executeMutation(
            actorId,
            routeKey,
            context.idempotencyKey,
            input,
            async () => this.runTransaction(async (tx: AdminTx) => {
                const stepUp = await adminStepUpService.assertVerifiedForSensitiveActionTx(
                    tx,
                    actorId,
                    actorRole,
                    context,
                    operation === 'grant' ? 'GRANT_PREMIUM' : 'EXTEND_PREMIUM',
                    String(userId)
                );

                const targetUser = await tx.user.findUnique({
                    where: { id: userId },
                    select: {
                        id: true,
                        email: true,
                        fullName: true,
                        role: true
                    }
                });

                if (!targetUser) {
                    throw new NotFoundError('User not found');
                }

                this.assertPremiumTargetRole(targetUser.role);

                const reconciledBefore = await reconcilePremiumAccessTx(tx, userId);
                if (!reconciledBefore) {
                    throw new NotFoundError('User not found');
                }

                const coverageBefore = await buildPremiumCoverageStateTx(tx, userId);
                const now = new Date();
                const startsAt = coverageBefore.isPremium && coverageBefore.effectiveEndDate
                    ? coverageBefore.effectiveEndDate
                    : now;
                const endsAt = addDaysUtc(startsAt, durationDays);

                const entitlement = await tx.premiumEntitlement.create({
                    data: {
                        userId,
                        grantedByAdminId: actorId,
                        kind,
                        startsAt,
                        endsAt,
                        note
                    }
                });

                const reconciledAfter = await reconcilePremiumAccessTx(tx, userId);
                if (!reconciledAfter) {
                    throw new NotFoundError('User not found');
                }

                const coverageAfter = await buildPremiumCoverageStateTx(tx, userId);

                await this.createAdminAuditLogTx(tx, {
                    actorId,
                    actorRole,
                    action: operation === 'grant' ? 'PREMIUM_GRANTED' : 'PREMIUM_EXTENDED',
                    targetType: 'USER',
                    targetId: String(userId),
                    metadata: {
                        kind,
                        durationDays,
                        startsAt: startsAt.toISOString(),
                        endsAt: endsAt.toISOString(),
                        previousIsPremium: coverageBefore.isPremium,
                        previousEffectiveEndDate: coverageBefore.effectiveEndDate?.toISOString() || null,
                        nextIsPremium: coverageAfter.isPremium,
                        nextEffectiveEndDate: coverageAfter.effectiveEndDate?.toISOString() || null,
                        stepUpChallengeId: stepUp.challengeId
                    },
                    reason: note,
                    ipAddress: context.ipAddress
                });

                await tx.auditLog.create({
                    data: {
                        userId,
                        action: operation === 'grant' ? 'PREMIUM_GRANTED_MANUALLY' : 'PREMIUM_EXTENDED_MANUALLY',
                        metadata: {
                            actorId,
                            kind,
                            durationDays,
                            note,
                            startsAt: startsAt.toISOString(),
                            endsAt: endsAt.toISOString(),
                            isPremiumAfter: reconciledAfter.isPremium,
                            effectiveEndDateAfter: coverageAfter.effectiveEndDate?.toISOString() || null
                        }
                    }
                });

                return {
                    success: true,
                    message: operation === 'grant'
                        ? 'Premium access granted successfully.'
                        : 'Premium access extended successfully.',
                    currentAccess: coverageAfter,
                    entitlement: {
                        id: entitlement.id.toString(),
                        kind,
                        status: 'ACTIVE' as const,
                        startsAt,
                        endsAt,
                        note
                    }
                };
            }, {
                timeoutMs: ADMIN_CONFIG.PREMIUM_MUTATION_TX_TIMEOUT_MS
            })
        );
    }

    // ============================================================
    // FREE EXAM MANAGEMENT (Global credit reset + question curation)
    // ============================================================

    /**
     * SUPERADMIN-only: Reset free exam credits for ALL non-premium users.
     * Sets freeSubjectCreditsUsed=0, clears freeSubjectsTaken, and sets hasTakenFreeExam=false.
     * This is an atomic, audit-logged operation.
     */
    async resetFreeExamCredits(
        actorId: number,
        actorRole: string,
        context: AdminRequestContext = {}
    ): Promise<{ success: boolean; message: string; usersAffected: number }> {
        await this.assertSuperadminAccess(
            actorId,
            actorRole,
            'RESET_FREE_EXAM_CREDITS',
            'SYSTEM',
            'free-exam',
            context.ipAddress
        );

        const routeKey = buildRouteKey('POST', '/api/admin/free-exam/reset');
        return this.executeMutation(
            actorId,
            routeKey,
            context.idempotencyKey,
            {},
            async () => this.runTransaction(async (tx: AdminTx) => {
                const stepUp = await adminStepUpService.assertVerifiedForSensitiveActionTx(
                    tx,
                    actorId,
                    actorRole,
                    context,
                    'RESET_FREE_EXAM_CREDITS',
                    'free-exam'
                );

                // Count users that will be affected (for audit)
                const affectedCount = await (tx as any).user.count({
                    where: {
                        isPremium: false,
                        OR: [
                            { freeSubjectCreditsUsed: { gt: 0 } },
                            { hasTakenFreeExam: true }
                        ]
                    }
                });

                // Atomic bulk reset
                await (tx as any).user.updateMany({
                    where: { isPremium: false },
                    data: {
                        freeSubjectCreditsUsed: 0,
                        freeSubjectsTaken: [],
                        hasTakenFreeExam: false
                    }
                });

                await this.createAdminAuditLogTx(tx, {
                    actorId,
                    actorRole,
                    action: 'FREE_EXAM_CREDITS_RESET',
                    targetType: 'SYSTEM',
                    metadata: {
                        usersAffected: affectedCount,
                        stepUpChallengeId: stepUp.challengeId
                    },
                    ipAddress: context.ipAddress
                });

                return {
                    success: true,
                    message: `Free exam credits reset for ${affectedCount} user(s). All free users can now take 4 new subject credits.`,
                    usersAffected: affectedCount
                };
            })
        );
    }

    /**
     * ADMIN+: Toggle the isFeaturedFree flag on questions for admin-curated free exam pools.
     * When featuring (featured=true), validates against per-institution freeQuestionsPerSubject cap.
     */
    async toggleFreeExamQuestions(
        actorId: number,
        actorRole: string,
        input: { questionIds: number[]; featured: boolean },
        context: AdminRequestContext = {}
    ): Promise<{ success: boolean; message: string; updatedCount: number }> {
        if (!hasRoleAtLeast(actorRole, 'ADMIN')) {
            throw new ForbiddenError('Admin access required');
        }

        if (!input.questionIds || input.questionIds.length === 0) {
            throw new AppError('questionIds must be a non-empty array', 400);
        }

        const routeKey = buildRouteKey('POST', '/api/admin/free-exam/questions/toggle');
        return this.executeMutation(
            actorId,
            routeKey,
            context.idempotencyKey,
            input,
            async () => this.runTransaction(async (tx: AdminTx) => {
                // Verify all questions exist and are REAL_BANK
                const questions = await (tx as any).question.findMany({
                    where: { id: { in: input.questionIds } },
                    select: {
                        id: true,
                        subject: true,
                        institutionId: true,
                        questionPool: true,
                        isFeaturedFree: true
                    }
                });

                if (questions.length !== input.questionIds.length) {
                    const foundIds = new Set(questions.map((q: any) => q.id));
                    const missingIds = input.questionIds.filter(id => !foundIds.has(id));
                    throw new NotFoundError(`Questions not found: ${missingIds.join(', ')}`);
                }

                // When featuring: validate per-institution, per-subject capacity
                if (input.featured) {
                    // Group incoming questions by institution+subject
                    const groupKey = (q: any) => `${q.institutionId}:${q.subject}`;
                    const incomingGroups = new Map<string, number>();
                    for (const q of questions) {
                        if (q.isFeaturedFree) continue; // already featured, skip
                        const key = groupKey(q);
                        incomingGroups.set(key, (incomingGroups.get(key) ?? 0) + 1);
                    }

                    for (const [key, incomingCount] of incomingGroups) {
                        const [instIdStr, subject] = key.split(':');
                        const institutionId = parseInt(instIdStr, 10);

                        // Get current featured count for this subject+institution
                        const existingFeaturedCount = await (tx as any).question.count({
                            where: {
                                institutionId,
                                subject,
                                isFeaturedFree: true,
                                id: { notIn: input.questionIds } // exclude the ones being toggled
                            }
                        });

                        // Get the institution config for cap
                        const config = await (tx as any).institutionExamConfig.findFirst({
                            where: {
                                institutionId,
                                isActive: true
                            },
                            select: { freeQuestionsPerSubject: true }
                        });
                        const cap = config?.freeQuestionsPerSubject ?? 25;

                        if (existingFeaturedCount + incomingCount > cap) {
                            throw new AppError(
                                `Cannot feature ${incomingCount} more question(s) for "${subject}" (institution ${institutionId}). Current: ${existingFeaturedCount}, cap: ${cap}.`,
                                409,
                                'FREE_EXAM_POOL_CAPACITY_EXCEEDED'
                            );
                        }
                    }
                }

                // Apply the toggle
                const result = await (tx as any).question.updateMany({
                    where: { id: { in: input.questionIds } },
                    data: { isFeaturedFree: input.featured }
                });

                await this.createAdminAuditLogTx(tx, {
                    actorId,
                    actorRole,
                    action: 'FREE_EXAM_QUESTIONS_TOGGLED',
                    targetType: 'QUESTION',
                    metadata: {
                        questionIds: input.questionIds,
                        featured: input.featured,
                        updatedCount: result.count
                    },
                    ipAddress: context.ipAddress
                });

                return {
                    success: true,
                    message: input.featured
                        ? `${result.count} question(s) added to the free exam pool.`
                        : `${result.count} question(s) removed from the free exam pool.`,
                    updatedCount: result.count
                };
            })
        );
    }

    /**
     * ADMIN+: Get coverage report showing how many isFeaturedFree questions exist
     * per subject per institution, versus the configured cap.
     */
    async getFreeExamCoverage(
        _actorId: number,
        actorRole: string,
        institutionCode?: string
    ): Promise<{
        subjects: Array<{
            institutionId: number;
            institutionCode: string;
            subject: string;
            featuredCount: number;
            cap: number;
            isFull: boolean;
        }>;
    }> {
        if (!hasRoleAtLeast(actorRole, 'ADMIN')) {
            throw new ForbiddenError('Admin access required');
        }

        // Resolve institution filter
        const institutionFilter = institutionCode
            ? { institution: { code: institutionCode } }
            : {};

        // Get all featured questions grouped by institution+subject
        const featuredQuestions: Array<{
            institutionId: number;
            subject: string;
            _count: { _all: number };
        }> = await prisma.question.groupBy({
            by: ['institutionId', 'subject'],
            where: {
                isFeaturedFree: true,
                institutionId: { not: null },
                ...institutionFilter
            },
            _count: { _all: true }
        } as any);

        // Get institution configs for caps
        const institutionIds = [...new Set(featuredQuestions.map(q => q.institutionId).filter(Boolean))];
        const [institutions, configs] = await Promise.all([
            prisma.institution.findMany({
                where: { id: { in: institutionIds as number[] } },
                select: { id: true, code: true }
            }),
            prisma.institutionExamConfig.findMany({
                where: {
                    institutionId: { in: institutionIds as number[] },
                    isActive: true
                },
                select: {
                    institutionId: true,
                    freeQuestionsPerSubject: true
                }
            })
        ]);

        const institutionMap = new Map<number, string>(
            institutions.map((i: { id: number; code: string }) => [i.id, i.code])
        );
        const configMap = new Map<number, number>(
            configs.map((c: { institutionId: number; freeQuestionsPerSubject: number }) => [c.institutionId, c.freeQuestionsPerSubject])
        );

        const subjects = featuredQuestions.map(group => {
            const cap: number = configMap.get(group.institutionId) ?? 25;
            return {
                institutionId: group.institutionId,
                institutionCode: institutionMap.get(group.institutionId) ?? 'UNKNOWN',
                subject: group.subject,
                featuredCount: group._count._all,
                cap,
                isFull: group._count._all >= cap
            };
        });

        return { subjects };
    }

    async createInstitution(
        actorId: number,
        actorRole: string,
        input: { code: string; name: string; slug: string },
        context: AdminRequestContext = {}
    ) {
        await this.assertSuperadminAccess(
            actorId,
            actorRole,
            'CREATE_INSTITUTION',
            'SYSTEM',
            'institution',
            context.ipAddress
        );

        const routeKey = buildRouteKey('POST', '/api/admin/institutions');
        return this.executeMutation(
            actorId,
            routeKey,
            context.idempotencyKey,
            input,
            async () => this.runTransaction(async (tx: AdminTx) => {
                const stepUp = await adminStepUpService.assertVerifiedForSensitiveActionTx(
                    tx,
                    actorId,
                    actorRole,
                    context,
                    'CREATE_INSTITUTION',
                    'institution'
                );

                const existingCode = await tx.institution.findUnique({
                    where: { code: input.code }
                });
                
                if (existingCode) {
                    throw new AppError('Institution with this code already exists', 400);
                }

                const existingSlug = await tx.institution.findUnique({
                    where: { slug: input.slug }
                });

                if (existingSlug) {
                    throw new AppError('Institution with this slug already exists', 400);
                }

                const institution = await tx.institution.create({
                    data: {
                        code: input.code.toUpperCase(),
                        name: input.name,
                        slug: input.slug.toLowerCase(),
                        isActive: true
                    }
                });

                await this.createAdminAuditLogTx(tx, {
                    actorId,
                    actorRole,
                    action: 'INSTITUTION_CREATED',
                    targetType: 'SYSTEM',
                    metadata: {
                        institutionId: institution.id,
                        code: institution.code,
                        stepUpChallengeId: stepUp.challengeId
                    },
                    ipAddress: context.ipAddress
                });

                return {
                    success: true,
                    institution
                };
            })
        );
    }
}

export const adminService = new AdminService();

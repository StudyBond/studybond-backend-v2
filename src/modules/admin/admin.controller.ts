// Note: All permission checks are enforced at route level & service level (reference them, IF YOU NEED TO)

import { FastifyRequest, FastifyReply } from 'fastify';
import { adminService } from './admin.service';
import { adminAnalyticsService } from './analytics';
import { getAuthUser } from '../../shared/decorators/requireAdmin';
import { ValidationError } from '../../shared/errors/ValidationError';
import {
    adminInstitutionScopeQuerySchema,
    legacyDeviceRemovalBodySchema,
    legacyDeviceRemovalQuerySchema,
    adminAnalyticsWindowQuerySchema,
    adminPremiumAnalyticsWindowQuerySchema,
    adminUser360QuerySchema
} from './admin.schema';
import {
    parseBooleanString,
    parseOptionalPositiveInt,
    parsePositiveInt,
    parseWithSchema
} from '../../shared/utils/validation';

// Types for request bodies/params (kept for MANUAL casting, if needed)
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
    reason?: string;
}

interface BanBody {
    reason?: string;
}

interface EmailToggleBody {
    enabled: boolean;
}

interface PremiumGrantBody {
    kind: 'MANUAL' | 'PROMOTIONAL' | 'CORRECTIVE';
    durationDays: number;
    note: string;
}

interface PremiumRevokeBody {
    note: string;
}

interface AdminStepUpVerifyBody {
    challengeId: string;
    otp: string;
}

interface PremiumCoverageStateLike {
    isPremium: boolean;
    effectiveEndDate: Date | string | null;
    activeSourceTypes: Array<'SUBSCRIPTION' | 'ADMIN_ENTITLEMENT'>;
}

interface PremiumHistoryResponseLike {
    user: {
        id: number;
        email: string;
        fullName: string;
        isPremium: boolean;
        subscriptionEndDate: Date | string | null;
    };
    currentAccess: PremiumCoverageStateLike;
    subscription: {
        status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
        provider: string;
        planType: string;
        autoRenew: boolean;
        paymentReference: string | null;
        startDate: Date | string;
        endDate: Date | string;
    } | null;
    entitlements: Array<{
        id: string;
        kind: 'MANUAL' | 'PROMOTIONAL' | 'CORRECTIVE';
        status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
        startsAt: Date | string;
        endsAt: Date | string;
        note: string;
        createdAt: Date | string;
        revokedAt: Date | string | null;
        grantedByAdmin: {
            id: number;
            email: string;
            fullName: string;
        };
        revokedByAdmin: {
            id: number;
            email: string;
            fullName: string;
        } | null;
    }>;
}

interface PremiumMutationResponseLike {
    success: boolean;
    message: string;
    currentAccess: PremiumCoverageStateLike;
    entitlement: {
        id: string;
        kind: 'MANUAL' | 'PROMOTIONAL' | 'CORRECTIVE';
        status: 'ACTIVE';
        startsAt: Date | string;
        endsAt: Date | string;
        note: string;
    };
}

interface PremiumRevokeMutationResponseLike {
    success: boolean;
    message: string;
    revokedCount: number;
    currentAccess: PremiumCoverageStateLike;
}

export class AdminController {

    private getIpAddress(request: FastifyRequest): string | undefined {
        return request.ip || (request.headers['x-forwarded-for'] as string) || undefined;
    }

    private toIsoDateTime(value: Date | string): string {
        return value instanceof Date ? value.toISOString() : value;
    }

    private toNullableIsoDateTime(value: Date | string | null | undefined): string | null {
        if (value == null) {
            return null;
        }

        return this.toIsoDateTime(value);
    }

    private serializeJsonDates<T>(value: T): T {
        if (value instanceof Date) {
            return value.toISOString() as T;
        }

        if (Array.isArray(value)) {
            return value.map((item) => this.serializeJsonDates(item)) as T;
        }

        if (value && typeof value === 'object') {
            const entries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
                key,
                this.serializeJsonDates(entryValue)
            ]);

            return Object.fromEntries(entries) as T;
        }

        return value;
    }

    private serializePremiumCoverageState(state: PremiumCoverageStateLike) {
        return {
            ...state,
            effectiveEndDate: this.toNullableIsoDateTime(state.effectiveEndDate)
        };
    }

    private serializePremiumHistory(result: PremiumHistoryResponseLike) {
        return {
            user: {
                ...result.user,
                subscriptionEndDate: this.toNullableIsoDateTime(result.user.subscriptionEndDate)
            },
            currentAccess: this.serializePremiumCoverageState(result.currentAccess),
            subscription: result.subscription
                ? {
                    ...result.subscription,
                    startDate: this.toIsoDateTime(result.subscription.startDate),
                    endDate: this.toIsoDateTime(result.subscription.endDate)
                }
                : null,
            entitlements: result.entitlements.map((entitlement) => ({
                ...entitlement,
                startsAt: this.toIsoDateTime(entitlement.startsAt),
                endsAt: this.toIsoDateTime(entitlement.endsAt),
                createdAt: this.toIsoDateTime(entitlement.createdAt),
                revokedAt: this.toNullableIsoDateTime(entitlement.revokedAt)
            }))
        };
    }

    private serializePremiumMutation(result: PremiumMutationResponseLike) {
        return {
            success: result.success,
            message: result.message,
            currentAccess: this.serializePremiumCoverageState(result.currentAccess),
            entitlement: {
                ...result.entitlement,
                startsAt: this.toIsoDateTime(result.entitlement.startsAt),
                endsAt: this.toIsoDateTime(result.entitlement.endsAt)
            }
        };
    }

    private serializePremiumRevokeMutation(result: PremiumRevokeMutationResponseLike) {
        return {
            success: result.success,
            message: result.message,
            revokedCount: result.revokedCount,
            currentAccess: this.serializePremiumCoverageState(result.currentAccess)
        };
    }

    private getRequestContext(request: FastifyRequest) {
        const authUser = getAuthUser(request);
        return {
            ipAddress: this.getIpAddress(request),
            sessionId: authUser.sessionId,
            userAgent: typeof request.headers['user-agent'] === 'string'
                ? request.headers['user-agent']
                : undefined,
            idempotencyKey: typeof request.headers['idempotency-key'] === 'string'
                ? request.headers['idempotency-key']
                : undefined,
            stepUpToken: typeof request.headers['x-admin-step-up-token'] === 'string'
                ? request.headers['x-admin-step-up-token']
                : undefined
        };
    }

    /* GET /admin/users - List users with filtering */
    getUsers = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const query = request.query as UserListQuery;
        const user = getAuthUser(request);

        const result = await adminService.getUsers(
            user.userId,
            user.role,
            {
                page: parseOptionalPositiveInt(query.page, 1, 'page'),
                limit: parseOptionalPositiveInt(query.limit, 20, 'limit'),
                role: query.role as any,
                isBanned: parseBooleanString(query.isBanned, 'isBanned'),
                isPremium: parseBooleanString(query.isPremium, 'isPremium'),
                search: query.search
            }
        );

        return reply.send(result);
    };

    /* POST /admin/users/:id/ban - Ban a user (Admin and Superadmin can do this) */
    banUser = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const params = request.params as IdParam;
        const body = request.body as BanBody;

        const userId = parsePositiveInt(params.id, 'userId');

        const result = await adminService.banUser(
            user.userId,
            user.role,
            { userId, reason: body?.reason },
            this.getRequestContext(request)
        );

        return reply.send(result);
    };

    /* POST /admin/users/:id/unban - Unban a user (Admin and Superadmin can do this) */
    unbanUser = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const params = request.params as IdParam;

        const userId = parsePositiveInt(params.id, 'userId');

        const result = await adminService.unbanUser(
            user.userId,
            user.role,
            userId,
            this.getRequestContext(request)
        );

        return reply.send(result);
    };

    /* DELETE /admin/devices/:id - Remove a device from a user account (Admin and Superadmin can do this) */
    removeDevice = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const requestAny = request as FastifyRequest & {
            params: Record<string, unknown>;
            body?: unknown;
            query?: unknown;
        };

        let deviceId: string;
        let userId: number;
        let reason: string | undefined;

        if ('userId' in requestAny.params && 'deviceId' in requestAny.params) {
            const params = requestAny.params as { userId?: string | number; deviceId?: string };
            deviceId = params.deviceId || '';
            userId = parsePositiveInt(String(params.userId || ''), 'userId');
            const body = (requestAny.body || {}) as { reason?: string };
            reason = body.reason;
        } else {
            const params = requestAny.params as { id?: string };
            deviceId = params.id || '';

            const legacyBody = parseWithSchema(
                legacyDeviceRemovalBodySchema.partial(),
                requestAny.body ?? {},
                'Invalid device removal payload'
            );
            const legacyQuery = parseWithSchema(
                legacyDeviceRemovalQuerySchema,
                requestAny.query ?? {},
                'Invalid device removal query'
            );

            const resolvedUserId = legacyBody.userId ?? legacyQuery.userId;
            if (!resolvedUserId) {
                throw new ValidationError('userId is required to remove a device.');
            }

            userId = resolvedUserId;
            reason = legacyBody.reason;
        }

        const result = await adminService.removeDevice(
            user.userId,
            user.role,
            { deviceId, userId, reason },
            this.getRequestContext(request)
        );

        return reply.send(result);
    };

    /* POST /admin/users/:id/promote - Promote a user to ADMIN or SUPERADMIN (Only superadmin can do this!) */
    promoteUser = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const params = request.params as IdParam;
        const body = request.body as PromoteBody;

        const userId = parsePositiveInt(params.id, 'userId');
        const { newRole } = body;

        if (!newRole || !['ADMIN', 'SUPERADMIN'].includes(newRole)) {
            throw new ValidationError('Invalid role. Must be ADMIN or SUPERADMIN');
        }

        const result = await adminService.promoteUser(
            user.userId,
            user.role,
            { userId, newRole, reason: body.reason },
            this.getRequestContext(request)
        );

        return reply.send(result);
    };

    /* POST /admin/users/:id/demote - Demote a user to USER role (Again, only superadmin has the power to do this) */
    demoteUser = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const params = request.params as IdParam;
        const body = (request.body || {}) as { reason?: string };
        const userId = parsePositiveInt(params.id, 'userId');

        const result = await adminService.demoteUser(
            user.userId,
            user.role,
            { userId, reason: body.reason },
            this.getRequestContext(request)
        );

        return reply.send(result);
    };

    // FEATURES THAT ARE SUPERADMIN ONLY

    /* GET /admin/premium-users - List premium subscribers*/
    getPremiumUsers = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const query = request.query as PaginationQuery;
        const user = getAuthUser(request);
        const page = parseOptionalPositiveInt(query.page, 1, 'page');
        const limit = parseOptionalPositiveInt(query.limit, 20, 'limit');

        const result = await adminService.getPremiumUsers(user.userId, user.role, page, limit);
        return reply.send(result);
    };

    getPremiumHistory = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const params = request.params as IdParam;
        const userId = parsePositiveInt(params.id, 'userId');

        const result = await adminService.getPremiumHistory(user.userId, user.role, userId);
        return reply.send(this.serializePremiumHistory(result));
    };

    grantPremium = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const params = request.params as IdParam;
        const body = request.body as PremiumGrantBody;
        const userId = parsePositiveInt(params.id, 'userId');

        const result = await adminService.grantPremium(
            user.userId,
            user.role,
            {
                userId,
                kind: body.kind,
                durationDays: body.durationDays,
                note: body.note
            },
            this.getRequestContext(request)
        );

        return reply.send(this.serializePremiumMutation(result));
    };

    extendPremium = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const params = request.params as IdParam;
        const body = request.body as PremiumGrantBody;
        const userId = parsePositiveInt(params.id, 'userId');

        const result = await adminService.extendPremium(
            user.userId,
            user.role,
            {
                userId,
                kind: body.kind,
                durationDays: body.durationDays,
                note: body.note
            },
            this.getRequestContext(request)
        );

        return reply.send(this.serializePremiumMutation(result));
    };

    revokePremium = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const params = request.params as IdParam;
        const body = request.body as PremiumRevokeBody;
        const userId = parsePositiveInt(params.id, 'userId');

        const result = await adminService.revokePremium(
            user.userId,
            user.role,
            {
                userId,
                note: body.note
            },
            this.getRequestContext(request)
        );

        return reply.send(this.serializePremiumRevokeMutation(result));
    };

    requestStepUp = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const result = await adminService.requestStepUp(
            user.userId,
            user.role,
            this.getRequestContext(request)
        );

        return reply.send(result);
    };

    verifyStepUp = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const body = request.body as AdminStepUpVerifyBody;
        const result = await adminService.verifyStepUp(
            user.userId,
            user.role,
            {
                challengeId: body.challengeId,
                otp: body.otp
            },
            this.getRequestContext(request)
        );

        return reply.send(result);
    };

    /* GET /admin/system/settings - Get system settings */
    getSystemSettings = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const settings = await adminService.getSystemSettings(user.userId, user.role);
        return reply.send(settings);
    };

    /* POST /admin/system/email-toggle - Toggle email system (SUPERADMIN only) */
    toggleEmailSystem = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const body = request.body as EmailToggleBody;
        const { enabled } = body;

        if (typeof enabled !== 'boolean') {
            throw new ValidationError('enabled must be a boolean');
        }

        const result = await adminService.toggleEmailSystem(
            user.userId,
            user.role,
            enabled,
            this.getRequestContext(request)
        );

        return reply.send(result);
    };

    /* GET /admin/audit-logs - View admin audit logs */
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
        const user = getAuthUser(request);

        const result = await adminService.getAuditLogs(
            user.userId,
            user.role,
            {
                page: parseOptionalPositiveInt(query.page, 1, 'page'),
                limit: parseOptionalPositiveInt(query.limit, 50, 'limit'),
                actorId: query.actorId ? parsePositiveInt(query.actorId, 'actorId') : undefined,
                action: query.action as any,
                targetType: query.targetType as any,
                startDate: query.startDate ? new Date(query.startDate) : undefined,
                endDate: query.endDate ? new Date(query.endDate) : undefined
            }
        );

        return reply.send(result);
    };

    getAnalyticsOverview = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const query = parseWithSchema(
            adminInstitutionScopeQuerySchema,
            request.query ?? {},
            'Invalid analytics overview query'
        );
        const result = await adminAnalyticsService.getOverview(user.userId, user.role, query.institutionCode);
        return reply.send(this.serializeJsonDates(result));
    };

    getAnalyticsActivity = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const query = parseWithSchema(
            adminAnalyticsWindowQuerySchema,
            request.query ?? {},
            'Invalid analytics activity query'
        );

        const result = await adminAnalyticsService.getActivity(
            user.userId,
            user.role,
            query.days,
            query.institutionCode
        );
        return reply.send(this.serializeJsonDates(result));
    };

    getAnalyticsPremium = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const query = parseWithSchema(
            adminPremiumAnalyticsWindowQuerySchema,
            request.query ?? {},
            'Invalid premium analytics query'
        );

        const result = await adminAnalyticsService.getPremiumInsights(user.userId, user.role, query.days);
        return reply.send(this.serializeJsonDates(result));
    };

    getUser360 = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const params = request.params as IdParam;
        const userId = parsePositiveInt(params.id, 'userId');
        const query = parseWithSchema(
            adminUser360QuerySchema,
            request.query ?? {},
            'Invalid user 360 query'
        );
        const result = await adminAnalyticsService.getUser360(
            user.userId,
            user.role,
            userId,
            query.institutionCode
        );
        return reply.send(this.serializeJsonDates(result));
    };

    getSystemHealth = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const result = await adminAnalyticsService.getSystemHealth(user.userId, user.role);
        return reply.send(this.serializeJsonDates(result));
    };

    createInstitution = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const body = request.body as { code: string; name: string; slug: string };

        const result = await adminService.createInstitution(
            user.userId,
            user.role,
            body,
            this.getRequestContext(request)
        );
        return reply.send(result);
    };

    // ============================================================
    // FREE EXAM MANAGEMENT
    // ============================================================

    /* POST /admin/free-exam/reset - Reset free exam credits for all free users (SUPERADMIN only) */
    resetFreeExamCredits = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const result = await adminService.resetFreeExamCredits(
            user.userId,
            user.role,
            this.getRequestContext(request)
        );
        return reply.send(result);
    };

    /* POST /admin/free-exam/questions/toggle - Toggle isFeaturedFree on questions (ADMIN+) */
    toggleFreeExamQuestions = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const body = request.body as { questionIds: number[]; featured: boolean };

        const result = await adminService.toggleFreeExamQuestions(
            user.userId,
            user.role,
            body,
            this.getRequestContext(request)
        );
        return reply.send(result);
    };

    /* GET /admin/free-exam/coverage - Get free exam pool coverage per subject (ADMIN+) */
    getFreeExamCoverage = async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const user = getAuthUser(request);
        const query = request.query as { institutionCode?: string };

        const result = await adminService.getFreeExamCoverage(
            user.userId,
            user.role,
            query.institutionCode
        );
        return reply.send(result);
    };
}

// Singleton instance
export const adminController = new AdminController();

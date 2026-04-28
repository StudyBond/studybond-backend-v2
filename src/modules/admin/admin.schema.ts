import { z } from 'zod';
import { institutionScopeQuerySchema } from '../../shared/institutions/query';

export const banUserSchema = z.object({
    reason: z.string().trim().min(3).max(255).optional()
}).strict();

export const promoteUserSchema = z.object({
    newRole: z.enum(['ADMIN', 'SUPERADMIN']),
    reason: z.string().trim().min(3).max(255).optional()
}).strict();

export const demoteUserSchema = z.object({
    reason: z.string().trim().min(3).max(255).optional()
}).strict();

export const deviceRemovalBodySchema = z.object({
    reason: z.string().trim().min(3).max(255).optional()
}).strict();

export const legacyDeviceRemovalBodySchema = z.object({
    userId: z.number().int().positive(),
    reason: z.string().trim().min(3).max(255).optional()
}).strict();

export const legacyDeviceRemovalOptionalBodySchema = legacyDeviceRemovalBodySchema.nullish();

export const emailToggleSchema = z.object({
    enabled: z.boolean()
}).strict();

export const premiumGrantSchema = z.object({
    kind: z.enum(['MANUAL', 'PROMOTIONAL', 'CORRECTIVE']),
    durationDays: z.number().int().min(1).max(3650),
    note: z.string().trim().min(10).max(500)
}).strict();

export const premiumRevokeSchema = z.object({
    note: z.string().trim().min(10).max(500)
}).strict();

export const adminStepUpRequestSchema = z.object({}).strict();

export const adminStepUpVerifySchema = z.object({
    challengeId: z.string().uuid(),
    otp: z.string().trim().regex(/^\d{6}$/, 'OTP must be a 6-digit code')
}).strict();

export const paramsIdSchema = z.object({
    id: z.string().transform((val) => parseInt(val, 10)).pipe(z.number().int().positive())
});

export const adminPaginationQuerySchema = z.object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20)
}).strict();

export const adminUsersQuerySchema = adminPaginationQuerySchema.extend({
    role: z.enum(['USER', 'ADMIN', 'SUPERADMIN']).optional(),
    isBanned: z.coerce.boolean().optional(),
    isPremium: z.coerce.boolean().optional(),
    search: z.string().trim().min(1).max(120).optional()
}).strict();

export const adminInstitutionScopeQuerySchema = institutionScopeQuerySchema;

export const adminAnalyticsWindowQuerySchema = institutionScopeQuerySchema.extend({
    days: z.coerce.number().int().min(1).max(90).default(14)
}).strict();

export const adminPremiumAnalyticsWindowQuerySchema = z.object({
    days: z.coerce.number().int().min(1).max(90).default(30)
}).strict();

export const adminUser360QuerySchema = institutionScopeQuerySchema;

export const adminAuditLogsQuerySchema = adminPaginationQuerySchema.extend({
    actorId: z.coerce.number().int().positive().optional(),
    action: z.string().trim().min(1).max(80).optional(),
    targetType: z.string().trim().min(1).max(80).optional(),
    startDate: z.iso.datetime().optional(),
    endDate: z.iso.datetime().optional()
}).strict();

export const deviceRemovalParamsSchema = z.object({
    userId: z.string().transform((val) => parseInt(val, 10)).pipe(z.number().int().positive()),
    deviceId: z.string().trim().min(1).max(128)
});

export const legacyDeviceRemovalQuerySchema = z.object({
    userId: z.coerce.number().int().positive().optional()
}).strict();

export const legacyDeviceRemovalParamsSchema = z.object({
    id: z.string().min(1).max(128)
});

export const sensitiveAdminHeadersSchema = z.object({
    'idempotency-key': z.string().trim().min(8, 'Idempotency-Key must be at least 8 characters').optional(),
    'x-admin-step-up-token': z.string().trim().min(16, 'x-admin-step-up-token must be provided for sensitive admin actions').optional()
}).passthrough();

export const createInstitutionSchema = z.object({
    code: z.string().trim().min(2).max(10),
    name: z.string().trim().min(3).max(100),
    slug: z.string().trim().min(3).max(100),
}).strict();

// Route definitions with strict permission guards
// Security-first: Guards are applied at route level

import { FastifyInstance } from 'fastify';
import { adminController } from './admin.controller';
import { authenticate } from '../../shared/decorators/authenticate';
import { requireAdmin, requireSuperadmin } from '../../shared/decorators/requireAdmin';
import { optionalIdempotencyHeadersSchema } from '../../shared/idempotency/schema';
import { ADMIN_CONFIG } from '../../config/constants';
import {
    adminActionResultSchema,
    adminActivityResponseSchema,
    adminAuditLogListResponseSchema,
    adminOverviewResponseSchema,
    adminPremiumInsightsResponseSchema,
    adminStepUpRequestResponseSchema,
    adminStepUpVerifyResponseSchema,
    adminSystemHealthResponseSchema,
    adminSystemSettingsResponseSchema,
    adminUser360ResponseSchema,
    adminUserListResponseSchema,
    premiumGrantMutationResponseSchema,
    premiumHistoryResponseSchema,
    premiumRevokeMutationResponseSchema,
    premiumUserListResponseSchema
} from './admin.openapi';
import { withStandardErrorResponses } from '../../shared/openapi/responses';
import {
    adminAnalyticsWindowQuerySchema,
    adminAuditLogsQuerySchema,
    adminInstitutionScopeQuerySchema,
    adminPaginationQuerySchema,
    adminPremiumAnalyticsWindowQuerySchema,
    adminStepUpVerifySchema,
    adminUser360QuerySchema,
    adminUsersQuerySchema,
    banUserSchema,
    demoteUserSchema,
    deviceRemovalBodySchema,
    deviceRemovalParamsSchema,
    emailToggleSchema,
    legacyDeviceRemovalOptionalBodySchema,
    legacyDeviceRemovalParamsSchema,
    legacyDeviceRemovalQuerySchema,
    paramsIdSchema,
    premiumGrantSchema,
    premiumRevokeSchema,
    promoteUserSchema,
    sensitiveAdminHeadersSchema,
    createInstitutionSchema
} from './admin.schema';

export async function adminRoutes(app: FastifyInstance) {

    // All admin routes require authentication
    app.addHook('preHandler', authenticate);

    app.get('/analytics/overview', {
        preHandler: [requireAdmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.READ_RATE_LIMIT_MAX,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Admin'],
            summary: 'Get admin analytics overview',
            description: 'Return high-level operational analytics for the admin command center.',
            querystring: adminInstitutionScopeQuerySchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: adminOverviewResponseSchema
            })
        }
    }, adminController.getAnalyticsOverview);

    app.get('/analytics/activity', {
        preHandler: [requireAdmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.READ_RATE_LIMIT_MAX,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Admin'],
            summary: 'Get admin activity analytics',
            description: 'Return activity trends for a configurable trailing day window.',
            querystring: adminAnalyticsWindowQuerySchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: adminActivityResponseSchema
            })
        }
    }, adminController.getAnalyticsActivity);

    app.get('/analytics/system-health', {
        preHandler: [requireAdmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.READ_RATE_LIMIT_MAX,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Admin'],
            summary: 'Get system health snapshot',
            description: 'Return infrastructure and runtime health signals for the admin command center.',
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: adminSystemHealthResponseSchema
            })
        }
    }, adminController.getSystemHealth);

    app.get('/analytics/premium', {
        preHandler: [requireSuperadmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.READ_RATE_LIMIT_MAX,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Admin'],
            summary: 'Get premium analytics',
            description: 'Return premium conversion, entitlement, and revenue analytics for superadmins.',
            querystring: adminPremiumAnalyticsWindowQuerySchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: adminPremiumInsightsResponseSchema
            })
        }
    }, adminController.getAnalyticsPremium);

    app.get('/users/:id/360', {
        preHandler: [requireAdmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.READ_RATE_LIMIT_MAX,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Admin'],
            summary: 'Get user 360',
            description: 'Return a consolidated operations view for a single user.',
            params: paramsIdSchema,
            querystring: adminUser360QuerySchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: adminUser360ResponseSchema
            })
        }
    }, adminController.getUser360);

    app.post('/step-up/request', {
        preHandler: [requireSuperadmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.STEP_UP_REQUEST_RATE_LIMIT_MAX,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Admin'],
            summary: 'Request admin step-up challenge',
            description: 'Issue a short-lived superadmin step-up challenge for sensitive actions.',
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: adminStepUpRequestResponseSchema
            })
        }
    }, adminController.requestStepUp);

    app.post('/step-up/verify', {
        preHandler: [requireSuperadmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.STEP_UP_VERIFY_RATE_LIMIT_MAX,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Admin'],
            summary: 'Verify admin step-up challenge',
            description: 'Verify the OTP for a superadmin step-up challenge and mint a short-lived step-up token.',
            body: adminStepUpVerifySchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: adminStepUpVerifyResponseSchema
            })
        }
    }, adminController.verifyStepUp);

    // These are user management routes
    app.get('/users', {
        preHandler: [requireAdmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.READ_RATE_LIMIT_MAX,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Admin'],
            summary: 'List users',
            description: 'List users with admin-side filters for support and moderation workflows.',
            querystring: adminUsersQuerySchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: adminUserListResponseSchema
            })
        }
    }, adminController.getUsers);

    app.post('/users/:id/ban', {
        preHandler: [requireAdmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.MUTATION_RATE_LIMIT_MAX,
                timeWindow: '1 hour'
            }
        },
        schema: {
            headers: optionalIdempotencyHeadersSchema,
            params: paramsIdSchema,
            body: banUserSchema,
            tags: ['Admin'],
            summary: 'Ban user',
            description: 'Ban a user account and record the moderation reason.',
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: adminActionResultSchema
            })
        }
    }, adminController.banUser);

    app.post('/users/:id/unban', {
        preHandler: [requireAdmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.MUTATION_RATE_LIMIT_MAX,
                timeWindow: '1 hour'
            }
        },
        schema: {
            headers: optionalIdempotencyHeadersSchema,
            params: paramsIdSchema,
            tags: ['Admin'],
            summary: 'Unban user',
            description: 'Restore access to a previously banned user.',
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: adminActionResultSchema
            })
        }
    }, adminController.unbanUser);

    // Canonical device management route
    app.post('/users/:userId/devices/:deviceId/remove', {
        preHandler: [requireAdmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.MUTATION_RATE_LIMIT_MAX,
                timeWindow: '1 hour'
            }
        },
        schema: {
            headers: optionalIdempotencyHeadersSchema,
            params: deviceRemovalParamsSchema,
            body: deviceRemovalBodySchema,
            tags: ['Admin'],
            summary: 'Remove registered device',
            description: 'Remove a registered premium device on behalf of a user and deactivate sessions on that device.',
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: adminActionResultSchema
            })
        }
    }, adminController.removeDevice);

    // Legacy compatibility route. Prefer the canonical user-scoped route above.
    app.delete('/devices/:id', {
        preHandler: [requireAdmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.MUTATION_RATE_LIMIT_MAX,
                timeWindow: '1 hour'
            }
        },
        schema: {
            headers: optionalIdempotencyHeadersSchema,
            params: legacyDeviceRemovalParamsSchema,
            querystring: legacyDeviceRemovalQuerySchema,
            body: legacyDeviceRemovalOptionalBodySchema,
            tags: ['Admin'],
            summary: 'Remove registered device (legacy route)',
            description: 'Backward-compatible legacy device removal endpoint. Prefer the canonical user-scoped route.',
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: adminActionResultSchema
            })
        }
    }, adminController.removeDevice);

    // All Power has been given to the SUPERADMIN ONLY-ROUTES

    // Role management
    app.post('/users/:id/promote', {
        preHandler: [requireSuperadmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.SENSITIVE_RATE_LIMIT_MAX,
                timeWindow: '1 hour'
            }
        },
        schema: {
            headers: sensitiveAdminHeadersSchema,
            params: paramsIdSchema,
            body: promoteUserSchema,
            tags: ['Admin'],
            summary: 'Promote user role',
            description: 'Promote a user to ADMIN or SUPERADMIN. Sensitive superadmin action.',
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: adminActionResultSchema
            })
        }
    }, adminController.promoteUser);

    app.post('/users/:id/demote', {
        preHandler: [requireSuperadmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.SENSITIVE_RATE_LIMIT_MAX,
                timeWindow: '1 hour'
            }
        },
        schema: {
            headers: sensitiveAdminHeadersSchema,
            params: paramsIdSchema,
            body: demoteUserSchema,
            tags: ['Admin'],
            summary: 'Demote user role',
            description: 'Demote an admin or superadmin back to USER. Sensitive superadmin action.',
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: adminActionResultSchema
            })
        }
    }, adminController.demoteUser);

    // Premium user visibility & system settings
    app.get('/premium-users', {
        preHandler: [requireSuperadmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.READ_RATE_LIMIT_MAX,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Admin'],
            summary: 'List premium users',
            description: 'List users that currently have premium access.',
            querystring: adminPaginationQuerySchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: premiumUserListResponseSchema
            })
        }
    }, adminController.getPremiumUsers);

    app.get('/users/:id/premium/history', {
        preHandler: [requireSuperadmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.READ_RATE_LIMIT_MAX,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Admin'],
            summary: 'Get premium history',
            description: 'Return payment and manual entitlement history for a single user.',
            params: paramsIdSchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: premiumHistoryResponseSchema
            })
        }
    }, adminController.getPremiumHistory);

    app.post('/users/:id/premium/grants', {
        preHandler: [requireSuperadmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.SENSITIVE_RATE_LIMIT_MAX,
                timeWindow: '1 hour'
            }
        },
        schema: {
            headers: sensitiveAdminHeadersSchema,
            params: paramsIdSchema,
            body: premiumGrantSchema,
            tags: ['Admin'],
            summary: 'Grant premium entitlement',
            description: 'Manually grant premium access. Sensitive superadmin action.',
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: premiumGrantMutationResponseSchema
            })
        }
    }, adminController.grantPremium);

    app.post('/users/:id/premium/extend', {
        preHandler: [requireSuperadmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.SENSITIVE_RATE_LIMIT_MAX,
                timeWindow: '1 hour'
            }
        },
        schema: {
            headers: sensitiveAdminHeadersSchema,
            params: paramsIdSchema,
            body: premiumGrantSchema,
            tags: ['Admin'],
            summary: 'Extend premium entitlement',
            description: 'Manually extend premium access. Sensitive superadmin action.',
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: premiumGrantMutationResponseSchema
            })
        }
    }, adminController.extendPremium);

    app.post('/users/:id/premium/revoke', {
        preHandler: [requireSuperadmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.SENSITIVE_RATE_LIMIT_MAX,
                timeWindow: '1 hour'
            }
        },
        schema: {
            headers: sensitiveAdminHeadersSchema,
            params: paramsIdSchema,
            body: premiumRevokeSchema,
            tags: ['Admin'],
            summary: 'Revoke premium entitlement',
            description: 'Manually revoke premium access. Sensitive superadmin action.',
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: premiumRevokeMutationResponseSchema
            })
        }
    }, adminController.revokePremium);

    app.get('/system/settings', {
        preHandler: [requireSuperadmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.READ_RATE_LIMIT_MAX,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Admin'],
            summary: 'Get system settings',
            description: 'Return current admin-managed platform settings.',
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: adminSystemSettingsResponseSchema
            })
        }
    }, adminController.getSystemSettings);

    app.post('/institutions', {
        preHandler: [requireSuperadmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.SENSITIVE_RATE_LIMIT_MAX,
                timeWindow: '1 hour'
            }
        },
        schema: {
            headers: sensitiveAdminHeadersSchema,
            body: createInstitutionSchema,
            tags: ['Admin'],
            summary: 'Create a new institution',
            description: 'Dynamically register a new Institution for the system. Sensitive superadmin action.',
            security: [{ bearerAuth: [] }]
        }
    }, adminController.createInstitution);

    app.post('/system/email-toggle', {
        preHandler: [requireSuperadmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.SENSITIVE_RATE_LIMIT_MAX,
                timeWindow: '1 hour'
            }
        },
        schema: {
            headers: sensitiveAdminHeadersSchema,
            body: emailToggleSchema,
            tags: ['Admin'],
            summary: 'Toggle email system',
            description: 'Enable or disable transactional email delivery. Sensitive superadmin action.',
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: adminSystemSettingsResponseSchema
            })
        }
    }, adminController.toggleEmailSystem);

    // Audit logs
    app.get('/audit-logs', {
        preHandler: [requireSuperadmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.READ_RATE_LIMIT_MAX,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Admin'],
            summary: 'Get admin audit logs',
            description: 'Browse the admin audit trail with filters.',
            querystring: adminAuditLogsQuerySchema,
            security: [{ bearerAuth: [] }],
            response: withStandardErrorResponses({
                200: adminAuditLogListResponseSchema
            })
        }
    }, adminController.getAuditLogs);

    // ============================================================
    // FREE EXAM MANAGEMENT
    // ============================================================

    // SUPERADMIN: Reset free exam credits for all free users
    app.post('/free-exam/reset', {
        preHandler: [requireSuperadmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.SENSITIVE_RATE_LIMIT_MAX,
                timeWindow: '1 hour'
            }
        },
        schema: {
            headers: sensitiveAdminHeadersSchema,
            tags: ['Admin'],
            summary: 'Reset free exam credits',
            description: 'Reset free exam subject credits for ALL non-premium users. Sensitive superadmin action requiring step-up verification.',
            security: [{ bearerAuth: [] }]
        }
    }, adminController.resetFreeExamCredits);

    // ADMIN+: Toggle isFeaturedFree on questions
    app.post('/free-exam/questions/toggle', {
        preHandler: [requireAdmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.MUTATION_RATE_LIMIT_MAX,
                timeWindow: '1 hour'
            }
        },
        schema: {
            headers: optionalIdempotencyHeadersSchema,
            tags: ['Admin'],
            summary: 'Toggle free exam questions',
            description: 'Add or remove questions from the free exam pool by toggling the isFeaturedFree flag.',
            security: [{ bearerAuth: [] }]
        }
    }, adminController.toggleFreeExamQuestions);

    // ADMIN+: Get free exam coverage per subject
    app.get('/free-exam/coverage', {
        preHandler: [requireAdmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.READ_RATE_LIMIT_MAX,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Admin'],
            summary: 'Get free exam pool coverage',
            description: 'Return per-subject counts of featured free questions vs the configured cap for each institution.',
            querystring: adminInstitutionScopeQuerySchema,
            security: [{ bearerAuth: [] }]
        }
    }, adminController.getFreeExamCoverage);

    // ADMIN+: Get free exam leaderboard (top scorers per subject per cycle)
    app.get('/free-exam/leaderboard', {
        preHandler: [requireAdmin],
        config: {
            rateLimit: {
                max: ADMIN_CONFIG.READ_RATE_LIMIT_MAX,
                timeWindow: '1 minute'
            }
        },
        schema: {
            tags: ['Admin'],
            summary: 'Get free exam leaderboard',
            description: 'Return ranked top scorers per subject for a given reset cycle. Use cycleIndex=0 for the current cycle (default), cycleIndex=1 for the previous cycle, etc.',
            querystring: adminInstitutionScopeQuerySchema,
            security: [{ bearerAuth: [] }]
        }
    }, adminController.getFreeExamLeaderboard);
}

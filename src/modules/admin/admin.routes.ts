// ============================================
// ADMIN ROUTES
// ============================================
// Route definitions with strict permission guards
// Security-first: Guards are applied at route level

import { FastifyInstance } from 'fastify';
import { adminController } from './admin.controller';
import { authenticate } from '../../shared/decorators/authenticate';
import { requireAdmin, requireSuperadmin } from '../../shared/decorators/requireAdmin';
import { banUserSchema, promoteUserSchema, emailToggleSchema, paramsIdSchema } from './admin.schema';

export async function adminRoutes(app: FastifyInstance) {

    // All admin routes require authentication
    app.addHook('preHandler', authenticate);

    // ========================================
    // ADMIN + SUPERADMIN ROUTES
    // ========================================

    // User management
    app.get('/users', {
        preHandler: [requireAdmin]
    }, adminController.getUsers);

    app.post('/users/:id/ban', {
        preHandler: [requireAdmin],
        schema: {
            params: paramsIdSchema,
            body: banUserSchema
        }
    }, adminController.banUser);

    app.post('/users/:id/unban', {
        preHandler: [requireAdmin],
        schema: {
            params: paramsIdSchema
        }
    }, adminController.unbanUser);

    // Device management
    app.delete('/devices/:id', {
        preHandler: [requireAdmin],
        // Device ID is a UUID string, not a number, so we don't use paramsIdSchema
        schema: {
            params: {
                type: 'object',
                properties: {
                    id: { type: 'string' }
                }
            }
        }
    }, adminController.removeDevice);

    // ========================================
    // SUPERADMIN ONLY ROUTES
    // ========================================

    // Role management
    app.post('/users/:id/promote', {
        preHandler: [requireSuperadmin],
        schema: {
            params: paramsIdSchema,
            body: promoteUserSchema
        }
    }, adminController.promoteUser);

    app.post('/users/:id/demote', {
        preHandler: [requireSuperadmin],
        schema: {
            params: paramsIdSchema,
            body: promoteUserSchema // Re-using promote schema (optional reason)
        }
    }, adminController.demoteUser);

    // Premium user visibility
    app.get('/premium-users', {
        preHandler: [requireSuperadmin]
    }, adminController.getPremiumUsers);

    // System settings
    app.get('/system/settings', {
        preHandler: [requireSuperadmin]
    }, adminController.getSystemSettings);

    app.post('/system/email-toggle', {
        preHandler: [requireSuperadmin],
        schema: {
            body: emailToggleSchema
        }
    }, adminController.toggleEmailSystem);

    // Audit logs
    app.get('/audit-logs', {
        preHandler: [requireSuperadmin]
    }, adminController.getAuditLogs);
}

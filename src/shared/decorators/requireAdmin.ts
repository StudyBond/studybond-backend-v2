// ============================================
// ROLE-BASED AUTHORIZATION GUARD
// ============================================
// Hierarchical role checking: SUPERADMIN > ADMIN > USER
// This is the central authority gate for the platform.

import { FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '../errors/AppError';

// Role hierarchy (higher index = more authority)
const ROLE_HIERARCHY = ['USER', 'ADMIN', 'SUPERADMIN'] as const;
type Role = typeof ROLE_HIERARCHY[number];

interface JWTUser {
    id: number;
    role: Role;
    email: string;
}

/**
 * Get role level for comparison
 * Returns -1 if role is invalid (fail-closed)
 */
function getRoleLevel(role: string): number {
    const level = ROLE_HIERARCHY.indexOf(role as Role);
    return level; // -1 if not found
}

/**
 * Check if actor role is at least the required level
 * Fail-closed: unknown roles are treated as no access
 */
export function hasRoleAtLeast(actorRole: string, requiredRole: Role): boolean {
    const actorLevel = getRoleLevel(actorRole);
    const requiredLevel = getRoleLevel(requiredRole);

    // Fail-closed: if either role is unknown, deny access
    if (actorLevel === -1 || requiredLevel === -1) {
        return false;
    }

    return actorLevel >= requiredLevel;
}

/**
 * Middleware factory: Require minimum role level
 * Usage: app.addHook('preHandler', requireRoleAtLeast('ADMIN'))
 */
export function requireRoleAtLeast(minimumRole: Role) {
    return async function (request: FastifyRequest, _reply: FastifyReply) {
        const user = request.user as JWTUser | undefined;

        if (!user) {
            throw new AppError('Unauthorized: No user in request', 401);
        }

        if (!hasRoleAtLeast(user.role, minimumRole)) {
            throw new AppError(`Forbidden: Requires ${minimumRole} or higher`, 403);
        }
    };
}

/**
 * Require ADMIN or SUPERADMIN access
 * SUPERADMIN inherits all ADMIN capabilities
 */
export async function requireAdmin(request: FastifyRequest, _reply: FastifyReply) {
    const user = request.user as JWTUser | undefined;

    if (!user) {
        throw new AppError('Unauthorized: No user in request', 401);
    }

    if (!hasRoleAtLeast(user.role, 'ADMIN')) {
        throw new AppError('Forbidden: Admin access only', 403);
    }
}

/**
 * Require SUPERADMIN access only
 * For critical operations: role management, system settings, premium data
 */
export async function requireSuperadmin(request: FastifyRequest, _reply: FastifyReply) {
    const user = request.user as JWTUser | undefined;

    if (!user) {
        throw new AppError('Unauthorized: No user in request', 401);
    }

    if (user.role !== 'SUPERADMIN') {
        throw new AppError('Forbidden: Superadmin access only', 403);
    }
}

/**
 * Helper to get current user from request (type-safe)
 */
export function getAuthUser(request: FastifyRequest): JWTUser {
    const user = request.user as JWTUser | undefined;

    if (!user) {
        throw new AppError('Unauthorized: No user in request', 401);
    }

    return user;
}

/**
 * Check if user can perform action on target role
 * Prevents: ADMIN modifying ADMIN/SUPERADMIN, SUPERADMIN demoting SUPERADMIN
 */
export function canManageRole(actorRole: string, targetRole: string): boolean {
    // SUPERADMIN can manage ADMIN and USER, but NOT other SUPERADMINs
    if (actorRole === 'SUPERADMIN') {
        return targetRole !== 'SUPERADMIN';
    }

    // ADMIN cannot manage any roles (operational only, not governing)
    return false;
}

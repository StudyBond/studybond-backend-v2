// Hierarchical role checking: SUPERADMIN > ADMIN > USER

import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthError } from '../errors/AuthError';
import { ForbiddenError } from '../errors/ForbiddenError';

// Role hierarchy (higher index = more authority)
const ROLE_HIERARCHY = ['USER', 'ADMIN', 'SUPERADMIN'] as const;
type Role = typeof ROLE_HIERARCHY[number];

interface JWTUser {
    userId: number;
    role: Role;
    email: string;
    sessionId?: string;
    deviceId?: string;
    tokenVersion?: number;
}

/* Get role level for comparison & Returns -1 if role is invalid (fail-closed) */
function getRoleLevel(role: string): number {
    const level = ROLE_HIERARCHY.indexOf(role as Role);
    return level; // -1 if not found
}

/* Check if actor role is at least the required level
  Fail-closed: unknown roles are treated as no access
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

/* Require minimum role level , Usage: app.addHook('preHandler', requireRoleAtLeast('ADMIN'))
 */
export function requireRoleAtLeast(minimumRole: Role) {
    return async function (request: FastifyRequest, _reply: FastifyReply) {
        const user = request.user as JWTUser | undefined;

        if (!user) {
            throw new AuthError('Please log in to continue.', 401, 'SESSION_INVALID');
        }

        if (!hasRoleAtLeast(user.role, minimumRole)) {
            throw new ForbiddenError(`This action requires ${minimumRole} access or higher.`);
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
        throw new AuthError('Please log in to continue.', 401, 'SESSION_INVALID');
    }

    if (!hasRoleAtLeast(user.role, 'ADMIN')) {
        throw new ForbiddenError('Admin access is required for this action.');
    }
}

/**
 * Require SUPERADMIN access only
 * For critical operations: role management, system settings, premium data
 */
export async function requireSuperadmin(request: FastifyRequest, _reply: FastifyReply) {
    const user = request.user as JWTUser | undefined;

    if (!user) {
        throw new AuthError('Please log in to continue.', 401, 'SESSION_INVALID');
    }

    if (user.role !== 'SUPERADMIN') {
        throw new ForbiddenError('Superadmin access is required for this action.');
    }
}

/* Helper to get current user from request */
export function getAuthUser(request: FastifyRequest): JWTUser {
    const user = request.user as JWTUser | undefined;

    if (!user) {
        throw new AuthError('Please log in to continue.', 401, 'SESSION_INVALID');
    }

    return user;
}

export function canManageRole(actorRole: string, targetRole: string): boolean {
    if (actorRole === 'SUPERADMIN') {
        return targetRole !== 'SUPERADMIN';
    }
    return false;
}

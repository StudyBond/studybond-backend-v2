// ============================================
// ADMIN MODULE TYPES
// ============================================
// TypeScript interfaces for admin operations

export type AdminAuditAction =
    | 'ROLE_PROMOTED'
    | 'ROLE_DEMOTED'
    | 'ROLE_PROMOTION_ATTEMPT_FAILED'
    | 'ROLE_DEMOTION_ATTEMPT_FAILED'
    | 'USER_BANNED'
    | 'USER_UNBANNED'
    | 'DEVICE_REMOVED'
    | 'QUESTION_DELETED'
    | 'QUESTION_EDITED'
    | 'EMAIL_SYSTEM_TOGGLED'
    | 'REPORT_RESOLVED'
    | 'UNAUTHORIZED_ACTION_ATTEMPT';

export type TargetType = 'USER' | 'QUESTION' | 'DEVICE' | 'SYSTEM' | 'REPORT';

export interface AuditLogEntry {
    actorId: number;
    actorRole: string;
    action: AdminAuditAction;
    targetType: TargetType;
    targetId?: string;
    metadata?: Record<string, unknown>;
    reason?: string;
    ipAddress?: string;
}

export interface BanUserInput {
    userId: number;
    reason?: string;
}

export interface PromoteUserInput {
    userId: number;
    newRole: 'ADMIN' | 'SUPERADMIN';
}

export interface DemoteUserInput {
    userId: number;
}

export interface DeviceRemovalInput {
    deviceId: string;
    userId: number;
    reason?: string;
}

export interface EmailToggleInput {
    enabled: boolean;
}

export interface UserListQuery {
    page?: number;
    limit?: number;
    role?: 'USER' | 'ADMIN' | 'SUPERADMIN';
    isBanned?: boolean;
    isPremium?: boolean;
    search?: string;
}

export interface PremiumUserResponse {
    id: number;
    email: string;
    fullName: string;
    isPremium: boolean;
    subscriptionEndDate: Date | null;
    createdAt: Date;
}

export interface AdminUserResponse {
    id: number;
    email: string;
    fullName: string;
    role: string;
    isBanned: boolean;
    isPremium: boolean;
    createdAt: Date;
    deviceCount: number;
}

export interface SystemSettingsResponse {
    emailEnabled: boolean;
    updatedAt: Date;
}

export interface DailyAnalytics {
    date: string;
    totalPracticeTimeMinutes: number;
    totalExamsTaken: number;
    realExamCount: number;
    practiceExamCount: number;
}

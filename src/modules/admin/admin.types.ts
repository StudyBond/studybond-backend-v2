import type { ResolvedInstitutionContext } from '../../shared/institutions/context';

export type AdminAuditAction =
    | 'ROLE_PROMOTED'
    | 'ROLE_DEMOTED'
    | 'ROLE_PROMOTION_ATTEMPT_FAILED'
    | 'ROLE_DEMOTION_ATTEMPT_FAILED'
    | 'USER_BANNED'
    | 'USER_UNBANNED'
    | 'DEVICE_REMOVED'
    | 'PREMIUM_GRANTED'
    | 'PREMIUM_EXTENDED'
    | 'PREMIUM_REVOKED'
    | 'STEP_UP_CHALLENGE_REQUESTED'
    | 'STEP_UP_CHALLENGE_VERIFIED'
    | 'STEP_UP_CHALLENGE_FAILED'
    | 'QUESTION_DELETED'
    | 'QUESTION_EDITED'
    | 'EMAIL_SYSTEM_TOGGLED'
    | 'REPORT_REVIEWED'
    | 'REPORT_RESOLVED'
    | 'REPORT_HARD_DELETED'
    | 'UNAUTHORIZED_ACTION_ATTEMPT'
    | 'EXAM_CHEAT_VIOLATION';

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
    reason?: string;
}

export interface DemoteUserInput {
    userId: number;
    reason?: string;
}

export interface DeviceRemovalInput {
    deviceId: string;
    userId: number;
    reason?: string;
}

export type PremiumEntitlementKind = 'MANUAL' | 'PROMOTIONAL' | 'CORRECTIVE';
export type PremiumEntitlementStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export interface PremiumGrantInput {
    userId: number;
    kind: PremiumEntitlementKind;
    durationDays: number;
    note: string;
}

export interface PremiumRevokeInput {
    userId: number;
    note: string;
}

export interface AdminRequestContext {
    ipAddress?: string;
    idempotencyKey?: string;
    sessionId?: string;
    userAgent?: string;
    stepUpToken?: string;
}

export interface AdminStepUpVerifyInput {
    challengeId: string;
    otp: string;
}

export interface AdminStepUpRequestResponse {
    challengeId: string;
    purpose: 'SUPERADMIN_SENSITIVE_ACTION';
    expiresAt: string;
    deliveryMode: 'BREVO' | 'RESEND' | 'DEV_PREVIEW';
    message: string;
}

export interface AdminStepUpVerifyResponse {
    purpose: 'SUPERADMIN_SENSITIVE_ACTION';
    stepUpToken: string;
    expiresAt: string;
    message: string;
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

export interface PremiumHistorySubscriptionSnapshot {
    status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
    provider: string;
    planType: string;
    autoRenew: boolean;
    paymentReference: string | null;
    startDate: Date;
    endDate: Date;
}

export interface PremiumHistoryEntitlement {
    id: string;
    kind: PremiumEntitlementKind;
    status: PremiumEntitlementStatus;
    startsAt: Date;
    endsAt: Date;
    note: string;
    createdAt: Date;
    revokedAt: Date | null;
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
}

export interface PremiumHistoryResponse {
    user: {
        id: number;
        email: string;
        fullName: string;
        isPremium: boolean;
        subscriptionEndDate: Date | null;
    };
    currentAccess: {
        isPremium: boolean;
        effectiveEndDate: Date | null;
        activeSourceTypes: Array<'SUBSCRIPTION' | 'ADMIN_ENTITLEMENT'>;
    };
    subscription: PremiumHistorySubscriptionSnapshot | null;
    entitlements: PremiumHistoryEntitlement[];
}

export interface PremiumCoverageState {
    isPremium: boolean;
    effectiveEndDate: Date | null;
    activeSourceTypes: Array<'SUBSCRIPTION' | 'ADMIN_ENTITLEMENT'>;
}

export type AnalyticsDataSource = 'LIVE' | 'ROLLUP';

export interface DailyAnalytics {
    date: string;
    totalPracticeTimeMinutes: number;
    totalExamsTaken: number;
    realExamCount: number;
    practiceExamCount: number;
}

export interface AdminAnalyticsWindowQuery {
    days: number;
}

export interface AdminOverviewResponse {
    generatedAt: Date;
    institution: ResolvedInstitutionContext | null;
    users: {
        total: number;
        verified: number;
        banned: number;
        admins: number;
        superadmins: number;
        newLast7Days: number;
        newLast30Days: number;
    };
    premium: {
        activeUsers: number;
        activePaidSubscriptions: number;
        activeAdminEntitlements: number;
        expiringIn7Days: number;
        expiringIn30Days: number;
    };
    engagement: {
        activeSessions: number;
        usersWithActiveStreak: number;
        examsInProgress: number;
        examsStartedLast7Days: number;
        examsCompletedLast7Days: number;
        collaborationWaiting: number;
        collaborationInProgress: number;
        collaborationCreatedLast7Days: number;
    };
    content: {
        totalQuestions: number;
        freeExamQuestions: number;
        realUiQuestions: number;
        practiceQuestions: number;
        pendingReports: number;
    };
    risk: {
        leaderboardSignalsLast24Hours: number;
        pendingStepUpChallenges: number;
        adminActionsLast24Hours: number;
        recentEmailFailuresLast24Hours: number;
    };
}

export interface AdminActivityPoint {
    date: string;
    newUsers: number;
    examStarts: number;
    examCompletions: number;
    collaborationSessions: number;
    paidPremiumActivations: number;
    manualPremiumGrants: number;
}

export interface AdminActivityResponse {
    generatedAt: Date;
    institution: ResolvedInstitutionContext | null;
    windowDays: number;
    dataSource: AnalyticsDataSource;
    summary: {
        newUsers: number;
        examStarts: number;
        examCompletions: number;
        collaborationSessions: number;
        paidPremiumActivations: number;
        manualPremiumGrants: number;
    };
    daily: AdminActivityPoint[];
}

export interface AdminPremiumPoint {
    date: string;
    successfulPayments: number;
    revenueNaira: number;
    manualGrants: number;
    revocations: number;
}

export interface AdminPremiumInsightsResponse {
    generatedAt: Date;
    windowDays: number;
    dataSource: AnalyticsDataSource;
    current: {
        activePremiumUsers: number;
        activePaidSubscriptions: number;
        activeAdminEntitlements: number;
        autoRenewEnabledSubscriptions: number;
        expiringIn7Days: number;
        expiringIn30Days: number;
    };
    revenue: {
        successfulPayments: number;
        successfulRevenueNaira: number;
        reusableAuthorizations: number;
    };
    adminActions: {
        manualGrants: number;
        promotionalGrants: number;
        correctiveGrants: number;
        revocations: number;
    };
    daily: AdminPremiumPoint[];
}

export interface AdminSystemHealthResponse {
    generatedAt: Date;
    runtime: {
        environment: string;
        uptimeSeconds: number;
        jobsEnabled: boolean;
        redisEnabled: boolean;
        leaderboardProjectionEnabled: boolean;
        leaderboardRedisReadEnabled: boolean;
    };
    dependencies: {
        databaseReachable: boolean;
        emailEnabled: boolean;
    };
    analytics: {
        latestRollupDate: string | null;
        latestRollupUpdatedAt: Date | null;
        rollupLagDays: number | null;
    };
    queues: {
        leaderboardProjectionBacklog: number;
        pendingStepUpChallenges: number;
        pendingQuestionReports: number;
        recentEmailFailuresLast24Hours: number;
    };
    live: {
        activeWsConnections: number;
        wsOutboundQueueLength: number;
        totalWsConnections: number;
        totalWsConnectionsReplaced: number;
        totalWsDroppedOutboundEvents: number;
        totalHttpRequests: number;
    };
}

export interface AdminUser360Response {
    generatedAt: Date;
    institution: ResolvedInstitutionContext;
    user: {
        id: number;
        email: string;
        fullName: string;
        role: 'USER' | 'ADMIN' | 'SUPERADMIN';
        isVerified: boolean;
        isBanned: boolean;
        bannedAt: Date | null;
        bannedReason: string | null;
        aspiringCourse: string | null;
        targetScore: number | null;
        emailUnsubscribed: boolean;
        createdAt: Date;
        updatedAt: Date;
    };
    premium: {
        isPremium: boolean;
        deviceAccessMode: 'FREE' | 'PREMIUM';
        subscriptionEndDate: Date | null;
        coverage: PremiumCoverageState;
        subscription: {
            status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
            provider: string;
            planType: string;
            autoRenew: boolean;
            startDate: Date;
            endDate: Date;
            lastPaymentVerifiedAt: Date | null;
        } | null;
        activeEntitlements: Array<{
            id: string;
            kind: PremiumEntitlementKind;
            status: PremiumEntitlementStatus;
            startsAt: Date;
            endsAt: Date;
        }>;
        latestSuccessfulPayment: {
            reference: string;
            amountPaid: number;
            currency: string;
            provider: string;
            channel: string | null;
            paidAt: Date;
        } | null;
    };
    engagement: {
        totalSp: number;
        weeklySp: number;
        currentStreak: number;
        longestStreak: number;
        streakFreezesAvailable: number;
        realExamsCompleted: number;
        completedCollaborationExams: number;
        hasTakenFreeExam: boolean;
        aiExplanationsUsedToday: number;
        completedExams: number;
        abandonedExams: number;
        inProgressExams: number;
        bookmarkedQuestions: number;
        questionReportsSubmitted: number;
        hostedCollaborationSessions: number;
        joinedCollaborationSessions: number;
        lastExamStartedAt: Date | null;
        lastExamCompletedAt: Date | null;
        lastStudyActivityDate: Date | null;
    };
    security: {
        activeSessionsCount: number;
        verifiedDevicesCount: number;
        activeSessions: Array<{
            sessionId: string;
            deviceId: string;
            createdAt: Date;
            expiresAt: Date | null;
            tokenVersion: number;
            authPolicyVersion: number;
        }>;
        registeredDevices: Array<{
            deviceId: string;
            deviceName: string;
            isVerified: boolean;
            isActive: boolean;
            verifiedAt: Date | null;
            lastLoginAt: Date | null;
            registrationMethod: string | null;
        }>;
        recentAuditEvents: Array<{
            action: string;
            createdAt: Date;
            deviceId: string | null;
            ipAddress: string | null;
        }>;
        recentAdminActions: Array<{
            action: AdminAuditAction;
            actorId: number;
            actorRole: string;
            createdAt: Date;
            reason: string | null;
        }>;
    };
    recent: {
        exams: Array<{
            id: number;
            examType: string;
            status: string;
            score: number;
            percentage: number | null;
            isCollaboration: boolean;
            startedAt: Date;
            completedAt: Date | null;
        }>;
        bookmarks: Array<{
            id: number;
            questionId: number;
            subject: string;
            createdAt: Date;
            expiresAt: Date | null;
        }>;
        collaborationSessions: Array<{
            sessionId: number;
            sessionCode: string;
            sessionType: string;
            status: string;
            role: 'HOST' | 'PARTICIPANT';
            createdAt: Date;
            startedAt: Date | null;
            endedAt: Date | null;
        }>;
    };
}

export interface AdminAuditLogQuery {
    actorId?: number;
    action?: AdminAuditAction;
    targetType?: TargetType;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
}

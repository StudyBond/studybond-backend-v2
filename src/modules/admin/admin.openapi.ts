import { z } from 'zod';
import { isoDateTimeSchema, paginationSchema } from '../../shared/openapi/responses';

const adminRoleSchema = z.enum(['USER', 'ADMIN', 'SUPERADMIN']);
const premiumEntitlementKindSchema = z.enum(['MANUAL', 'PROMOTIONAL', 'CORRECTIVE']);
const premiumEntitlementStatusSchema = z.enum(['ACTIVE', 'REVOKED', 'EXPIRED']);
const analyticsDataSourceSchema = z.enum(['LIVE', 'ROLLUP']);
const institutionContextSchema = z.object({
  id: z.number().int().positive(),
  code: z.string(),
  name: z.string(),
  slug: z.string(),
  studyModeEnabled: z.boolean().optional(),
  source: z.enum(['explicit', 'user_target', 'launch_default'])
}).passthrough();
const adminAuditActionSchema = z.string();
const adminAuditTargetTypeSchema = z.string();

const premiumCoverageStateSchema = z.object({
  isPremium: z.boolean(),
  effectiveEndDate: isoDateTimeSchema.nullable(),
  activeSourceTypes: z.array(z.string())
}).passthrough();

export const adminOverviewResponseSchema = z.object({
  generatedAt: isoDateTimeSchema,
  institution: institutionContextSchema.nullable(),
  users: z.object({
    total: z.number().int().nonnegative(),
    verified: z.number().int().nonnegative(),
    banned: z.number().int().nonnegative(),
    admins: z.number().int().nonnegative(),
    superadmins: z.number().int().nonnegative(),
    newLast7Days: z.number().int().nonnegative(),
    newLast30Days: z.number().int().nonnegative()
  }).passthrough(),
  premium: z.object({
    activeUsers: z.number().int().nonnegative(),
    activePaidSubscriptions: z.number().int().nonnegative(),
    activeAdminEntitlements: z.number().int().nonnegative(),
    expiringIn7Days: z.number().int().nonnegative(),
    expiringIn30Days: z.number().int().nonnegative()
  }).passthrough(),
  engagement: z.object({
    activeSessions: z.number().int().nonnegative(),
    usersWithActiveStreak: z.number().int().nonnegative(),
    examsInProgress: z.number().int().nonnegative(),
    examsStartedLast7Days: z.number().int().nonnegative(),
    examsCompletedLast7Days: z.number().int().nonnegative(),
    collaborationWaiting: z.number().int().nonnegative(),
    collaborationInProgress: z.number().int().nonnegative(),
    collaborationCreatedLast7Days: z.number().int().nonnegative()
  }).passthrough(),
  content: z.object({
    totalQuestions: z.number().int().nonnegative(),
    freeExamQuestions: z.number().int().nonnegative(),
    realUiQuestions: z.number().int().nonnegative(),
    practiceQuestions: z.number().int().nonnegative(),
    pendingReports: z.number().int().nonnegative()
  }).passthrough(),
  risk: z.object({
    leaderboardSignalsLast24Hours: z.number().int().nonnegative(),
    pendingStepUpChallenges: z.number().int().nonnegative(),
    adminActionsLast24Hours: z.number().int().nonnegative(),
    recentEmailFailuresLast24Hours: z.number().int().nonnegative()
  }).passthrough()
}).passthrough();

export const adminActivityPointSchema = z.object({
  date: z.string(),
  newUsers: z.number().int().nonnegative(),
  examStarts: z.number().int().nonnegative(),
  examCompletions: z.number().int().nonnegative(),
  collaborationSessions: z.number().int().nonnegative(),
  paidPremiumActivations: z.number().int().nonnegative(),
  manualPremiumGrants: z.number().int().nonnegative()
}).passthrough();

export const adminActivityResponseSchema = z.object({
  generatedAt: isoDateTimeSchema,
  institution: institutionContextSchema.nullable(),
  windowDays: z.number().int().positive(),
  dataSource: analyticsDataSourceSchema,
  summary: z.object({
    newUsers: z.number().int().nonnegative(),
    examStarts: z.number().int().nonnegative(),
    examCompletions: z.number().int().nonnegative(),
    collaborationSessions: z.number().int().nonnegative(),
    paidPremiumActivations: z.number().int().nonnegative(),
    manualPremiumGrants: z.number().int().nonnegative()
  }).passthrough(),
  daily: z.array(adminActivityPointSchema)
}).passthrough();

export const adminPremiumPointSchema = z.object({
  date: z.string(),
  successfulPayments: z.number().int().nonnegative(),
  revenueNaira: z.number().nonnegative(),
  manualGrants: z.number().int().nonnegative(),
  revocations: z.number().int().nonnegative()
}).passthrough();

export const adminPremiumInsightsResponseSchema = z.object({
  generatedAt: isoDateTimeSchema,
  windowDays: z.number().int().positive(),
  dataSource: analyticsDataSourceSchema,
  current: z.object({
    activePremiumUsers: z.number().int().nonnegative(),
    activePaidSubscriptions: z.number().int().nonnegative(),
    activeAdminEntitlements: z.number().int().nonnegative(),
    autoRenewEnabledSubscriptions: z.number().int().nonnegative(),
    expiringIn7Days: z.number().int().nonnegative(),
    expiringIn30Days: z.number().int().nonnegative()
  }).passthrough(),
  revenue: z.object({
    successfulPayments: z.number().int().nonnegative(),
    successfulRevenueNaira: z.number().nonnegative(),
    reusableAuthorizations: z.number().int().nonnegative()
  }).passthrough(),
  adminActions: z.object({
    manualGrants: z.number().int().nonnegative(),
    promotionalGrants: z.number().int().nonnegative(),
    correctiveGrants: z.number().int().nonnegative(),
    revocations: z.number().int().nonnegative()
  }).passthrough(),
  daily: z.array(adminPremiumPointSchema)
}).passthrough();

export const adminSystemHealthResponseSchema = z.object({
  generatedAt: isoDateTimeSchema,
  runtime: z.object({
    environment: z.string(),
    uptimeSeconds: z.number().int().nonnegative(),
    jobsEnabled: z.boolean(),
    redisEnabled: z.boolean(),
    leaderboardProjectionEnabled: z.boolean(),
    leaderboardRedisReadEnabled: z.boolean()
  }).passthrough(),
  dependencies: z.object({
    databaseReachable: z.boolean(),
    emailEnabled: z.boolean()
  }).passthrough(),
  analytics: z.object({
    latestRollupDate: z.string().nullable(),
    latestRollupUpdatedAt: isoDateTimeSchema.nullable(),
    rollupLagDays: z.number().int().nonnegative().nullable()
  }).passthrough(),
  queues: z.object({
    leaderboardProjectionBacklog: z.number().int().nonnegative(),
    pendingStepUpChallenges: z.number().int().nonnegative(),
    pendingQuestionReports: z.number().int().nonnegative(),
    recentEmailFailuresLast24Hours: z.number().int().nonnegative()
  }).passthrough(),
  live: z.object({
    activeWsConnections: z.number().int().nonnegative(),
    wsOutboundQueueLength: z.number().int().nonnegative(),
    totalWsConnections: z.number().int().nonnegative(),
    totalWsConnectionsReplaced: z.number().int().nonnegative(),
    totalWsDroppedOutboundEvents: z.number().int().nonnegative(),
    totalHttpRequests: z.number().int().nonnegative()
  }).passthrough()
}).passthrough();

export const adminUser360ResponseSchema = z.object({
  generatedAt: isoDateTimeSchema,
  institution: institutionContextSchema,
  user: z.object({
    id: z.number().int().positive(),
    email: z.string().email(),
    fullName: z.string(),
    role: adminRoleSchema,
    isVerified: z.boolean(),
    isBanned: z.boolean(),
    bannedAt: isoDateTimeSchema.nullable(),
    bannedReason: z.string().nullable(),
    aspiringCourse: z.string().nullable(),
    targetScore: z.number().int().nullable(),
    emailUnsubscribed: z.boolean(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema
  }).passthrough(),
  premium: z.object({
    isPremium: z.boolean(),
    deviceAccessMode: z.enum(['FREE', 'PREMIUM']),
    subscriptionEndDate: isoDateTimeSchema.nullable(),
    coverage: premiumCoverageStateSchema,
    subscription: z.object({
      status: z.enum(['ACTIVE', 'EXPIRED', 'CANCELLED']),
      provider: z.string(),
      planType: z.string(),
      autoRenew: z.boolean(),
      startDate: isoDateTimeSchema,
      endDate: isoDateTimeSchema,
      lastPaymentVerifiedAt: isoDateTimeSchema.nullable()
    }).passthrough().nullable(),
    activeEntitlements: z.array(z.object({
      id: z.string(),
      kind: premiumEntitlementKindSchema,
      status: premiumEntitlementStatusSchema,
      startsAt: isoDateTimeSchema,
      endsAt: isoDateTimeSchema
    }).passthrough()),
    latestSuccessfulPayment: z.object({
      reference: z.string(),
      amountPaid: z.number().nonnegative(),
      currency: z.string(),
      provider: z.string(),
      channel: z.string().nullable(),
      paidAt: isoDateTimeSchema
    }).passthrough().nullable()
  }).passthrough(),
  engagement: z.object({
    totalSp: z.number().int(),
    weeklySp: z.number().int(),
    currentStreak: z.number().int().nonnegative(),
    longestStreak: z.number().int().nonnegative(),
    streakFreezesAvailable: z.number().int().nonnegative(),
    realExamsCompleted: z.number().int().nonnegative(),
    completedCollaborationExams: z.number().int().nonnegative(),
    hasTakenFreeExam: z.boolean(),
    aiExplanationsUsedToday: z.number().int().nonnegative(),
    completedExams: z.number().int().nonnegative(),
    abandonedExams: z.number().int().nonnegative(),
    inProgressExams: z.number().int().nonnegative(),
    bookmarkedQuestions: z.number().int().nonnegative(),
    questionReportsSubmitted: z.number().int().nonnegative(),
    hostedCollaborationSessions: z.number().int().nonnegative(),
    joinedCollaborationSessions: z.number().int().nonnegative(),
    lastExamStartedAt: isoDateTimeSchema.nullable(),
    lastExamCompletedAt: isoDateTimeSchema.nullable(),
    lastStudyActivityDate: isoDateTimeSchema.nullable()
  }).passthrough(),
  security: z.object({
    activeSessionsCount: z.number().int().nonnegative(),
    verifiedDevicesCount: z.number().int().nonnegative(),
    activeSessions: z.array(z.object({
      sessionId: z.string(),
      deviceId: z.string(),
      createdAt: isoDateTimeSchema,
      expiresAt: isoDateTimeSchema.nullable(),
      tokenVersion: z.number().int().nonnegative(),
      authPolicyVersion: z.number().int().nonnegative()
    }).passthrough()),
    registeredDevices: z.array(z.object({
      deviceId: z.string(),
      deviceName: z.string(),
      isVerified: z.boolean(),
      isActive: z.boolean(),
      verifiedAt: isoDateTimeSchema.nullable(),
      lastLoginAt: isoDateTimeSchema.nullable(),
      registrationMethod: z.string().nullable()
    }).passthrough()),
    recentAuditEvents: z.array(z.object({
      action: z.string(),
      createdAt: isoDateTimeSchema,
      deviceId: z.string().nullable(),
      ipAddress: z.string().nullable()
    }).passthrough()),
    recentAdminActions: z.array(z.object({
      action: adminAuditActionSchema,
      actorId: z.number().int().positive(),
      actorRole: z.string(),
      createdAt: isoDateTimeSchema,
      reason: z.string().nullable()
    }).passthrough())
  }).passthrough(),
  recent: z.object({
    exams: z.array(z.object({
      id: z.number().int().positive(),
      examType: z.string(),
      status: z.string(),
      score: z.number().int().nonnegative(),
      percentage: z.number().nullable(),
      isCollaboration: z.boolean(),
      startedAt: isoDateTimeSchema,
      completedAt: isoDateTimeSchema.nullable()
    }).passthrough()),
    bookmarks: z.array(z.object({
      id: z.number().int().positive(),
      questionId: z.number().int().positive(),
      subject: z.string(),
      createdAt: isoDateTimeSchema,
      expiresAt: isoDateTimeSchema.nullable()
    }).passthrough()),
    collaborationSessions: z.array(z.object({
      sessionId: z.number().int().positive(),
      sessionCode: z.string(),
      sessionType: z.string(),
      status: z.string(),
      role: z.enum(['HOST', 'PARTICIPANT']),
      createdAt: isoDateTimeSchema,
      startedAt: isoDateTimeSchema.nullable(),
      endedAt: isoDateTimeSchema.nullable()
    }).passthrough())
  }).passthrough()
}).passthrough();

export const adminStepUpRequestResponseSchema = z.object({
  challengeId: z.string().uuid(),
  purpose: z.literal('SUPERADMIN_SENSITIVE_ACTION'),
  expiresAt: isoDateTimeSchema,
  deliveryMode: z.enum(['BREVO', 'RESEND', 'DEV_PREVIEW']),
  message: z.string()
}).passthrough();

export const adminStepUpVerifyResponseSchema = z.object({
  purpose: z.literal('SUPERADMIN_SENSITIVE_ACTION'),
  stepUpToken: z.string(),
  expiresAt: isoDateTimeSchema,
  message: z.string()
}).passthrough();

export const adminActionResultSchema = z.object({
  success: z.boolean(),
  message: z.string()
}).passthrough();

export const adminSystemSettingsResponseSchema = z.object({
  emailEnabled: z.boolean(),
  updatedAt: isoDateTimeSchema
}).passthrough();

export const adminUserListItemSchema = z.object({
  id: z.number().int().positive(),
  email: z.string().email(),
  fullName: z.string(),
  role: z.string(),
  isBanned: z.boolean(),
  isPremium: z.boolean(),
  createdAt: isoDateTimeSchema,
  deviceCount: z.number().int().nonnegative()
}).passthrough();

export const adminUserListResponseSchema = z.object({
  users: z.array(adminUserListItemSchema),
  pagination: paginationSchema
}).passthrough();

export const premiumUserListItemSchema = z.object({
  id: z.number().int().positive(),
  email: z.string().email(),
  fullName: z.string(),
  isPremium: z.boolean(),
  subscriptionEndDate: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema
}).passthrough();

export const premiumUserListResponseSchema = z.object({
  users: z.array(premiumUserListItemSchema),
  pagination: paginationSchema
}).passthrough();

export const premiumHistoryEntitlementSchema = z.object({
  id: z.string(),
  kind: premiumEntitlementKindSchema,
  status: premiumEntitlementStatusSchema,
  startsAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema,
  note: z.string(),
  createdAt: isoDateTimeSchema,
  revokedAt: isoDateTimeSchema.nullable(),
  grantedByAdmin: z.object({
    id: z.number().int().positive(),
    email: z.string().email(),
    fullName: z.string()
  }).passthrough(),
  revokedByAdmin: z.object({
    id: z.number().int().positive(),
    email: z.string().email(),
    fullName: z.string()
  }).passthrough().nullable()
}).passthrough();

export const premiumHistoryResponseSchema = z.object({
  user: z.object({
    id: z.number().int().positive(),
    email: z.string().email(),
    fullName: z.string(),
    isPremium: z.boolean(),
    subscriptionEndDate: isoDateTimeSchema.nullable()
  }).passthrough(),
  currentAccess: premiumCoverageStateSchema,
  subscription: z.object({
    status: z.enum(['ACTIVE', 'EXPIRED', 'CANCELLED']),
    provider: z.string(),
    planType: z.string(),
    autoRenew: z.boolean(),
    paymentReference: z.string().nullable(),
    startDate: isoDateTimeSchema,
    endDate: isoDateTimeSchema
  }).passthrough().nullable(),
  entitlements: z.array(premiumHistoryEntitlementSchema)
}).passthrough();

export const premiumGrantMutationResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  currentAccess: premiumCoverageStateSchema,
  entitlement: z.object({
    id: z.string(),
    kind: premiumEntitlementKindSchema,
    status: z.literal('ACTIVE'),
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema,
    note: z.string()
  }).passthrough()
}).passthrough();

export const premiumRevokeMutationResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  revokedCount: z.number().int().nonnegative(),
  currentAccess: premiumCoverageStateSchema
}).passthrough();

export const adminAuditActorSchema = z.object({
  id: z.number().int().positive(),
  email: z.string().email(),
  fullName: z.string()
}).passthrough();

export const adminAuditLogEntrySchema = z.object({
  id: z.number().int().positive(),
  actorId: z.number().int().positive(),
  actorRole: z.string(),
  action: adminAuditActionSchema,
  targetType: adminAuditTargetTypeSchema,
  targetId: z.string().nullable(),
  metadata: z.unknown().nullable().optional(),
  reason: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  actor: adminAuditActorSchema
}).passthrough();

export const adminAuditLogListResponseSchema = z.object({
  logs: z.array(adminAuditLogEntrySchema),
  meta: paginationSchema
}).passthrough();

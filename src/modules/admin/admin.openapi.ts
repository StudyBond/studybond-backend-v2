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
  source: z.enum(['explicit', 'user_target', 'launch_default'])
}).strict();
const adminAuditActionSchema = z.enum([
  'ROLE_PROMOTED',
  'ROLE_DEMOTED',
  'ROLE_PROMOTION_ATTEMPT_FAILED',
  'ROLE_DEMOTION_ATTEMPT_FAILED',
  'USER_BANNED',
  'USER_UNBANNED',
  'DEVICE_REMOVED',
  'PREMIUM_GRANTED',
  'PREMIUM_EXTENDED',
  'PREMIUM_REVOKED',
  'STEP_UP_CHALLENGE_REQUESTED',
  'STEP_UP_CHALLENGE_VERIFIED',
  'STEP_UP_CHALLENGE_FAILED',
  'QUESTION_DELETED',
  'QUESTION_EDITED',
  'EMAIL_SYSTEM_TOGGLED',
  'REPORT_REVIEWED',
  'REPORT_RESOLVED',
  'REPORT_HARD_DELETED',
  'UNAUTHORIZED_ACTION_ATTEMPT'
]);
const adminAuditTargetTypeSchema = z.enum(['USER', 'QUESTION', 'DEVICE', 'SYSTEM', 'REPORT']);

const premiumCoverageStateSchema = z.object({
  isPremium: z.boolean(),
  effectiveEndDate: isoDateTimeSchema.nullable(),
  activeSourceTypes: z.array(z.enum(['SUBSCRIPTION', 'ADMIN_ENTITLEMENT']))
}).strict();

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
  }).strict(),
  premium: z.object({
    activeUsers: z.number().int().nonnegative(),
    activePaidSubscriptions: z.number().int().nonnegative(),
    activeAdminEntitlements: z.number().int().nonnegative(),
    expiringIn7Days: z.number().int().nonnegative(),
    expiringIn30Days: z.number().int().nonnegative()
  }).strict(),
  engagement: z.object({
    activeSessions: z.number().int().nonnegative(),
    usersWithActiveStreak: z.number().int().nonnegative(),
    examsInProgress: z.number().int().nonnegative(),
    examsStartedLast7Days: z.number().int().nonnegative(),
    examsCompletedLast7Days: z.number().int().nonnegative(),
    collaborationWaiting: z.number().int().nonnegative(),
    collaborationInProgress: z.number().int().nonnegative(),
    collaborationCreatedLast7Days: z.number().int().nonnegative()
  }).strict(),
  content: z.object({
    totalQuestions: z.number().int().nonnegative(),
    freeExamQuestions: z.number().int().nonnegative(),
    realUiQuestions: z.number().int().nonnegative(),
    practiceQuestions: z.number().int().nonnegative(),
    pendingReports: z.number().int().nonnegative()
  }).strict(),
  risk: z.object({
    leaderboardSignalsLast24Hours: z.number().int().nonnegative(),
    pendingStepUpChallenges: z.number().int().nonnegative(),
    adminActionsLast24Hours: z.number().int().nonnegative(),
    recentEmailFailuresLast24Hours: z.number().int().nonnegative()
  }).strict()
}).strict();

export const adminActivityPointSchema = z.object({
  date: z.string(),
  newUsers: z.number().int().nonnegative(),
  examStarts: z.number().int().nonnegative(),
  examCompletions: z.number().int().nonnegative(),
  collaborationSessions: z.number().int().nonnegative(),
  paidPremiumActivations: z.number().int().nonnegative(),
  manualPremiumGrants: z.number().int().nonnegative()
}).strict();

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
  }).strict(),
  daily: z.array(adminActivityPointSchema)
}).strict();

export const adminPremiumPointSchema = z.object({
  date: z.string(),
  successfulPayments: z.number().int().nonnegative(),
  revenueNaira: z.number().nonnegative(),
  manualGrants: z.number().int().nonnegative(),
  revocations: z.number().int().nonnegative()
}).strict();

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
  }).strict(),
  revenue: z.object({
    successfulPayments: z.number().int().nonnegative(),
    successfulRevenueNaira: z.number().nonnegative(),
    reusableAuthorizations: z.number().int().nonnegative()
  }).strict(),
  adminActions: z.object({
    manualGrants: z.number().int().nonnegative(),
    promotionalGrants: z.number().int().nonnegative(),
    correctiveGrants: z.number().int().nonnegative(),
    revocations: z.number().int().nonnegative()
  }).strict(),
  daily: z.array(adminPremiumPointSchema)
}).strict();

export const adminSystemHealthResponseSchema = z.object({
  generatedAt: isoDateTimeSchema,
  runtime: z.object({
    environment: z.string(),
    uptimeSeconds: z.number().int().nonnegative(),
    jobsEnabled: z.boolean(),
    redisEnabled: z.boolean(),
    leaderboardProjectionEnabled: z.boolean(),
    leaderboardRedisReadEnabled: z.boolean()
  }).strict(),
  dependencies: z.object({
    databaseReachable: z.boolean(),
    emailEnabled: z.boolean()
  }).strict(),
  analytics: z.object({
    latestRollupDate: z.string().nullable(),
    latestRollupUpdatedAt: isoDateTimeSchema.nullable(),
    rollupLagDays: z.number().int().nonnegative().nullable()
  }).strict(),
  queues: z.object({
    leaderboardProjectionBacklog: z.number().int().nonnegative(),
    pendingStepUpChallenges: z.number().int().nonnegative(),
    pendingQuestionReports: z.number().int().nonnegative(),
    recentEmailFailuresLast24Hours: z.number().int().nonnegative()
  }).strict(),
  live: z.object({
    activeWsConnections: z.number().int().nonnegative(),
    wsOutboundQueueLength: z.number().int().nonnegative(),
    totalWsConnections: z.number().int().nonnegative(),
    totalWsConnectionsReplaced: z.number().int().nonnegative(),
    totalWsDroppedOutboundEvents: z.number().int().nonnegative(),
    totalHttpRequests: z.number().int().nonnegative()
  }).strict()
}).strict();

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
  }).strict(),
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
    }).strict().nullable(),
    activeEntitlements: z.array(z.object({
      id: z.string(),
      kind: premiumEntitlementKindSchema,
      status: premiumEntitlementStatusSchema,
      startsAt: isoDateTimeSchema,
      endsAt: isoDateTimeSchema
    }).strict()),
    latestSuccessfulPayment: z.object({
      reference: z.string(),
      amountPaid: z.number().nonnegative(),
      currency: z.string(),
      provider: z.string(),
      channel: z.string().nullable(),
      paidAt: isoDateTimeSchema
    }).strict().nullable()
  }).strict(),
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
  }).strict(),
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
    }).strict()),
    registeredDevices: z.array(z.object({
      deviceId: z.string(),
      deviceName: z.string(),
      isVerified: z.boolean(),
      isActive: z.boolean(),
      verifiedAt: isoDateTimeSchema.nullable(),
      lastLoginAt: isoDateTimeSchema.nullable(),
      registrationMethod: z.string().nullable()
    }).strict()),
    recentAuditEvents: z.array(z.object({
      action: z.string(),
      createdAt: isoDateTimeSchema,
      deviceId: z.string().nullable(),
      ipAddress: z.string().nullable()
    }).strict()),
    recentAdminActions: z.array(z.object({
      action: adminAuditActionSchema,
      actorId: z.number().int().positive(),
      actorRole: z.string(),
      createdAt: isoDateTimeSchema,
      reason: z.string().nullable()
    }).strict())
  }).strict(),
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
    }).strict()),
    bookmarks: z.array(z.object({
      id: z.number().int().positive(),
      questionId: z.number().int().positive(),
      subject: z.string(),
      createdAt: isoDateTimeSchema,
      expiresAt: isoDateTimeSchema.nullable()
    }).strict()),
    collaborationSessions: z.array(z.object({
      sessionId: z.number().int().positive(),
      sessionCode: z.string(),
      sessionType: z.string(),
      status: z.string(),
      role: z.enum(['HOST', 'PARTICIPANT']),
      createdAt: isoDateTimeSchema,
      startedAt: isoDateTimeSchema.nullable(),
      endedAt: isoDateTimeSchema.nullable()
    }).strict())
  }).strict()
}).strict();

export const adminStepUpRequestResponseSchema = z.object({
  challengeId: z.string().uuid(),
  purpose: z.literal('SUPERADMIN_SENSITIVE_ACTION'),
  expiresAt: isoDateTimeSchema,
  deliveryMode: z.enum(['BREVO', 'RESEND', 'DEV_PREVIEW']),
  message: z.string()
}).strict();

export const adminStepUpVerifyResponseSchema = z.object({
  purpose: z.literal('SUPERADMIN_SENSITIVE_ACTION'),
  stepUpToken: z.string(),
  expiresAt: isoDateTimeSchema,
  message: z.string()
}).strict();

export const adminActionResultSchema = z.object({
  success: z.boolean(),
  message: z.string()
}).strict();

export const adminSystemSettingsResponseSchema = z.object({
  emailEnabled: z.boolean(),
  updatedAt: isoDateTimeSchema
}).strict();

export const adminUserListItemSchema = z.object({
  id: z.number().int().positive(),
  email: z.string().email(),
  fullName: z.string(),
  role: z.string(),
  isBanned: z.boolean(),
  isPremium: z.boolean(),
  createdAt: isoDateTimeSchema,
  deviceCount: z.number().int().nonnegative()
}).strict();

export const adminUserListResponseSchema = z.object({
  users: z.array(adminUserListItemSchema),
  pagination: paginationSchema
}).strict();

export const premiumUserListItemSchema = z.object({
  id: z.number().int().positive(),
  email: z.string().email(),
  fullName: z.string(),
  isPremium: z.boolean(),
  subscriptionEndDate: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema
}).strict();

export const premiumUserListResponseSchema = z.object({
  users: z.array(premiumUserListItemSchema),
  pagination: paginationSchema
}).strict();

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
  }).strict(),
  revokedByAdmin: z.object({
    id: z.number().int().positive(),
    email: z.string().email(),
    fullName: z.string()
  }).strict().nullable()
}).strict();

export const premiumHistoryResponseSchema = z.object({
  user: z.object({
    id: z.number().int().positive(),
    email: z.string().email(),
    fullName: z.string(),
    isPremium: z.boolean(),
    subscriptionEndDate: isoDateTimeSchema.nullable()
  }).strict(),
  currentAccess: premiumCoverageStateSchema,
  subscription: z.object({
    status: z.enum(['ACTIVE', 'EXPIRED', 'CANCELLED']),
    provider: z.string(),
    planType: z.string(),
    autoRenew: z.boolean(),
    paymentReference: z.string().nullable(),
    startDate: isoDateTimeSchema,
    endDate: isoDateTimeSchema
  }).strict().nullable(),
  entitlements: z.array(premiumHistoryEntitlementSchema)
}).strict();

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
  }).strict()
}).strict();

export const premiumRevokeMutationResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  revokedCount: z.number().int().nonnegative(),
  currentAccess: premiumCoverageStateSchema
}).strict();

export const adminAuditActorSchema = z.object({
  id: z.number().int().positive(),
  email: z.string().email(),
  fullName: z.string()
}).strict();

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
}).strict();

export const adminAuditLogListResponseSchema = z.object({
  logs: z.array(adminAuditLogEntrySchema),
  meta: paginationSchema
}).strict();

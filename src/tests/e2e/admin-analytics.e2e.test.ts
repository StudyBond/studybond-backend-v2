import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import prisma from '../../config/database';
import { adminAnalyticsService } from '../../modules/admin/analytics';
import { addLagosDateDays, getLagosDateKey, getLagosDateValue } from '../../shared/streaks/domain';
import { hashPassword } from '../../shared/utils/hash';
import { generateTokens } from '../../shared/utils/jwt';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeE2E = runIntegration ? describe : describe.skip;

interface AdminAnalyticsFixture {
  userIds: number[];
  questionIds: number[];
  sessionCodes: string[];
  institutionIds: number[];
}

type RollupSeedValues = {
  newUsers: number;
  examsStarted: number;
  examsCompleted: number;
  collaborationSessions: number;
  successfulPayments: number;
  successfulRevenueNaira: number;
  manualPremiumGrants: number;
  promotionalPremiumGrants: number;
  correctivePremiumGrants: number;
  premiumRevocations: number;
};

type RollupSnapshot = {
  date: Date;
  existed: boolean;
  values: RollupSeedValues;
};

function uniqueToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function buildRollupWindow(days: number, now = new Date()): Date[] {
  const today = getLagosDateValue(now);
  const start = addLagosDateDays(today, -(days - 1));
  return Array.from({ length: days }, (_, index) => addLagosDateDays(start, index));
}

function emptyRollupSeed(): RollupSeedValues {
  return {
    newUsers: 0,
    examsStarted: 0,
    examsCompleted: 0,
    collaborationSessions: 0,
    successfulPayments: 0,
    successfulRevenueNaira: 0,
    manualPremiumGrants: 0,
    promotionalPremiumGrants: 0,
    correctivePremiumGrants: 0,
    premiumRevocations: 0
  };
}

async function seedRollupWindow(
  days: number,
  todayValues: Partial<RollupSeedValues>,
  now = new Date()
): Promise<RollupSnapshot[]> {
  const dates = buildRollupWindow(days, now);
  const existingRows = await prisma.adminAnalyticsDailyRollup.findMany({
    where: {
      date: {
        in: dates
      }
    },
    select: {
      date: true,
      newUsers: true,
      examsStarted: true,
      examsCompleted: true,
      collaborationSessions: true,
      successfulPayments: true,
      successfulRevenueNaira: true,
      manualPremiumGrants: true,
      promotionalPremiumGrants: true,
      correctivePremiumGrants: true,
      premiumRevocations: true
    }
  });

  const existingByKey = new Map(
    existingRows.map((row) => [
      getLagosDateKey(row.date),
      row
    ])
  );

  const snapshots: RollupSnapshot[] = dates.map((date) => {
    const existing = existingByKey.get(getLagosDateKey(date));
    return {
      date,
      existed: Boolean(existing),
      values: existing
        ? {
            newUsers: existing.newUsers,
            examsStarted: existing.examsStarted,
            examsCompleted: existing.examsCompleted,
            collaborationSessions: existing.collaborationSessions,
            successfulPayments: existing.successfulPayments,
            successfulRevenueNaira: Number(existing.successfulRevenueNaira),
            manualPremiumGrants: existing.manualPremiumGrants,
            promotionalPremiumGrants: existing.promotionalPremiumGrants,
            correctivePremiumGrants: existing.correctivePremiumGrants,
            premiumRevocations: existing.premiumRevocations
          }
        : emptyRollupSeed()
    };
  });

  const todayKey = getLagosDateKey(getLagosDateValue(now));

  for (const date of dates) {
    const key = getLagosDateKey(date);
    const existing = existingByKey.get(key);
    const values = key === todayKey
      ? { ...emptyRollupSeed(), ...todayValues }
      : existing
        ? {
            newUsers: existing.newUsers,
            examsStarted: existing.examsStarted,
            examsCompleted: existing.examsCompleted,
            collaborationSessions: existing.collaborationSessions,
            successfulPayments: existing.successfulPayments,
            successfulRevenueNaira: Number(existing.successfulRevenueNaira),
            manualPremiumGrants: existing.manualPremiumGrants,
            promotionalPremiumGrants: existing.promotionalPremiumGrants,
            correctivePremiumGrants: existing.correctivePremiumGrants,
            premiumRevocations: existing.premiumRevocations
          }
        : emptyRollupSeed();

    await prisma.adminAnalyticsDailyRollup.upsert({
      where: { date },
      update: {
        ...values,
        generatedAt: now
      },
      create: {
        date,
        ...values,
        generatedAt: now
      }
    });
  }

  return snapshots;
}

async function restoreRollupWindow(snapshots: RollupSnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    if (snapshot.existed) {
      await prisma.adminAnalyticsDailyRollup.upsert({
        where: { date: snapshot.date },
        update: {
          ...snapshot.values,
          generatedAt: new Date()
        },
        create: {
          date: snapshot.date,
          ...snapshot.values,
          generatedAt: new Date()
        }
      });
      continue;
    }

    await prisma.adminAnalyticsDailyRollup.deleteMany({
      where: { date: snapshot.date }
    });
  }
}

async function createUserFixture(
  fixture: AdminAnalyticsFixture,
  input: Partial<{
    email: string;
    password: string;
    role: 'USER' | 'ADMIN' | 'SUPERADMIN';
    isPremium: boolean;
    deviceAccessMode: 'FREE' | 'PREMIUM';
    authPolicyVersion: number;
    currentStreak: number;
    subscriptionEndDate: Date | null;
    targetInstitutionId: number | null;
  }> = {}
) {
  const password = input.password || 'SecurePass123!';
  const user = await prisma.user.create({
    data: {
      email: input.email || `${uniqueToken('admin-analytics-user')}@example.com`,
      passwordHash: await hashPassword(password),
      fullName: uniqueToken('Admin Analytics Fixture'),
      isVerified: true,
      role: input.role ?? 'USER',
      isPremium: input.isPremium ?? false,
      deviceAccessMode: input.deviceAccessMode ?? (input.isPremium ? 'PREMIUM' : 'FREE'),
      authPolicyVersion: input.authPolicyVersion ?? 0,
      currentStreak: input.currentStreak ?? 0,
      subscriptionEndDate: input.subscriptionEndDate ?? null,
      targetInstitutionId: input.targetInstitutionId ?? null
    }
  });

  fixture.userIds.push(user.id);
  return { user, password };
}

async function createAuthContext(
  user: { id: number; email: string; role: string },
  input: Partial<{
    deviceId: string;
    authPolicyVersion: number;
    tokenVersion: number;
  }> = {}
): Promise<{ authHeader: string; sessionId: string; deviceId: string }> {
  const deviceId = input.deviceId || uniqueToken('admin-analytics-device');
  const session = await prisma.userSession.create({
    data: {
      userId: user.id,
      deviceId,
      isActive: true,
      authPolicyVersion: input.authPolicyVersion ?? 0,
      tokenVersion: input.tokenVersion ?? 0,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    }
  });

  const tokens = generateTokens(
    {
      id: user.id,
      email: user.email,
      role: user.role
    },
    session.id,
    deviceId,
    session.tokenVersion
  );

  return {
    authHeader: `Bearer ${tokens.accessToken}`,
    sessionId: session.id,
    deviceId
  };
}

async function createInstitution(fixture: AdminAnalyticsFixture, label: string) {
  const code = `${label}${randomUUID().replace(/-/g, '').slice(0, 5)}`.toUpperCase();
  const institution = await prisma.institution.create({
    data: {
      code,
      name: `${label} ${code}`,
      slug: `${label.toLowerCase()}-${code.toLowerCase()}`
    }
  });

  await prisma.institutionExamConfig.create({
    data: {
      institutionId: institution.id,
      trackCode: 'POST_UTME',
      trackName: 'Post-UTME',
      questionsPerSubject: 25,
      fullExamQuestions: 100,
      maxSubjects: 4,
      singleSubjectDurationSeconds: 22 * 60,
      twoSubjectDurationSeconds: 44 * 60,
      threeSubjectDurationSeconds: 66 * 60,
      fullExamDurationSeconds: 90 * 60,
      collaborationDurationSeconds: 90 * 60,
      freeRealExamCount: 1,
      freeFullRealTotalAttempts: 3,
      premiumDailyRealExamLimit: 5,
      collaborationGateRealExams: 2,
      defaultFullExamSource: 'REAL_PAST_QUESTION',
      defaultPartialExamSource: 'MIXED',
      defaultCollabSource: 'REAL_PAST_QUESTION',
      allowMixedPartialExams: true,
      allowMixedFullExams: false,
      allowPracticeCollaboration: true,
      allowMixedCollaboration: true
    }
  });

  fixture.institutionIds.push(institution.id);
  return institution;
}

async function createQuestion(
  fixture: AdminAnalyticsFixture,
  input: {
    institutionId?: number;
    subject: string;
    questionPool: 'FREE_EXAM' | 'REAL_BANK' | 'PRACTICE';
    questionType: string;
  }
) {
  const question = await prisma.question.create({
    data: {
      institutionId: input.institutionId,
      questionText: uniqueToken(`Question ${input.subject}`),
      optionA: 'A',
      optionB: 'B',
      optionC: 'C',
      optionD: 'D',
      correctAnswer: 'A',
      subject: input.subject,
      topic: 'Analytics',
      difficultyLevel: 'MEDIUM',
      questionType: input.questionType,
      questionPool: input.questionPool
    }
  });

  fixture.questionIds.push(question.id);
  return question;
}

async function seedInstitutionScopedAnalyticsData(
  fixture: AdminAnalyticsFixture,
  institutionId: number,
  superadmin: { id: number }
) {
  const now = new Date();
  const { user: learner } = await createUserFixture(fixture, {
    targetInstitutionId: institutionId
  });

  await prisma.userInstitutionStats.upsert({
    where: {
      userId_institutionId: {
        userId: learner.id,
        institutionId
      }
    },
    create: {
      userId: learner.id,
      institutionId,
      weeklySp: 120,
      totalSp: 320,
      realExamsCompleted: 2
    },
    update: {
      weeklySp: 120,
      totalSp: 320,
      realExamsCompleted: 2
    }
  });

  const freeQuestion = await createQuestion(fixture, {
    institutionId,
    subject: 'BIOLOGY',
    questionPool: 'FREE_EXAM',
    questionType: 'real_past_question'
  });
  await createQuestion(fixture, {
    institutionId,
    subject: 'CHEMISTRY',
    questionPool: 'REAL_BANK',
    questionType: 'real_past_question'
  });
  await createQuestion(fixture, {
    institutionId,
    subject: 'PHYSICS',
    questionPool: 'PRACTICE',
    questionType: 'practice'
  });

  await prisma.questionReport.create({
    data: {
      userId: learner.id,
      questionId: freeQuestion.id,
      issueType: 'WRONG_ANSWER',
      status: 'PENDING',
      description: 'Institution-scoped analytics report'
    }
  });

  await prisma.leaderboardIntegritySignal.create({
    data: {
      userId: learner.id,
      institutionId,
      signalType: 'HIGH_SP_VELOCITY_5M',
      severity: 'HIGH',
      context: { source: 'admin-analytics-institution-test' }
    }
  });

  await prisma.exam.createMany({
    data: [
      {
        userId: learner.id,
        institutionId,
        examType: 'REAL_PAST_QUESTION',
        nameScopeKey: uniqueToken('analytics-inst-complete'),
        sessionNumber: 1,
        subjectsIncluded: ['BIOLOGY'],
        totalQuestions: 25,
        score: 20,
        percentage: 80,
        spEarned: 35,
        status: 'COMPLETED',
        startedAt: now,
        completedAt: now
      },
      {
        userId: learner.id,
        institutionId,
        examType: 'PRACTICE',
        nameScopeKey: uniqueToken('analytics-inst-progress'),
        sessionNumber: 1,
        subjectsIncluded: ['CHEMISTRY'],
        totalQuestions: 25,
        score: 0,
        spEarned: 0,
        status: 'IN_PROGRESS',
        startedAt: now
      }
    ]
  });

  await prisma.collaborationSession.createMany({
    data: [
      {
        sessionType: 'ONE_V_ONE_DUEL',
        hostUserId: learner.id,
        institutionId,
        sessionCode: uniqueToken('analytics-inst-waiting'),
        nameScopeKey: uniqueToken('analytics-inst-waiting-scope'),
        sessionNumber: 1,
        subjectsIncluded: ['BIOLOGY'],
        totalQuestions: 25,
        questionSource: 'REAL_PAST_QUESTION',
        status: 'WAITING',
        createdAt: now
      },
      {
        sessionType: 'ONE_V_ONE_DUEL',
        hostUserId: learner.id,
        institutionId,
        sessionCode: uniqueToken('analytics-inst-active'),
        nameScopeKey: uniqueToken('analytics-inst-active-scope'),
        sessionNumber: 1,
        subjectsIncluded: ['CHEMISTRY'],
        totalQuestions: 25,
        questionSource: 'PRACTICE',
        status: 'IN_PROGRESS',
        createdAt: now,
        startedAt: now
      }
    ]
  });

  await prisma.adminAuditLog.create({
    data: {
      actorId: superadmin.id,
      actorRole: 'SUPERADMIN',
      action: 'PREMIUM_GRANTED',
      targetType: 'USER',
      targetId: String(learner.id),
      reason: 'Institution analytics fixture'
    }
  });

  return learner;
}

async function seedAnalyticsData(
  fixture: AdminAnalyticsFixture,
  superadmin: { id: number },
  stepUpSessionId: string
) {
  const now = new Date();
  const inFiveDays = new Date(now.getTime() + (5 * 24 * 60 * 60 * 1000));
  const inTwentyDays = new Date(now.getTime() + (20 * 24 * 60 * 60 * 1000));

  const { user: regularUser } = await createUserFixture(fixture, {
    currentStreak: 4
  });
  const { user: paidPremiumUser } = await createUserFixture(fixture, {
    isPremium: true,
    deviceAccessMode: 'PREMIUM',
    authPolicyVersion: 1,
    subscriptionEndDate: inTwentyDays
  });
  const { user: manualPremiumUser } = await createUserFixture(fixture, {
    isPremium: true,
    deviceAccessMode: 'PREMIUM',
    authPolicyVersion: 1,
    subscriptionEndDate: inFiveDays
  });
  const { user: promotionalPremiumUser } = await createUserFixture(fixture, {
    isPremium: true,
    deviceAccessMode: 'PREMIUM',
    authPolicyVersion: 1,
    subscriptionEndDate: inTwentyDays
  });
  const { user: correctiveUser } = await createUserFixture(fixture);

  const freeQuestion = await createQuestion(fixture, {
    subject: 'BIOLOGY',
    questionPool: 'FREE_EXAM',
    questionType: 'real_past_question'
  });
  await createQuestion(fixture, {
    subject: 'CHEMISTRY',
    questionPool: 'REAL_BANK',
    questionType: 'real_past_question'
  });
  await createQuestion(fixture, {
    subject: 'PHYSICS',
    questionPool: 'PRACTICE',
    questionType: 'practice'
  });

  await prisma.questionReport.create({
    data: {
      userId: regularUser.id,
      questionId: freeQuestion.id,
      issueType: 'WRONG_ANSWER',
      status: 'PENDING',
      description: 'Analytics pending report fixture.'
    }
  });

  await prisma.leaderboardIntegritySignal.create({
    data: {
      userId: regularUser.id,
      signalType: 'HIGH_SP_VELOCITY_5M',
      severity: 'HIGH',
      context: { source: 'admin-analytics-test' }
    }
  });

  await prisma.leaderboardProjectionEvent.create({
    data: {
      userId: regularUser.id,
      weeklySp: 120,
      totalSp: 320,
      source: 'admin-analytics-test'
    }
  });

  await prisma.emailLog.create({
    data: {
      userId: regularUser.id,
      emailType: 'PASSWORD_RESET_OTP',
      provider: 'BREVO',
      recipientEmail: `${uniqueToken('admin-analytics-email')}@example.com`,
      subject: 'Synthetic failure',
      status: 'failed',
      errorMessage: 'Synthetic delivery failure for analytics test'
    }
  });

  await prisma.adminAuditLog.create({
    data: {
      actorId: superadmin.id,
      actorRole: 'SUPERADMIN',
      action: 'PREMIUM_GRANTED',
      targetType: 'USER',
      targetId: String(manualPremiumUser.id),
      reason: 'Analytics fixture'
    }
  });

  await prisma.adminStepUpChallenge.create({
    data: {
      actorId: superadmin.id,
      sessionId: stepUpSessionId,
      purpose: 'SUPERADMIN_SENSITIVE_ACTION',
      otpHash: 'analytics-hash',
      otpExpiresAt: new Date(now.getTime() + (15 * 60 * 1000))
    }
  });

  await prisma.subscription.create({
    data: {
      userId: paidPremiumUser.id,
      provider: 'PAYSTACK',
      planType: 'UI_PREMIUM_5_MONTH',
      amountPaid: 5000,
      paymentReference: uniqueToken('analytics-payment-ref'),
      status: 'ACTIVE',
      startDate: now,
      endDate: inTwentyDays,
      autoRenew: true,
      authorizationReusable: true
    }
  });

  const subscription = await prisma.subscription.findUniqueOrThrow({
    where: { userId: paidPremiumUser.id }
  });

  await prisma.subscriptionPayment.create({
    data: {
      userId: paidPremiumUser.id,
      subscriptionId: subscription.id,
      provider: 'PAYSTACK',
      reference: uniqueToken('analytics-payment'),
      status: 'SUCCESS',
      amountPaid: 5000,
      currency: 'NGN',
      paidAt: now
    }
  });

  await prisma.premiumEntitlement.create({
    data: {
      userId: manualPremiumUser.id,
      grantedByAdminId: superadmin.id,
      kind: 'MANUAL',
      status: 'ACTIVE',
      startsAt: now,
      endsAt: inFiveDays,
      note: 'Manual analytics grant'
    }
  });

  await prisma.premiumEntitlement.create({
    data: {
      userId: promotionalPremiumUser.id,
      grantedByAdminId: superadmin.id,
      kind: 'PROMOTIONAL',
      status: 'ACTIVE',
      startsAt: now,
      endsAt: inTwentyDays,
      note: 'Promotional analytics grant'
    }
  });

  await prisma.premiumEntitlement.create({
    data: {
      userId: correctiveUser.id,
      grantedByAdminId: superadmin.id,
      revokedByAdminId: superadmin.id,
      kind: 'CORRECTIVE',
      status: 'REVOKED',
      startsAt: now,
      endsAt: inTwentyDays,
      note: 'Corrective analytics grant',
      revokedAt: now
    }
  });

  await prisma.exam.create({
    data: {
      userId: regularUser.id,
      examType: 'PRACTICE',
      nameScopeKey: uniqueToken('analytics-exam-scope-progress'),
      sessionNumber: 1,
      subjectsIncluded: ['BIOLOGY'],
      totalQuestions: 25,
      score: 0,
      spEarned: 0,
      status: 'IN_PROGRESS',
      startedAt: now
    }
  });

  await prisma.exam.create({
    data: {
      userId: paidPremiumUser.id,
      examType: 'REAL_PAST_QUESTION',
      nameScopeKey: uniqueToken('analytics-exam-scope-complete'),
      sessionNumber: 1,
      subjectsIncluded: ['BIOLOGY', 'CHEMISTRY', 'PHYSICS', 'ENGLISH'],
      totalQuestions: 100,
      score: 78,
      percentage: 78,
      spEarned: 120,
      status: 'COMPLETED',
      startedAt: now,
      completedAt: now
    }
  });

  const waitingSessionCode = uniqueToken('analytics-waiting');
  const activeSessionCode = uniqueToken('analytics-active');
  fixture.sessionCodes.push(waitingSessionCode, activeSessionCode);

  await prisma.collaborationSession.create({
    data: {
      sessionType: 'ONE_V_ONE_DUEL',
      hostUserId: regularUser.id,
      sessionCode: waitingSessionCode,
      nameScopeKey: uniqueToken('analytics-collab-scope-waiting'),
      sessionNumber: 1,
      subjectsIncluded: ['BIOLOGY'],
      totalQuestions: 25,
      questionSource: 'REAL_PAST_QUESTION',
      status: 'WAITING'
    }
  });

  await prisma.collaborationSession.create({
    data: {
      sessionType: 'ONE_V_ONE_DUEL',
      hostUserId: paidPremiumUser.id,
      sessionCode: activeSessionCode,
      nameScopeKey: uniqueToken('analytics-collab-scope-progress'),
      sessionNumber: 1,
      subjectsIncluded: ['CHEMISTRY'],
      totalQuestions: 25,
      questionSource: 'MIXED',
      status: 'IN_PROGRESS',
      startedAt: now
    }
  });

  return {
    expectedMinimums: {
      activePremiumUsers: 3,
      activePaidSubscriptions: 1,
      activeAdminEntitlements: 2,
      expiringIn7Days: 1,
      expiringIn30Days: 3,
      examsInProgress: 1,
      examsStartedLast7Days: 2,
      examsCompletedLast7Days: 1,
      collaborationWaiting: 1,
      collaborationInProgress: 1,
      collaborationCreatedLast7Days: 2,
      freeExamQuestions: 1,
      realUiQuestions: 1,
      practiceQuestions: 1,
      pendingReports: 1,
      leaderboardSignalsLast24Hours: 1,
      pendingStepUpChallenges: 1,
      adminActionsLast24Hours: 1,
      recentEmailFailuresLast24Hours: 1,
      leaderboardProjectionBacklog: 1,
      successfulPayments: 1,
      successfulRevenueNaira: 5000,
      manualGrants: 1,
      promotionalGrants: 1,
      correctiveGrants: 1,
      revocations: 1
    }
  };
}

async function cleanupFixture(fixture: AdminAnalyticsFixture): Promise<void> {
  if (fixture.userIds.length === 0 && fixture.questionIds.length === 0) return;

  await prisma.questionReport.deleteMany({
    where: {
      OR: [
        { userId: { in: fixture.userIds } },
        { questionId: { in: fixture.questionIds } }
      ]
    }
  });

  await prisma.sessionParticipant.deleteMany({
    where: {
      userId: { in: fixture.userIds }
    }
  });

  await prisma.examAnswer.deleteMany({
    where: {
      exam: {
        userId: { in: fixture.userIds }
      }
    }
  });

  await prisma.bookmarkedQuestion.deleteMany({
    where: {
      OR: [
        { userId: { in: fixture.userIds } },
        { questionId: { in: fixture.questionIds } }
      ]
    }
  });

  await prisma.exam.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.collaborationSession.deleteMany({
    where: {
      hostUserId: { in: fixture.userIds }
    }
  });

  await prisma.subscriptionPayment.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.subscription.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.premiumEntitlement.deleteMany({
    where: {
      OR: [
        { userId: { in: fixture.userIds } },
        { grantedByAdminId: { in: fixture.userIds } },
        { revokedByAdminId: { in: fixture.userIds } }
      ]
    }
  });

  await prisma.leaderboardProjectionEvent.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.leaderboardIntegritySignal.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.emailLog.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.adminStepUpChallenge.deleteMany({
    where: { actorId: { in: fixture.userIds } }
  });

  await prisma.idempotencyRecord.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.adminAuditLog.deleteMany({
    where: { actorId: { in: fixture.userIds } }
  });

  await prisma.auditLog.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.userSession.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.userDevice.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  if (fixture.questionIds.length > 0) {
    await prisma.question.deleteMany({
      where: { id: { in: fixture.questionIds } }
    });
  }

  if (fixture.userIds.length > 0) {
    await prisma.user.deleteMany({
      where: { id: { in: fixture.userIds } }
    });
  }

  if (fixture.institutionIds.length > 0) {
    await prisma.institution.deleteMany({
      where: { id: { in: fixture.institutionIds } }
    });
  }
}

describeE2E('Admin analytics (HTTP e2e)', () => {
  it('lets admins read overview, activity, and system-health with meaningful operational counts', async () => {
    const fixture: AdminAnalyticsFixture = { userIds: [], questionIds: [], sessionCodes: [], institutionIds: [] };
    const app = await buildApp();
    let rollupSnapshot: RollupSnapshot[] = [];

    try {
      const { user: admin } = await createUserFixture(fixture, {
        role: 'ADMIN'
      });
      const { user: superadmin } = await createUserFixture(fixture, {
        role: 'SUPERADMIN'
      });

      const adminAuth = await createAuthContext(admin);
      const superadminAuth = await createAuthContext(superadmin);
      const seeded = await seedAnalyticsData(fixture, superadmin, superadminAuth.sessionId);
      rollupSnapshot = await seedRollupWindow(7, {
        newUsers: fixture.userIds.length,
        examsStarted: seeded.expectedMinimums.examsStartedLast7Days,
        examsCompleted: seeded.expectedMinimums.examsCompletedLast7Days,
        collaborationSessions: seeded.expectedMinimums.collaborationCreatedLast7Days,
        successfulPayments: seeded.expectedMinimums.successfulPayments,
        successfulRevenueNaira: seeded.expectedMinimums.successfulRevenueNaira,
        manualPremiumGrants: seeded.expectedMinimums.manualGrants,
        promotionalPremiumGrants: seeded.expectedMinimums.promotionalGrants,
        correctivePremiumGrants: seeded.expectedMinimums.correctiveGrants,
        premiumRevocations: seeded.expectedMinimums.revocations
      });
      const todayKey = getLagosDateKey(new Date());

      const overviewResponse = await app.inject({
        method: 'GET',
        url: '/api/admin/analytics/overview',
        headers: {
          authorization: adminAuth.authHeader
        }
      });

      expect(overviewResponse.statusCode).toBe(200);
      const overview = overviewResponse.json();
      expect(overview.users.total).toBeGreaterThanOrEqual(fixture.userIds.length);
      expect(overview.premium.activeUsers).toBeGreaterThanOrEqual(seeded.expectedMinimums.activePremiumUsers);
      expect(overview.premium.activePaidSubscriptions).toBeGreaterThanOrEqual(seeded.expectedMinimums.activePaidSubscriptions);
      expect(overview.premium.activeAdminEntitlements).toBeGreaterThanOrEqual(seeded.expectedMinimums.activeAdminEntitlements);
      expect(overview.premium.expiringIn7Days).toBeGreaterThanOrEqual(seeded.expectedMinimums.expiringIn7Days);
      expect(overview.premium.expiringIn30Days).toBeGreaterThanOrEqual(seeded.expectedMinimums.expiringIn30Days);
      expect(overview.engagement.examsInProgress).toBeGreaterThanOrEqual(seeded.expectedMinimums.examsInProgress);
      expect(overview.engagement.examsStartedLast7Days).toBeGreaterThanOrEqual(seeded.expectedMinimums.examsStartedLast7Days);
      expect(overview.engagement.examsCompletedLast7Days).toBeGreaterThanOrEqual(seeded.expectedMinimums.examsCompletedLast7Days);
      expect(overview.engagement.collaborationWaiting).toBeGreaterThanOrEqual(seeded.expectedMinimums.collaborationWaiting);
      expect(overview.engagement.collaborationInProgress).toBeGreaterThanOrEqual(seeded.expectedMinimums.collaborationInProgress);
      expect(overview.engagement.collaborationCreatedLast7Days).toBeGreaterThanOrEqual(seeded.expectedMinimums.collaborationCreatedLast7Days);
      expect(overview.content.freeExamQuestions).toBeGreaterThanOrEqual(seeded.expectedMinimums.freeExamQuestions);
      expect(overview.content.realUiQuestions).toBeGreaterThanOrEqual(seeded.expectedMinimums.realUiQuestions);
      expect(overview.content.practiceQuestions).toBeGreaterThanOrEqual(seeded.expectedMinimums.practiceQuestions);
      expect(overview.content.pendingReports).toBeGreaterThanOrEqual(seeded.expectedMinimums.pendingReports);
      expect(overview.risk.leaderboardSignalsLast24Hours).toBeGreaterThanOrEqual(seeded.expectedMinimums.leaderboardSignalsLast24Hours);
      expect(overview.risk.pendingStepUpChallenges).toBeGreaterThanOrEqual(seeded.expectedMinimums.pendingStepUpChallenges);
      expect(overview.risk.adminActionsLast24Hours).toBeGreaterThanOrEqual(seeded.expectedMinimums.adminActionsLast24Hours);
      expect(overview.risk.recentEmailFailuresLast24Hours).toBeGreaterThanOrEqual(seeded.expectedMinimums.recentEmailFailuresLast24Hours);

      const activityResponse = await app.inject({
        method: 'GET',
        url: '/api/admin/analytics/activity?days=7',
        headers: {
          authorization: adminAuth.authHeader
        }
      });

      expect(activityResponse.statusCode).toBe(200);
      const activity = activityResponse.json();
      expect(activity.windowDays).toBe(7);
      expect(activity.dataSource).toBe('ROLLUP');
      expect(activity.daily).toHaveLength(7);
      const todayPoint = activity.daily.find((point: { date: string }) => point.date === todayKey);
      expect(todayPoint).toBeTruthy();
      expect(todayPoint.newUsers).toBeGreaterThanOrEqual(fixture.userIds.length);
      expect(todayPoint.examStarts).toBeGreaterThanOrEqual(seeded.expectedMinimums.examsStartedLast7Days);
      expect(todayPoint.examCompletions).toBeGreaterThanOrEqual(seeded.expectedMinimums.examsCompletedLast7Days);
      expect(todayPoint.collaborationSessions).toBeGreaterThanOrEqual(seeded.expectedMinimums.collaborationCreatedLast7Days);
      expect(todayPoint.paidPremiumActivations).toBeGreaterThanOrEqual(seeded.expectedMinimums.successfulPayments);
      expect(todayPoint.manualPremiumGrants).toBeGreaterThanOrEqual(seeded.expectedMinimums.manualGrants);

      const healthResponse = await app.inject({
        method: 'GET',
        url: '/api/admin/analytics/system-health',
        headers: {
          authorization: adminAuth.authHeader
        }
      });

      expect(healthResponse.statusCode).toBe(200);
      const health = healthResponse.json();
      expect(health.dependencies.databaseReachable).toBe(true);
      expect(typeof health.runtime.jobsEnabled).toBe('boolean');
      expect(typeof health.runtime.redisEnabled).toBe('boolean');
      expect(health.analytics.latestRollupDate).not.toBeNull();
      expect(health.analytics.rollupLagDays).not.toBeNull();
      expect(health.analytics.rollupLagDays).toBeLessThanOrEqual(1);
      expect(health.queues.leaderboardProjectionBacklog).toBeGreaterThanOrEqual(seeded.expectedMinimums.leaderboardProjectionBacklog);
      expect(health.queues.pendingStepUpChallenges).toBeGreaterThanOrEqual(seeded.expectedMinimums.pendingStepUpChallenges);
      expect(health.queues.pendingQuestionReports).toBeGreaterThanOrEqual(seeded.expectedMinimums.pendingReports);
      expect(health.queues.recentEmailFailuresLast24Hours).toBeGreaterThanOrEqual(seeded.expectedMinimums.recentEmailFailuresLast24Hours);
      expect(typeof health.live.totalHttpRequests).toBe('number');
    } finally {
      await cleanupFixture(fixture);
      await restoreRollupWindow(rollupSnapshot);
      await app.close();
    }
  }, 120000);

  it('blocks admins from premium analytics at both route and service boundaries', async () => {
    const fixture: AdminAnalyticsFixture = { userIds: [], questionIds: [], sessionCodes: [], institutionIds: [] };
    const app = await buildApp();

    try {
      const { user: admin } = await createUserFixture(fixture, {
        role: 'ADMIN'
      });
      const adminAuth = await createAuthContext(admin);

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/analytics/premium?days=30',
        headers: {
          authorization: adminAuth.authHeader
        }
      });

      expect(response.statusCode).toBe(403);

      await expect(
        adminAnalyticsService.getPremiumInsights(admin.id, admin.role, 30)
      ).rejects.toMatchObject({
        statusCode: 403
      });
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('lets superadmins read premium analytics with revenue and manual-action visibility', async () => {
    const fixture: AdminAnalyticsFixture = { userIds: [], questionIds: [], sessionCodes: [], institutionIds: [] };
    const app = await buildApp();
    let rollupSnapshot: RollupSnapshot[] = [];

    try {
      const { user: superadmin } = await createUserFixture(fixture, {
        role: 'SUPERADMIN'
      });
      const superadminAuth = await createAuthContext(superadmin);
      const seeded = await seedAnalyticsData(fixture, superadmin, superadminAuth.sessionId);
      rollupSnapshot = await seedRollupWindow(30, {
        successfulPayments: seeded.expectedMinimums.successfulPayments,
        successfulRevenueNaira: seeded.expectedMinimums.successfulRevenueNaira,
        manualPremiumGrants: seeded.expectedMinimums.manualGrants,
        promotionalPremiumGrants: seeded.expectedMinimums.promotionalGrants,
        correctivePremiumGrants: seeded.expectedMinimums.correctiveGrants,
        premiumRevocations: seeded.expectedMinimums.revocations
      });
      const todayKey = getLagosDateKey(new Date());

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/analytics/premium?days=30',
        headers: {
          authorization: superadminAuth.authHeader
        }
      });

      expect(response.statusCode).toBe(200);
      const premium = response.json();
      expect(premium.windowDays).toBe(30);
      expect(premium.dataSource).toBe('ROLLUP');
      expect(premium.current.activePremiumUsers).toBeGreaterThanOrEqual(seeded.expectedMinimums.activePremiumUsers);
      expect(premium.current.activePaidSubscriptions).toBeGreaterThanOrEqual(seeded.expectedMinimums.activePaidSubscriptions);
      expect(premium.current.activeAdminEntitlements).toBeGreaterThanOrEqual(seeded.expectedMinimums.activeAdminEntitlements);
      expect(premium.current.autoRenewEnabledSubscriptions).toBeGreaterThanOrEqual(1);
      expect(premium.current.expiringIn7Days).toBeGreaterThanOrEqual(seeded.expectedMinimums.expiringIn7Days);
      expect(premium.current.expiringIn30Days).toBeGreaterThanOrEqual(seeded.expectedMinimums.expiringIn30Days);
      expect(premium.revenue.successfulPayments).toBeGreaterThanOrEqual(seeded.expectedMinimums.successfulPayments);
      expect(premium.revenue.successfulRevenueNaira).toBeGreaterThanOrEqual(seeded.expectedMinimums.successfulRevenueNaira);
      expect(premium.revenue.reusableAuthorizations).toBeGreaterThanOrEqual(1);
      expect(premium.adminActions.manualGrants).toBeGreaterThanOrEqual(seeded.expectedMinimums.manualGrants);
      expect(premium.adminActions.promotionalGrants).toBeGreaterThanOrEqual(seeded.expectedMinimums.promotionalGrants);
      expect(premium.adminActions.correctiveGrants).toBeGreaterThanOrEqual(seeded.expectedMinimums.correctiveGrants);
      expect(premium.adminActions.revocations).toBeGreaterThanOrEqual(seeded.expectedMinimums.revocations);

      const todayPoint = premium.daily.find((point: { date: string }) => point.date === todayKey);
      expect(todayPoint).toBeTruthy();
      expect(todayPoint.successfulPayments).toBeGreaterThanOrEqual(seeded.expectedMinimums.successfulPayments);
      expect(todayPoint.revenueNaira).toBeGreaterThanOrEqual(seeded.expectedMinimums.successfulRevenueNaira);
      expect(todayPoint.manualGrants).toBeGreaterThanOrEqual(seeded.expectedMinimums.manualGrants);
      expect(todayPoint.revocations).toBeGreaterThanOrEqual(seeded.expectedMinimums.revocations);
    } finally {
      await cleanupFixture(fixture);
      await restoreRollupWindow(rollupSnapshot);
      await app.close();
    }
  }, 120000);

  it('segments overview and activity by explicit institution without leaking another school into the counts', async () => {
    const fixture: AdminAnalyticsFixture = { userIds: [], questionIds: [], sessionCodes: [], institutionIds: [] };
    const app = await buildApp();

    try {
      const { user: admin } = await createUserFixture(fixture, {
        role: 'ADMIN'
      });
      const { user: superadmin } = await createUserFixture(fixture, {
        role: 'SUPERADMIN'
      });
      const adminAuth = await createAuthContext(admin);
      const oau = await createInstitution(fixture, 'OAU');
      const unilag = await createInstitution(fixture, 'UNILAG');

      await seedInstitutionScopedAnalyticsData(fixture, oau.id, superadmin);
      await seedInstitutionScopedAnalyticsData(fixture, unilag.id, superadmin);

      const overviewResponse = await app.inject({
        method: 'GET',
        url: `/api/admin/analytics/overview?institutionCode=${oau.code}`,
        headers: {
          authorization: adminAuth.authHeader
        }
      });

      expect(overviewResponse.statusCode).toBe(200);
      const overview = overviewResponse.json();
      expect(overview.institution).toEqual(expect.objectContaining({
        id: oau.id,
        code: oau.code
      }));
      expect(overview.engagement.examsInProgress).toBe(1);
      expect(overview.engagement.examsCompletedLast7Days).toBe(1);
      expect(overview.engagement.collaborationWaiting).toBe(1);
      expect(overview.engagement.collaborationInProgress).toBe(1);
      expect(overview.engagement.collaborationCreatedLast7Days).toBe(2);
      expect(overview.content.freeExamQuestions).toBe(1);
      expect(overview.content.realUiQuestions).toBe(1);
      expect(overview.content.practiceQuestions).toBe(1);
      expect(overview.content.pendingReports).toBe(1);
      expect(overview.risk.leaderboardSignalsLast24Hours).toBe(1);

      const activityResponse = await app.inject({
        method: 'GET',
        url: `/api/admin/analytics/activity?days=7&institutionCode=${oau.code}`,
        headers: {
          authorization: adminAuth.authHeader
        }
      });

      expect(activityResponse.statusCode).toBe(200);
      const activity = activityResponse.json();
      expect(activity.dataSource).toBe('LIVE');
      expect(activity.institution).toEqual(expect.objectContaining({
        id: oau.id,
        code: oau.code
      }));
      expect(activity.summary.examStarts).toBe(2);
      expect(activity.summary.examCompletions).toBe(1);
      expect(activity.summary.collaborationSessions).toBe(2);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);
});

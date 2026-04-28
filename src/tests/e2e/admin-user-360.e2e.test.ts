import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import prisma from '../../config/database';
import { hashPassword } from '../../shared/utils/hash';
import { generateTokens } from '../../shared/utils/jwt';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeE2E = runIntegration ? describe : describe.skip;

interface AdminUser360Fixture {
  userIds: number[];
  questionIds: number[];
  institutionIds: number[];
}

function uniqueToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

async function createUserFixture(
  fixture: AdminUser360Fixture,
  input: Partial<{
    email: string;
    password: string;
    role: 'USER' | 'ADMIN' | 'SUPERADMIN';
    isPremium: boolean;
    deviceAccessMode: 'FREE' | 'PREMIUM';
    authPolicyVersion: number;
    currentStreak: number;
    longestStreak: number;
    subscriptionEndDate: Date | null;
    targetInstitutionId: number | null;
  }> = {}
) {
  const password = input.password || 'SecurePass123!';
  const user = await prisma.user.create({
    data: {
      email: input.email || `${uniqueToken('admin-user360')}@example.com`,
      passwordHash: await hashPassword(password),
      fullName: uniqueToken('Admin User360 Fixture'),
      isVerified: true,
      role: input.role ?? 'USER',
      isPremium: input.isPremium ?? false,
      deviceAccessMode: input.deviceAccessMode ?? (input.isPremium ? 'PREMIUM' : 'FREE'),
      authPolicyVersion: input.authPolicyVersion ?? 0,
      currentStreak: input.currentStreak ?? 0,
      longestStreak: input.longestStreak ?? input.currentStreak ?? 0,
      subscriptionEndDate: input.subscriptionEndDate ?? null,
      targetInstitutionId: input.targetInstitutionId ?? null
    }
  });

  fixture.userIds.push(user.id);
  return { user, password };
}

async function createAuthHeader(
  user: { id: number; email: string; role: string },
  input: Partial<{
    deviceId: string;
    authPolicyVersion: number;
    tokenVersion: number;
  }> = {}
): Promise<string> {
  const deviceId = input.deviceId || uniqueToken('admin-user360-device');
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

  return `Bearer ${tokens.accessToken}`;
}

async function createInstitution(fixture: AdminUser360Fixture, label: string) {
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
  fixture: AdminUser360Fixture,
  subject: string,
  institutionId?: number
) {
  const question = await prisma.question.create({
    data: {
      institutionId,
      questionText: uniqueToken(`User360 question ${subject}`),
      optionA: 'A',
      optionB: 'B',
      optionC: 'C',
      optionD: 'D',
      correctAnswer: 'A',
      subject,
      topic: 'User360',
      difficultyLevel: 'MEDIUM',
      questionType: 'practice',
      questionPool: 'PRACTICE'
    }
  });

  fixture.questionIds.push(question.id);
  return question;
}

async function seedUser360Data(
  fixture: AdminUser360Fixture,
  targetUser: { id: number },
  superadmin: { id: number },
  institutionId?: number
) {
  const now = new Date();
  const inThirtyDays = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));
  const question = await createQuestion(fixture, 'BIOLOGY', institutionId);
  const { user: collaborator } = await createUserFixture(fixture, {});

  if (institutionId) {
    await prisma.userInstitutionStats.upsert({
      where: {
        userId_institutionId: {
          userId: targetUser.id,
          institutionId
        }
      },
      create: {
        userId: targetUser.id,
        institutionId,
        weeklySp: 120,
        totalSp: 120,
        completedCollaborationExams: 1
      },
      update: {
        weeklySp: 120,
        totalSp: 120,
        completedCollaborationExams: 1
      }
    });
  }

  await prisma.userDevice.create({
    data: {
      userId: targetUser.id,
      deviceId: 'user360-premium-device',
      deviceName: 'Target Premium Device',
      userAgent: 'Mozilla/5.0 User360',
      fingerprintHash: 'user360-fingerprint',
      fingerprintData: { browserName: 'chrome' },
      isVerified: true,
      isActive: true,
      verifiedAt: now,
      lastLoginAt: now,
      registrationMethod: 'PREMIUM_FIRST_LOGIN'
    }
  });

  await prisma.userSession.create({
    data: {
      userId: targetUser.id,
      deviceId: 'user360-premium-device',
      isActive: true,
      authPolicyVersion: 1,
      tokenVersion: 0,
      expiresAt: inThirtyDays
    }
  });

  await prisma.auditLog.createMany({
    data: [
      {
        userId: targetUser.id,
        action: 'LOGIN_SUCCESS',
        deviceId: 'user360-premium-device',
        ipAddress: '127.0.0.1',
        metadata: { source: 'admin-user360-test' }
      },
      {
        userId: targetUser.id,
        action: 'PASSWORD_CHANGED',
        deviceId: 'user360-premium-device',
        ipAddress: '127.0.0.1',
        metadata: { source: 'admin-user360-test' }
      }
    ]
  });

  await prisma.adminAuditLog.create({
    data: {
      actorId: superadmin.id,
      actorRole: 'SUPERADMIN',
      action: 'PREMIUM_GRANTED',
      targetType: 'USER',
      targetId: String(targetUser.id),
      reason: 'User360 fixture premium grant'
    }
  });

  await prisma.subscription.create({
    data: {
      userId: targetUser.id,
      provider: 'PAYSTACK',
      planType: 'UI_PREMIUM_5_MONTH',
      amountPaid: 5000,
      paymentReference: uniqueToken('user360-payment-ref'),
      status: 'ACTIVE',
      startDate: now,
      endDate: inThirtyDays,
      autoRenew: true,
      authorizationReusable: true,
      lastPaymentVerifiedAt: now
    }
  });

  const subscription = await prisma.subscription.findUniqueOrThrow({
    where: { userId: targetUser.id }
  });

  await prisma.subscriptionPayment.create({
    data: {
      userId: targetUser.id,
      subscriptionId: subscription.id,
      provider: 'PAYSTACK',
      reference: uniqueToken('user360-payment'),
      status: 'SUCCESS',
      amountPaid: 5000,
      currency: 'NGN',
      channel: 'card',
      paidAt: now
    }
  });

  await prisma.premiumEntitlement.create({
    data: {
      userId: targetUser.id,
      grantedByAdminId: superadmin.id,
      kind: 'MANUAL',
      status: 'ACTIVE',
      startsAt: now,
      endsAt: inThirtyDays,
      note: 'User360 fixture entitlement'
    }
  });

  const completedExam = await prisma.exam.create({
    data: {
      userId: targetUser.id,
      institutionId,
      examType: 'ONE_V_ONE_DUEL',
      nameScopeKey: uniqueToken('user360-exam-completed'),
      sessionNumber: 1,
      subjectsIncluded: ['BIOLOGY'],
      totalQuestions: 25,
      score: 80,
      percentage: 80,
      spEarned: 120,
      isCollaboration: true,
      status: 'COMPLETED',
      startedAt: now,
      completedAt: now
    }
  });

  await prisma.exam.create({
    data: {
      userId: targetUser.id,
      institutionId,
      examType: 'PRACTICE',
      nameScopeKey: uniqueToken('user360-exam-progress'),
      sessionNumber: 1,
      subjectsIncluded: ['CHEMISTRY'],
      totalQuestions: 25,
      score: 0,
      spEarned: 0,
      status: 'IN_PROGRESS',
      startedAt: now
    }
  });

  await prisma.bookmarkedQuestion.create({
    data: {
      userId: targetUser.id,
      questionId: question.id,
      examId: completedExam.id,
      notes: 'Admin user360 bookmark fixture',
      expiresAt: inThirtyDays
    }
  });

  await prisma.questionReport.create({
    data: {
      userId: targetUser.id,
      questionId: question.id,
      issueType: 'WRONG_ANSWER',
      status: 'PENDING',
      description: 'User360 report fixture'
    }
  });

  const hostedSession = await prisma.collaborationSession.create({
    data: {
      sessionType: 'ONE_V_ONE_DUEL',
      hostUserId: targetUser.id,
      institutionId,
      sessionCode: uniqueToken('user360-hosted'),
      nameScopeKey: uniqueToken('user360-hosted-scope'),
      sessionNumber: 1,
      subjectsIncluded: ['BIOLOGY'],
      totalQuestions: 25,
      questionSource: 'REAL_PAST_QUESTION',
      status: 'COMPLETED',
      startedAt: now,
      endedAt: now
    }
  });

  await prisma.sessionParticipant.create({
    data: {
      sessionId: hostedSession.id,
      userId: collaborator.id,
      participantState: 'FINISHED'
    }
  });

  const participantSession = await prisma.collaborationSession.create({
    data: {
      sessionType: 'ONE_V_ONE_DUEL',
      hostUserId: collaborator.id,
      institutionId,
      sessionCode: uniqueToken('user360-participant'),
      nameScopeKey: uniqueToken('user360-participant-scope'),
      sessionNumber: 1,
      subjectsIncluded: ['CHEMISTRY'],
      totalQuestions: 25,
      questionSource: 'PRACTICE',
      status: 'IN_PROGRESS',
      startedAt: now
    }
  });

  await prisma.sessionParticipant.create({
    data: {
      sessionId: participantSession.id,
      userId: targetUser.id,
      participantState: 'READY'
    }
  });

  await prisma.studyActivity.create({
    data: {
      userId: targetUser.id,
      activityDate: now,
      examsTaken: 2,
      spEarnedToday: 120
    }
  });
}

async function cleanupFixture(fixture: AdminUser360Fixture): Promise<void> {
  if (fixture.userIds.length === 0 && fixture.questionIds.length === 0) return;

  await prisma.questionReport.deleteMany({
    where: {
      OR: [
        { userId: { in: fixture.userIds } },
        { questionId: { in: fixture.questionIds } }
      ]
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

  await prisma.examAnswer.deleteMany({
    where: {
      exam: {
        userId: { in: fixture.userIds }
      }
    }
  });

  await prisma.exam.updateMany({
    where: {
      collaborationSessionId: {
        not: null
      }
    },
    data: {
      collaborationSessionId: null
    }
  });

  await prisma.sessionParticipant.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.collaborationSession.deleteMany({
    where: { hostUserId: { in: fixture.userIds } }
  });

  await prisma.studyActivity.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.exam.deleteMany({
    where: { userId: { in: fixture.userIds } }
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

  await prisma.adminStepUpChallenge.deleteMany({
    where: { actorId: { in: fixture.userIds } }
  });

  await prisma.idempotencyRecord.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.adminAuditLog.deleteMany({
    where: {
      OR: [
        { actorId: { in: fixture.userIds } },
        { targetId: { in: fixture.userIds.map(String) } }
      ]
    }
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

  await prisma.user.deleteMany({
    where: { id: { in: fixture.userIds } }
  });

  if (fixture.institutionIds.length > 0) {
    await prisma.institution.deleteMany({
      where: { id: { in: fixture.institutionIds } }
    });
  }
}

describeE2E('Admin user 360 (HTTP e2e)', () => {
  it('lets admins inspect a regular user with support-grade visibility while hiding payment details reserved for superadmins', async () => {
    const fixture: AdminUser360Fixture = { userIds: [], questionIds: [], institutionIds: [] };
    const app = await buildApp();

    try {
      const { user: admin } = await createUserFixture(fixture, {
        role: 'ADMIN'
      });
      const { user: superadmin } = await createUserFixture(fixture, {
        role: 'SUPERADMIN'
      });
      const { user: targetUser } = await createUserFixture(fixture, {
        isPremium: true,
        deviceAccessMode: 'PREMIUM',
        authPolicyVersion: 1,
        currentStreak: 5,
        longestStreak: 7,
        subscriptionEndDate: new Date(Date.now() + (30 * 24 * 60 * 60 * 1000))
      });

      await seedUser360Data(fixture, targetUser, superadmin);
      const authHeader = await createAuthHeader(admin);

      const response = await app.inject({
        method: 'GET',
        url: `/api/admin/users/${targetUser.id}/360`,
        headers: {
          authorization: authHeader
        }
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();
      expect(payload.institution).toEqual(expect.objectContaining({
        code: 'UI'
      }));
      expect(payload.user.id).toBe(targetUser.id);
      expect(payload.premium.isPremium).toBe(true);
      expect(payload.premium.coverage.isPremium).toBe(true);
      expect(payload.premium.latestSuccessfulPayment).toBeNull();
      expect(payload.engagement.completedExams).toBeGreaterThanOrEqual(1);
      expect(payload.engagement.inProgressExams).toBeGreaterThanOrEqual(1);
      expect(payload.engagement.bookmarkedQuestions).toBeGreaterThanOrEqual(1);
      expect(payload.engagement.questionReportsSubmitted).toBeGreaterThanOrEqual(1);
      expect(payload.security.activeSessionsCount).toBeGreaterThanOrEqual(1);
      expect(payload.security.verifiedDevicesCount).toBeGreaterThanOrEqual(1);
      expect(payload.security.recentAuditEvents.length).toBeGreaterThanOrEqual(1);
      expect(payload.security.recentAdminActions.length).toBeGreaterThanOrEqual(1);
      expect(payload.recent.exams.length).toBeGreaterThanOrEqual(1);
      expect(payload.recent.bookmarks.length).toBeGreaterThanOrEqual(1);
      expect(payload.recent.collaborationSessions.length).toBeGreaterThanOrEqual(1);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('blocks admins from inspecting admin or superadmin accounts through user-360', async () => {
    const fixture: AdminUser360Fixture = { userIds: [], questionIds: [], institutionIds: [] };
    const app = await buildApp();

    try {
      const { user: admin } = await createUserFixture(fixture, {
        role: 'ADMIN'
      });
      const { user: superadmin } = await createUserFixture(fixture, {
        role: 'SUPERADMIN'
      });
      const authHeader = await createAuthHeader(admin);

      const response = await app.inject({
        method: 'GET',
        url: `/api/admin/users/${superadmin.id}/360`,
        headers: {
          authorization: authHeader
        }
      });

      expect(response.statusCode).toBe(403);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('lets superadmins inspect the same user with payment visibility included', async () => {
    const fixture: AdminUser360Fixture = { userIds: [], questionIds: [], institutionIds: [] };
    const app = await buildApp();

    try {
      const { user: superadmin } = await createUserFixture(fixture, {
        role: 'SUPERADMIN'
      });
      const { user: targetUser } = await createUserFixture(fixture, {
        isPremium: true,
        deviceAccessMode: 'PREMIUM',
        authPolicyVersion: 1,
        subscriptionEndDate: new Date(Date.now() + (30 * 24 * 60 * 60 * 1000))
      });

      await seedUser360Data(fixture, targetUser, superadmin);
      const authHeader = await createAuthHeader(superadmin);

      const response = await app.inject({
        method: 'GET',
        url: `/api/admin/users/${targetUser.id}/360`,
        headers: {
          authorization: authHeader
        }
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();
      expect(payload.premium.latestSuccessfulPayment).not.toBeNull();
      expect(payload.premium.latestSuccessfulPayment.amountPaid).toBeGreaterThanOrEqual(5000);
      expect(payload.premium.subscription).not.toBeNull();
      expect(payload.premium.activeEntitlements.length).toBeGreaterThanOrEqual(1);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('scopes engagement and recent study activity to the requested institution in user-360', async () => {
    const fixture: AdminUser360Fixture = { userIds: [], questionIds: [], institutionIds: [] };
    const app = await buildApp();

    try {
      const { user: admin } = await createUserFixture(fixture, {
        role: 'ADMIN'
      });
      const { user: superadmin } = await createUserFixture(fixture, {
        role: 'SUPERADMIN'
      });
      const oau = await createInstitution(fixture, 'OAU');
      const unilag = await createInstitution(fixture, 'UNILAG');
      const { user: targetUser } = await createUserFixture(fixture, {
        isPremium: true,
        deviceAccessMode: 'PREMIUM',
        targetInstitutionId: oau.id
      });

      await seedUser360Data(fixture, targetUser, superadmin, oau.id);

      const unilagQuestion = await createQuestion(fixture, 'CHEMISTRY', unilag.id);
      await prisma.userInstitutionStats.upsert({
        where: {
          userId_institutionId: {
            userId: targetUser.id,
            institutionId: unilag.id
          }
        },
        create: {
          userId: targetUser.id,
          institutionId: unilag.id,
          weeklySp: 40,
          totalSp: 90,
          realExamsCompleted: 1
        },
        update: {
          weeklySp: 40,
          totalSp: 90,
          realExamsCompleted: 1
        }
      });

      const unilagExam = await prisma.exam.create({
        data: {
          userId: targetUser.id,
          institutionId: unilag.id,
          examType: 'REAL_PAST_QUESTION',
          nameScopeKey: uniqueToken('user360-unilag-exam'),
          sessionNumber: 1,
          subjectsIncluded: ['CHEMISTRY'],
          totalQuestions: 25,
          score: 10,
          percentage: 40,
          spEarned: 20,
          status: 'COMPLETED',
          startedAt: new Date(),
          completedAt: new Date()
        }
      });

      await prisma.bookmarkedQuestion.create({
        data: {
          userId: targetUser.id,
          questionId: unilagQuestion.id,
          examId: unilagExam.id,
          expiresAt: new Date(Date.now() + (7 * 24 * 60 * 60 * 1000))
        }
      });

      await prisma.questionReport.create({
        data: {
          userId: targetUser.id,
          questionId: unilagQuestion.id,
          issueType: 'TYPO',
          status: 'PENDING',
          description: 'UNILAG-only report'
        }
      });

      await prisma.collaborationSession.create({
        data: {
          sessionType: 'ONE_V_ONE_DUEL',
          hostUserId: targetUser.id,
          institutionId: unilag.id,
          sessionCode: uniqueToken('user360-unilag-session'),
          nameScopeKey: uniqueToken('user360-unilag-scope'),
          sessionNumber: 1,
          subjectsIncluded: ['CHEMISTRY'],
          totalQuestions: 25,
          questionSource: 'REAL_PAST_QUESTION',
          status: 'WAITING'
        }
      });

      const authHeader = await createAuthHeader(admin);
      const response = await app.inject({
        method: 'GET',
        url: `/api/admin/users/${targetUser.id}/360?institutionCode=${oau.code}`,
        headers: {
          authorization: authHeader
        }
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();
      expect(payload.institution).toEqual(expect.objectContaining({
        id: oau.id,
        code: oau.code
      }));
      expect(payload.engagement.totalSp).toBe(120);
      expect(payload.engagement.weeklySp).toBe(120);
      expect(payload.engagement.completedExams).toBe(1);
      expect(payload.engagement.inProgressExams).toBe(1);
      expect(payload.engagement.bookmarkedQuestions).toBe(1);
      expect(payload.engagement.questionReportsSubmitted).toBe(1);
      expect(payload.engagement.hostedCollaborationSessions).toBe(1);
      expect(payload.recent.exams.every((exam: { id: number }) => exam.id !== unilagExam.id)).toBe(true);
      expect(payload.recent.bookmarks.every((bookmark: { questionId: number }) => bookmark.questionId !== unilagQuestion.id)).toBe(true);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);
});

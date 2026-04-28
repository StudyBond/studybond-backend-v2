import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import prisma from '../../config/database';
import { hashOtp, hashPassword, verifyPassword } from '../../shared/utils/hash';
import { generateTokens } from '../../shared/utils/jwt';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeE2E = runIntegration ? describe : describe.skip;

interface Fixture {
  userIds: number[];
  questionIds: number[];
  sessionIds: number[];
  institutionIds: number[];
}

function uniqueToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

async function createUserFixture(
  fixture: Fixture,
  input: Partial<{
    email: string;
    password: string;
    role: 'USER' | 'ADMIN' | 'SUPERADMIN';
    aspiringCourse: string | null;
    targetScore: number | null;
    emailUnsubscribed: boolean;
    isPremium: boolean;
    deviceAccessMode: 'FREE' | 'PREMIUM';
    targetInstitutionId: number | null;
  }> = {}
) {
  const password = input.password || 'SecurePass123!';
  const user = await prisma.user.create({
    data: {
      email: input.email || `${uniqueToken('users-module')}@example.com`,
      passwordHash: await hashPassword(password),
      fullName: uniqueToken('Users Module Fixture'),
      isVerified: true,
      role: input.role ?? 'USER',
      aspiringCourse: input.aspiringCourse ?? null,
      targetScore: input.targetScore ?? null,
      emailUnsubscribed: input.emailUnsubscribed ?? false,
      isPremium: input.isPremium ?? false,
      deviceAccessMode: input.deviceAccessMode ?? (input.isPremium ? 'PREMIUM' : 'FREE'),
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
  const session = await createAuthenticatedSession(user, input);
  return session.authorization;
}

async function createAuthenticatedSession(
  user: { id: number; email: string; role: string },
  input: Partial<{
    deviceId: string;
    authPolicyVersion: number;
    tokenVersion: number;
  }> = {}
): Promise<{
  authorization: string;
  sessionId: string;
  deviceId: string;
}> {
  const deviceId = input.deviceId || uniqueToken('users-device');
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
    authorization: `Bearer ${tokens.accessToken}`,
    sessionId: session.id,
    deviceId
  };
}

async function createInstitution(fixture: Fixture, label: string) {
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

async function createQuestionFixture(fixture: Fixture, subject = 'Biology', institutionId?: number) {
  const question = await prisma.question.create({
    data: {
      institutionId,
      questionText: `Question ${uniqueToken('users-question')}`,
      optionA: 'A',
      optionB: 'B',
      optionC: 'C',
      optionD: 'D',
      correctAnswer: 'A',
      subject,
      questionType: 'MULTIPLE_CHOICE'
    }
  });

  fixture.questionIds.push(question.id);
  return question;
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  if (fixture.sessionIds.length > 0) {
    await prisma.exam.updateMany({
      where: {
        collaborationSessionId: {
          in: fixture.sessionIds
        }
      },
      data: {
        collaborationSessionId: null
      }
    });
  }

  await prisma.idempotencyRecord.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.sessionParticipant.deleteMany({
    where: {
      OR: [
        { userId: { in: fixture.userIds } },
        { sessionId: { in: fixture.sessionIds } }
      ]
    }
  });

  await prisma.collaborationSession.deleteMany({
    where: {
      OR: [
        { id: { in: fixture.sessionIds } },
        { hostUserId: { in: fixture.userIds } }
      ]
    }
  });

  await prisma.questionReport.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.bookmarkedQuestion.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.exam.deleteMany({
    where: { userId: { in: fixture.userIds } }
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

describeE2E('Users module (HTTP e2e)', () => {
  it('returns the authenticated profile and allows clearing optional profile fields safely', async () => {
    const fixture: Fixture = { userIds: [], questionIds: [], sessionIds: [], institutionIds: [] };
    const app = await buildApp();

    try {
      const { user } = await createUserFixture(fixture, {
        aspiringCourse: 'Medicine',
        targetScore: 320,
        emailUnsubscribed: false
      });
      const authHeader = await createAuthHeader(user);

      const profileResponse = await app.inject({
        method: 'GET',
        url: '/api/users/profile',
        headers: { authorization: authHeader }
      });

      expect(profileResponse.statusCode).toBe(200);
      expect(profileResponse.json().data).toEqual(expect.objectContaining({
        id: user.id,
        email: user.email,
        aspiringCourse: 'Medicine',
        targetScore: 320,
        deviceAccessMode: 'FREE'
      }));
      expect(profileResponse.json().data.passwordHash).toBeUndefined();

      const updateResponse = await app.inject({
        method: 'PATCH',
        url: '/api/users/profile',
        headers: { authorization: authHeader },
        payload: {
          fullName: 'Refined Test User',
          aspiringCourse: null,
          targetScore: null,
          emailUnsubscribed: true
        }
      });

      expect(updateResponse.statusCode).toBe(200);
      expect(updateResponse.json().data).toEqual(expect.objectContaining({
        fullName: 'Refined Test User',
        aspiringCourse: null,
        targetScore: null,
        emailUnsubscribed: true
      }));
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('returns current user stats with exam, bookmark, session, and premium device counts', async () => {
    const fixture: Fixture = { userIds: [], questionIds: [], sessionIds: [], institutionIds: [] };
    const app = await buildApp();

    try {
      const { user } = await createUserFixture(fixture, {
        isPremium: true,
        deviceAccessMode: 'PREMIUM'
      });
      const authHeader = await createAuthHeader(user);
      const question = await createQuestionFixture(fixture);

      await prisma.userDevice.create({
        data: {
          userId: user.id,
          deviceId: 'verified-users-device',
          deviceName: 'Verified Device',
          userAgent: 'Mozilla/5.0',
          isVerified: true,
          isActive: true
        }
      });

      await prisma.bookmarkedQuestion.create({
        data: {
          userId: user.id,
          questionId: question.id
        }
      });

      await prisma.exam.createMany({
        data: [
          {
            userId: user.id,
            examType: 'PRACTICE',
            nameScopeKey: 'PRACTICE:BIO',
            sessionNumber: 1,
            subjectsIncluded: ['Biology'],
            totalQuestions: 10,
            score: 8,
            percentage: 80,
            spEarned: 20,
            status: 'COMPLETED'
          },
          {
            userId: user.id,
            examType: 'PRACTICE',
            nameScopeKey: 'PRACTICE:BIO',
            sessionNumber: 2,
            subjectsIncluded: ['Biology'],
            totalQuestions: 10,
            score: 0,
            percentage: null,
            spEarned: 0,
            status: 'IN_PROGRESS'
          },
          {
            userId: user.id,
            examType: 'REAL_PAST_QUESTION',
            nameScopeKey: 'REAL:BIO',
            sessionNumber: 1,
            subjectsIncluded: ['Biology'],
            totalQuestions: 10,
            score: 3,
            percentage: 30,
            spEarned: 4,
            status: 'ABANDONED'
          }
        ]
      });

      const statsResponse = await app.inject({
        method: 'GET',
        url: '/api/users/stats',
        headers: { authorization: authHeader }
      });

      expect(statsResponse.statusCode).toBe(200);
      expect(statsResponse.json().data).toEqual(expect.objectContaining({
        institution: expect.objectContaining({
          code: 'UI'
        }),
        completedExams: 1,
        inProgressExams: 1,
        abandonedExams: 1,
        bookmarkedQuestions: 1,
        activeSessions: 1,
        registeredPremiumDevices: 1,
        deviceAccessMode: 'PREMIUM'
      }));
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('returns institution-scoped study stats without leaking exams or bookmarks from another school', async () => {
    const fixture: Fixture = { userIds: [], questionIds: [], sessionIds: [], institutionIds: [] };
    const app = await buildApp();

    try {
      const oau = await createInstitution(fixture, 'OAU');
      const unilag = await createInstitution(fixture, 'UNILAG');
      const { user } = await createUserFixture(fixture, {
        isPremium: true,
        deviceAccessMode: 'PREMIUM',
        targetInstitutionId: oau.id
      });
      const authHeader = await createAuthHeader(user);
      const oauQuestion = await createQuestionFixture(fixture, 'Biology', oau.id);
      const unilagQuestion = await createQuestionFixture(fixture, 'Chemistry', unilag.id);

      await prisma.userInstitutionStats.upsert({
        where: {
          userId_institutionId: {
            userId: user.id,
            institutionId: oau.id
          }
        },
        create: {
          userId: user.id,
          institutionId: oau.id,
          weeklySp: 180,
          totalSp: 420,
          realExamsCompleted: 3,
          completedCollaborationExams: 2
        },
        update: {
          weeklySp: 180,
          totalSp: 420,
          realExamsCompleted: 3,
          completedCollaborationExams: 2
        }
      });

      await prisma.userInstitutionStats.upsert({
        where: {
          userId_institutionId: {
            userId: user.id,
            institutionId: unilag.id
          }
        },
        create: {
          userId: user.id,
          institutionId: unilag.id,
          weeklySp: 40,
          totalSp: 90,
          realExamsCompleted: 1,
          completedCollaborationExams: 0
        },
        update: {
          weeklySp: 40,
          totalSp: 90,
          realExamsCompleted: 1,
          completedCollaborationExams: 0
        }
      });

      await prisma.bookmarkedQuestion.createMany({
        data: [
          {
            userId: user.id,
            questionId: oauQuestion.id
          },
          {
            userId: user.id,
            questionId: unilagQuestion.id
          }
        ]
      });

      await prisma.exam.createMany({
        data: [
          {
            userId: user.id,
            institutionId: oau.id,
            examType: 'REAL_PAST_QUESTION',
            nameScopeKey: uniqueToken('users-oau-real'),
            sessionNumber: 1,
            subjectsIncluded: ['Biology'],
            totalQuestions: 25,
            score: 20,
            percentage: 80,
            spEarned: 30,
            status: 'COMPLETED'
          },
          {
            userId: user.id,
            institutionId: oau.id,
            examType: 'PRACTICE',
            nameScopeKey: uniqueToken('users-oau-progress'),
            sessionNumber: 1,
            subjectsIncluded: ['Biology'],
            totalQuestions: 25,
            score: 0,
            spEarned: 0,
            status: 'IN_PROGRESS'
          },
          {
            userId: user.id,
            institutionId: unilag.id,
            examType: 'REAL_PAST_QUESTION',
            nameScopeKey: uniqueToken('users-unilag-abandoned'),
            sessionNumber: 1,
            subjectsIncluded: ['Chemistry'],
            totalQuestions: 25,
            score: 5,
            percentage: 20,
            spEarned: 5,
            status: 'ABANDONED'
          }
        ]
      });

      const statsResponse = await app.inject({
        method: 'GET',
        url: `/api/users/stats?institutionCode=${oau.code}`,
        headers: { authorization: authHeader }
      });

      expect(statsResponse.statusCode).toBe(200);
      expect(statsResponse.json().data).toEqual(expect.objectContaining({
        institution: expect.objectContaining({
          code: oau.code,
          id: oau.id
        }),
        totalSp: 420,
        weeklySp: 180,
        realExamsCompleted: 3,
        completedCollaborationExams: 2,
        completedExams: 1,
        inProgressExams: 1,
        abandonedExams: 0,
        bookmarkedQuestions: 1,
        activeSessions: 1,
        registeredPremiumDevices: 0
      }));
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('deletes a regular user account safely and detaches collaboration history owned by that user', async () => {
    const fixture: Fixture = { userIds: [], questionIds: [], sessionIds: [], institutionIds: [] };
    const app = await buildApp();

    try {
      const { user: hostUser, password } = await createUserFixture(fixture, {});
      const { user: otherUser } = await createUserFixture(fixture, {});
      const authHeader = await createAuthHeader(hostUser);

      const session = await prisma.collaborationSession.create({
        data: {
          sessionType: 'ONE_V_ONE_DUEL',
          hostUserId: hostUser.id,
          sessionCode: `SESS${randomUUID().replace(/-/g, '').slice(0, 6)}`.toUpperCase(),
          nameScopeKey: 'DUEL:BIO',
          sessionNumber: 1,
          subjectsIncluded: ['Biology'],
          totalQuestions: 10,
          questionSource: 'REAL_PAST_QUESTION'
        }
      });
      fixture.sessionIds.push(session.id);

      await prisma.sessionParticipant.createMany({
        data: [
          { sessionId: session.id, userId: hostUser.id },
          { sessionId: session.id, userId: otherUser.id }
        ]
      });

      await prisma.questionReport.create({
        data: {
          userId: hostUser.id,
          questionId: (await createQuestionFixture(fixture)).id,
          issueType: 'TYPO'
        }
      });

      const peerExam = await prisma.exam.create({
        data: {
          userId: otherUser.id,
          examType: 'ONE_V_ONE_DUEL',
          nameScopeKey: 'DUEL:BIO',
          sessionNumber: 1,
          subjectsIncluded: ['Biology'],
          totalQuestions: 10,
          score: 7,
          percentage: 70,
          spEarned: 12,
          status: 'COMPLETED',
          isCollaboration: true,
          collaborationSessionId: session.id
        }
      });

      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: '/api/users/account',
        headers: { authorization: authHeader },
        payload: {
          password
        }
      });

      expect(deleteResponse.statusCode).toBe(200);
      expect(deleteResponse.json().data.success).toBe(true);

      const deletedUser = await prisma.user.findUnique({
        where: { id: hostUser.id }
      });
      const deletedSession = await prisma.collaborationSession.findUnique({
        where: { id: session.id }
      });
      const refreshedPeerExam = await prisma.exam.findUniqueOrThrow({
        where: { id: peerExam.id },
        select: {
          collaborationSessionId: true
        }
      });

      expect(deletedUser).toBeNull();
      expect(deletedSession).toBeNull();
      expect(refreshedPeerExam.collaborationSessionId).toBeNull();
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('changes password, clears password reset state, and signs out other active sessions', async () => {
    const fixture: Fixture = { userIds: [], questionIds: [], sessionIds: [], institutionIds: [] };
    const app = await buildApp();

    try {
      const { user, password } = await createUserFixture(fixture, {});
      const currentAuth = await createAuthenticatedSession(user, { deviceId: 'current-users-device' });
      const otherAuth = await createAuthenticatedSession(user, { deviceId: 'other-users-device' });

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: await hashOtp('123456'),
          passwordResetExpires: new Date(Date.now() + 15 * 60 * 1000)
        }
      });

      const changePasswordResponse = await app.inject({
        method: 'PATCH',
        url: '/api/users/password',
        headers: {
          authorization: currentAuth.authorization
        },
        payload: {
          currentPassword: password,
          newPassword: 'EvenSaferPass456!'
        }
      });

      expect(changePasswordResponse.statusCode).toBe(200);
      expect(changePasswordResponse.json().data).toEqual(expect.objectContaining({
        success: true,
        invalidatedSessions: 1
      }));

      const refreshedUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          passwordHash: true,
          lastPasswordChange: true,
          passwordResetToken: true,
          passwordResetExpires: true
        }
      });
      const currentSession = await prisma.userSession.findUniqueOrThrow({
        where: { id: currentAuth.sessionId },
        select: { isActive: true }
      });
      const otherSession = await prisma.userSession.findUniqueOrThrow({
        where: { id: otherAuth.sessionId },
        select: { isActive: true }
      });
      const passwordChangeAudit = await prisma.auditLog.findFirst({
        where: {
          userId: user.id,
          action: 'PASSWORD_CHANGED'
        },
        orderBy: { createdAt: 'desc' }
      });

      expect(await verifyPassword('EvenSaferPass456!', refreshedUser.passwordHash)).toBe(true);
      expect(refreshedUser.lastPasswordChange).not.toBeNull();
      expect(refreshedUser.passwordResetToken).toBeNull();
      expect(refreshedUser.passwordResetExpires).toBeNull();
      expect(currentSession.isActive).toBe(true);
      expect(otherSession.isActive).toBe(false);
      expect(passwordChangeAudit?.metadata).toEqual(expect.objectContaining({
        currentSessionId: currentAuth.sessionId,
        invalidatedSessions: 1
      }));

      const currentProfileResponse = await app.inject({
        method: 'GET',
        url: '/api/users/profile',
        headers: { authorization: currentAuth.authorization }
      });
      const otherProfileResponse = await app.inject({
        method: 'GET',
        url: '/api/users/profile',
        headers: { authorization: otherAuth.authorization }
      });

      expect(currentProfileResponse.statusCode).toBe(200);
      expect(otherProfileResponse.statusCode).toBe(401);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('rejects password change when the current password is wrong', async () => {
    const fixture: Fixture = { userIds: [], questionIds: [], sessionIds: [], institutionIds: [] };
    const app = await buildApp();

    try {
      const { user } = await createUserFixture(fixture, {});
      const currentAuth = await createAuthenticatedSession(user, { deviceId: 'wrong-password-device' });

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/users/password',
        headers: {
          authorization: currentAuth.authorization
        },
        payload: {
          currentPassword: 'WrongPassword123!',
          newPassword: 'EvenSaferPass456!'
        }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual(expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'PASSWORD_INVALID'
        })
      }));
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('rejects password change after the daily password change cap is reached', async () => {
    const fixture: Fixture = { userIds: [], questionIds: [], sessionIds: [], institutionIds: [] };
    const app = await buildApp();

    try {
      const { user, password } = await createUserFixture(fixture, {});
      const currentAuth = await createAuthenticatedSession(user, { deviceId: 'password-cap-device' });
      const now = new Date();

      await prisma.auditLog.createMany({
        data: Array.from({ length: 3 }, (_, index) => ({
          userId: user.id,
          action: 'PASSWORD_CHANGED',
          createdAt: new Date(now.getTime() - index * 60 * 60 * 1000),
          metadata: {
            seeded: true,
            ordinal: index + 1
          }
        }))
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/users/password',
        headers: {
          authorization: currentAuth.authorization
        },
        payload: {
          currentPassword: password,
          newPassword: 'EvenSaferPass456!'
        }
      });

      expect(response.statusCode).toBe(429);
      expect(response.json()).toEqual(expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'PASSWORD_CHANGE_LIMIT_EXCEEDED'
        })
      }));
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('returns a read-only security overview for active sessions and registered premium devices', async () => {
    const fixture: Fixture = { userIds: [], questionIds: [], sessionIds: [], institutionIds: [] };
    const app = await buildApp();

    try {
      const { user } = await createUserFixture(fixture, {
        isPremium: true,
        deviceAccessMode: 'PREMIUM'
      });
      const currentAuth = await createAuthenticatedSession(user, { deviceId: 'premium-device-a' });

      await prisma.userSession.create({
        data: {
          userId: user.id,
          deviceId: 'premium-device-b',
          isActive: true,
          authPolicyVersion: 0,
          tokenVersion: 0,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });

      await prisma.userDevice.createMany({
        data: [
          {
            userId: user.id,
            deviceId: 'premium-device-a',
            deviceName: 'Chrome on Pixel',
            userAgent: 'Mozilla/5.0 A',
            isVerified: true,
            isActive: true,
            verifiedAt: new Date(),
            lastLoginAt: new Date(),
            registrationMethod: 'PREMIUM_FIRST_LOGIN'
          },
          {
            userId: user.id,
            deviceId: 'premium-device-b',
            deviceName: 'Safari on iPhone',
            userAgent: 'Mozilla/5.0 B',
            isVerified: true,
            isActive: false,
            verifiedAt: new Date(),
            lastLoginAt: new Date(),
            registrationMethod: 'PREMIUM_OTP'
          }
        ]
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/users/security',
        headers: {
          authorization: currentAuth.authorization
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual(expect.objectContaining({
        deviceAccessMode: 'PREMIUM',
        currentSessionId: currentAuth.sessionId,
        currentDeviceId: currentAuth.deviceId
      }));
      expect(response.json().data.activeSessions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          sessionId: currentAuth.sessionId,
          deviceId: 'premium-device-a',
          isCurrent: true,
          isRegisteredPremiumDevice: true,
          registrationMethod: 'PREMIUM_FIRST_LOGIN'
        }),
        expect.objectContaining({
          deviceId: 'premium-device-b',
          isRegisteredPremiumDevice: true,
          registrationMethod: 'PREMIUM_OTP'
        })
      ]));
      expect(response.json().data.registeredPremiumDevices).toEqual(expect.arrayContaining([
        expect.objectContaining({
          deviceId: 'premium-device-a',
          isCurrent: true,
          isActive: true
        }),
        expect.objectContaining({
          deviceId: 'premium-device-b',
          isCurrent: false,
          isActive: false
        })
      ]));
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);
});

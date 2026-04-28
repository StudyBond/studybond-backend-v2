import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { AUTH_CONFIG } from '../../config/constants';
import prisma from '../../config/database';
import { hashOtp, hashPassword, verifyPassword } from '../../shared/utils/hash';
import { generateTokens } from '../../shared/utils/jwt';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeE2E = runIntegration ? describe : describe.skip;

interface AuthFixture {
  userIds: number[];
}

function uniqueToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function premiumDevicePayload(seed: string) {
  return {
    device: {
      installationId: `${seed}-install`,
      deviceName: `${seed} device`,
      platform: 'web',
      browserName: 'chrome',
      browserVersion: '123.0',
      osName: 'windows',
      osVersion: '11',
      timezone: 'Africa/Lagos',
      language: 'en-NG',
      screenWidth: 1440,
      screenHeight: 900,
      hardwareConcurrency: 8,
      deviceMemory: 8,
      fingerprintSeed: `${seed}-fingerprint`
    }
  };
}

async function createVerifiedUser(
  fixture: AuthFixture,
  input: Partial<{
    email: string;
    password: string;
    isPremium: boolean;
    deviceAccessMode: 'FREE' | 'PREMIUM';
    authPolicyVersion: number;
  }> = {}
) {
  const password = input.password || 'SecurePass123!';
  const user = await prisma.user.create({
    data: {
      email: input.email || `${uniqueToken('auth-reset-user')}@example.com`,
      passwordHash: await hashPassword(password),
      fullName: uniqueToken('Auth Reset User'),
      isVerified: true,
      isPremium: input.isPremium ?? false,
      deviceAccessMode: input.deviceAccessMode ?? (input.isPremium ? 'PREMIUM' : 'FREE'),
      authPolicyVersion: input.authPolicyVersion ?? 0
    }
  });

  fixture.userIds.push(user.id);

  return {
    user,
    password
  };
}

async function createAuthHeader(
  user: { id: number; email: string; role: string },
  input: Partial<{
    deviceId: string;
    authPolicyVersion: number;
    tokenVersion: number;
  }> = {}
): Promise<{ authorization: string; sessionId: string }> {
  const deviceId = input.deviceId || uniqueToken('auth-reset-device');
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
    sessionId: session.id
  };
}

async function cleanupFixture(fixture: AuthFixture): Promise<void> {
  if (fixture.userIds.length === 0) return;

  await prisma.idempotencyRecord.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.adminStepUpChallenge.deleteMany({
    where: { actorId: { in: fixture.userIds } }
  });

  await prisma.emailLog.deleteMany({
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

  await prisma.premiumEntitlement.deleteMany({
    where: {
      OR: [
        { userId: { in: fixture.userIds } },
        { grantedByAdminId: { in: fixture.userIds } },
        { revokedByAdminId: { in: fixture.userIds } }
      ]
    }
  });

  await prisma.user.deleteMany({
    where: { id: { in: fixture.userIds } }
  });
}

describeE2E('Auth forgot/reset password (HTTP e2e)', () => {
  it('returns a generic forgot-password response and stores reset state for a verified account', async () => {
    const fixture: AuthFixture = { userIds: [] };
    const app = await buildApp();

    try {
      const { user } = await createVerifiedUser(fixture, {});

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/forgot-password',
        payload: {
          email: user.email
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        message: 'If an account exists for that email, we sent a 6-digit code you can use to reset your password.'
      });

      const refreshedUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          passwordResetToken: true,
          passwordResetExpires: true
        }
      });
      const emailLog = await prisma.emailLog.findFirst({
        where: {
          userId: user.id,
          emailType: 'PASSWORD_RESET_OTP'
        },
        orderBy: { sentAt: 'desc' }
      });
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          userId: user.id,
          action: 'PASSWORD_RESET_REQUESTED'
        },
        orderBy: { createdAt: 'desc' }
      });

      expect(refreshedUser.passwordResetToken).toBeTruthy();
      expect(refreshedUser.passwordResetExpires).not.toBeNull();
      expect(emailLog).not.toBeNull();
      expect(auditLog?.metadata).toEqual(expect.objectContaining({
        delivered: true,
        reason: 'password_reset'
      }));
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('returns the same forgot-password response for an unknown email without leaking account state', async () => {
    const fixture: AuthFixture = { userIds: [] };
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/forgot-password',
        payload: {
          email: `${uniqueToken('missing-reset')}@example.com`
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        message: 'If an account exists for that email, we sent a 6-digit code you can use to reset your password.'
      });
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('resends a fresh reset code when a pending password reset is old enough to rotate safely', async () => {
    const fixture: AuthFixture = { userIds: [] };
    const app = await buildApp();

    try {
      const { user } = await createVerifiedUser(fixture, {});
      const previousTokenHash = await hashOtp('111111');
      const previousExpiresAt = new Date(
        Date.now() + AUTH_CONFIG.PASSWORD_RESET_OTP_EXPIRY_MS - AUTH_CONFIG.PASSWORD_RESET_RESEND_COOLDOWN_MS - 10_000
      );

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: previousTokenHash,
          passwordResetExpires: previousExpiresAt
        }
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/resend-reset-otp',
        payload: {
          email: user.email
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        message: 'If that password reset request is still active, we sent a fresh 6-digit code to your email.'
      });

      const refreshedUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          passwordResetToken: true,
          passwordResetExpires: true
        }
      });
      const resendAudit = await prisma.auditLog.findFirst({
        where: {
          userId: user.id,
          action: 'PASSWORD_RESET_REQUESTED'
        },
        orderBy: { createdAt: 'desc' }
      });

      expect(refreshedUser.passwordResetToken).toBeTruthy();
      expect(refreshedUser.passwordResetToken).not.toBe(previousTokenHash);
      expect(refreshedUser.passwordResetExpires).not.toBeNull();
      expect((refreshedUser.passwordResetExpires as Date).getTime()).toBeGreaterThan(previousExpiresAt.getTime());
      expect(resendAudit?.metadata).toEqual(expect.objectContaining({
        delivered: true,
        reason: 'password_reset_resend'
      }));
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('does not resend a fresh reset code while the cooldown window is still active', async () => {
    const fixture: AuthFixture = { userIds: [] };
    const app = await buildApp();

    try {
      const { user } = await createVerifiedUser(fixture, {});
      const previousTokenHash = await hashOtp('111111');
      const previousExpiresAt = new Date(
        Date.now() + AUTH_CONFIG.PASSWORD_RESET_OTP_EXPIRY_MS - Math.floor(AUTH_CONFIG.PASSWORD_RESET_RESEND_COOLDOWN_MS / 2)
      );

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: previousTokenHash,
          passwordResetExpires: previousExpiresAt
        }
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/resend-reset-otp',
        payload: {
          email: user.email
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        message: 'If that password reset request is still active, we sent a fresh 6-digit code to your email.'
      });

      const refreshedUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          passwordResetToken: true,
          passwordResetExpires: true
        }
      });
      const resendAudit = await prisma.auditLog.findFirst({
        where: {
          userId: user.id,
          action: 'PASSWORD_RESET_REQUESTED'
        },
        orderBy: { createdAt: 'desc' }
      });

      expect(refreshedUser.passwordResetToken).toBe(previousTokenHash);
      expect((refreshedUser.passwordResetExpires as Date).toISOString()).toBe(previousExpiresAt.toISOString());
      expect(resendAudit?.metadata).toEqual(expect.objectContaining({
        delivered: false,
        reason: 'cooldown_active'
      }));
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('resets password, invalidates all active sessions, and keeps premium device trust intact for the next login', async () => {
    const fixture: AuthFixture = { userIds: [] };
    const app = await buildApp();

    try {
      const { user, password } = await createVerifiedUser(fixture, {
        isPremium: true,
        deviceAccessMode: 'PREMIUM',
        authPolicyVersion: 1
      });

      const sessionA = await createAuthHeader(user, {
        deviceId: 'device-a-install',
        authPolicyVersion: 1
      });
      const sessionB = await createAuthHeader(user, {
        deviceId: 'device-b-install',
        authPolicyVersion: 1
      });

      await prisma.userDevice.createMany({
        data: [
          {
            userId: user.id,
            deviceId: 'device-a-install',
            deviceName: 'device-a device',
            userAgent: 'Mozilla/5.0 A',
            fingerprintHash: 'hash-device-a',
            fingerprintData: { browserName: 'chrome' },
            isVerified: true,
            isActive: true,
            verifiedAt: new Date(),
            lastLoginAt: new Date(),
            registrationMethod: 'PREMIUM_FIRST_LOGIN'
          },
          {
            userId: user.id,
            deviceId: 'device-b-install',
            deviceName: 'device-b device',
            userAgent: 'Mozilla/5.0 B',
            fingerprintHash: 'hash-device-b',
            fingerprintData: { browserName: 'chrome' },
            isVerified: true,
            isActive: true,
            verifiedAt: new Date(),
            lastLoginAt: new Date(),
            registrationMethod: 'PREMIUM_OTP'
          }
        ]
      });

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: await hashOtp('123456'),
          passwordResetExpires: new Date(Date.now() + 10 * 60 * 1000)
        }
      });

      const resetResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/reset-password',
        payload: {
          email: user.email,
          otp: '123456',
          newPassword: 'ResetPass456!',
          confirmNewPassword: 'ResetPass456!'
        }
      });

      expect(resetResponse.statusCode).toBe(200);
      expect(resetResponse.json()).toEqual({
        message: 'Your password was reset successfully. Sign in with your new password to continue.'
      });

      const refreshedUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          passwordHash: true,
          lastPasswordChange: true,
          passwordResetToken: true,
          passwordResetExpires: true
        }
      });
      const activeSessions = await prisma.userSession.count({
        where: {
          userId: user.id,
          isActive: true
        }
      });
      const activeDevices = await prisma.userDevice.count({
        where: {
          userId: user.id,
          isActive: true
        }
      });
      const passwordChangedAudit = await prisma.auditLog.findFirst({
        where: {
          userId: user.id,
          action: 'PASSWORD_CHANGED'
        },
        orderBy: { createdAt: 'desc' }
      });

      expect(await verifyPassword('ResetPass456!', refreshedUser.passwordHash)).toBe(true);
      expect(refreshedUser.lastPasswordChange).not.toBeNull();
      expect(refreshedUser.passwordResetToken).toBeNull();
      expect(refreshedUser.passwordResetExpires).toBeNull();
      expect(activeSessions).toBe(0);
      expect(activeDevices).toBe(0);
      expect(passwordChangedAudit?.metadata).toEqual(expect.objectContaining({
        reason: 'password_reset',
        invalidatedSessions: 2
      }));

      const oldSessionCheck = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: sessionA.authorization
        }
      });
      expect(oldSessionCheck.statusCode).toBe(401);

      const oldPasswordLogin = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password,
          ...premiumDevicePayload('device-a')
        }
      });
      const newPasswordLogin = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password: 'ResetPass456!',
          ...premiumDevicePayload('device-a')
        }
      });

      expect(oldPasswordLogin.statusCode).toBe(401);
      expect(newPasswordLogin.statusCode).toBe(200);
      expect(newPasswordLogin.json()).toMatchObject({
        requiresOTP: false
      });

      const replacedSessionCheck = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: sessionB.authorization
        }
      });
      expect(replacedSessionCheck.statusCode).toBe(401);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('rejects reset-password when the OTP is invalid', async () => {
    const fixture: AuthFixture = { userIds: [] };
    const app = await buildApp();

    try {
      const { user, password } = await createVerifiedUser(fixture, {});

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: await hashOtp('123456'),
          passwordResetExpires: new Date(Date.now() + 10 * 60 * 1000)
        }
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/reset-password',
        payload: {
          email: user.email,
          otp: '000000',
          newPassword: 'ResetPass456!',
          confirmNewPassword: 'ResetPass456!'
        }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual(expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'PASSWORD_RESET_OTP_INVALID'
        })
      }));

      const refreshedUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          passwordHash: true,
          passwordResetToken: true,
          passwordResetExpires: true
        }
      });

      expect(await verifyPassword(password, refreshedUser.passwordHash)).toBe(true);
      expect(refreshedUser.passwordResetToken).toBeTruthy();
      expect(refreshedUser.passwordResetExpires).not.toBeNull();
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('stops issuing fresh reset emails after the per-account hourly limit is reached', async () => {
    const fixture: AuthFixture = { userIds: [] };
    const app = await buildApp();

    try {
      const { user } = await createVerifiedUser(fixture, {});

      await prisma.emailLog.createMany({
        data: Array.from({ length: AUTH_CONFIG.PASSWORD_RESET_MAX_EMAILS_PER_HOUR }, (_, index) => ({
          userId: user.id,
          emailType: 'PASSWORD_RESET_OTP',
          provider: 'BREVO',
          recipientEmail: user.email,
          subject: `Reset attempt ${index + 1}`,
          status: 'sent',
          sentAt: new Date(Date.now() - index * 5 * 60 * 1000)
        }))
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/forgot-password',
        payload: {
          email: user.email
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        message: 'If an account exists for that email, we sent a 6-digit code you can use to reset your password.'
      });

      const refreshedUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          passwordResetToken: true,
          passwordResetExpires: true
        }
      });
      const latestAudit = await prisma.auditLog.findFirst({
        where: {
          userId: user.id,
          action: 'PASSWORD_RESET_REQUESTED'
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      expect(refreshedUser.passwordResetToken).toBeNull();
      expect(refreshedUser.passwordResetExpires).toBeNull();
      expect(latestAudit?.metadata).toEqual(expect.objectContaining({
        delivered: false,
        reason: 'account_hourly_limit_exceeded'
      }));
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('stops issuing reset emails when the source IP has exceeded the hourly limit', async () => {
    const fixture: AuthFixture = { userIds: [] };
    const app = await buildApp();

    try {
      const { user } = await createVerifiedUser(fixture, {});
      const attackIp = '203.0.113.44';

      await prisma.auditLog.createMany({
        data: Array.from({ length: AUTH_CONFIG.PASSWORD_RESET_MAX_REQUESTS_PER_IP_PER_HOUR }, (_, index) => ({
          action: 'PASSWORD_RESET_REQUESTED',
          ipAddress: attackIp,
          metadata: {
            delivered: false,
            reason: `seed_limit_${index + 1}`
          }
        }))
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/forgot-password',
        remoteAddress: attackIp,
        payload: {
          email: user.email
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        message: 'If an account exists for that email, we sent a 6-digit code you can use to reset your password.'
      });

      const refreshedUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          passwordResetToken: true,
          passwordResetExpires: true
        }
      });
      const audit = await prisma.auditLog.findFirst({
        where: {
          ipAddress: attackIp,
          action: 'PASSWORD_RESET_REQUESTED'
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      expect(refreshedUser.passwordResetToken).toBeNull();
      expect(refreshedUser.passwordResetExpires).toBeNull();
      expect(audit?.metadata).toEqual(expect.objectContaining({
        delivered: false,
        reason: 'ip_hourly_limit_exceeded'
      }));
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('invalidates the reset challenge after too many wrong OTP attempts', async () => {
    const fixture: AuthFixture = { userIds: [] };
    const app = await buildApp();

    try {
      const { user } = await createVerifiedUser(fixture, {});

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: await hashOtp('123456'),
          passwordResetExpires: new Date(Date.now() + AUTH_CONFIG.PASSWORD_RESET_OTP_EXPIRY_MS),
          passwordResetAttemptCount: AUTH_CONFIG.PASSWORD_RESET_MAX_VERIFY_ATTEMPTS - 1
        }
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/reset-password',
        payload: {
          email: user.email,
          otp: '000000',
          newPassword: 'ResetPass456!',
          confirmNewPassword: 'ResetPass456!'
        }
      });

      expect(response.statusCode).toBe(429);
      expect(response.json()).toEqual(expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'PASSWORD_RESET_ATTEMPT_LIMIT_EXCEEDED'
        })
      }));

      const refreshedUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          passwordResetToken: true,
          passwordResetExpires: true
        }
      });

      expect(refreshedUser.passwordResetToken).toBeNull();
      expect(refreshedUser.passwordResetExpires).toBeNull();
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('rejects password reset after the daily password change cap has been reached', async () => {
    const fixture: AuthFixture = { userIds: [] };
    const app = await buildApp();

    try {
      const { user } = await createVerifiedUser(fixture, {});
      const now = new Date();

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: await hashOtp('123456'),
          passwordResetExpires: new Date(now.getTime() + AUTH_CONFIG.PASSWORD_RESET_OTP_EXPIRY_MS)
        }
      });

      await prisma.auditLog.createMany({
        data: Array.from({ length: AUTH_CONFIG.PASSWORD_CHANGE_DAILY_LIMIT }, (_, index) => ({
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
        method: 'POST',
        url: '/api/auth/reset-password',
        payload: {
          email: user.email,
          otp: '123456',
          newPassword: 'ResetPass456!',
          confirmNewPassword: 'ResetPass456!'
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
});

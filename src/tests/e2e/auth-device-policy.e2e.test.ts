import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import prisma from '../../config/database';
import { hashPassword, hashOtp } from '../../shared/utils/hash';

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

function premiumDevicePayloadVariant(
  seed: string,
  overrides: Partial<{
    installationId: string;
    deviceName: string;
    browserName: string;
    browserVersion: string;
    userAgent: string;
  }>
) {
  return {
    device: {
      ...premiumDevicePayload(seed).device,
      ...overrides
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
      email: input.email || `${uniqueToken('auth-user')}@example.com`,
      passwordHash: await hashPassword(password),
      fullName: uniqueToken('Auth User'),
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

async function cleanupFixture(fixture: AuthFixture): Promise<void> {
  if (fixture.userIds.length === 0) return;

  await prisma.premiumEntitlement.deleteMany({
    where: {
      OR: [
        { userId: { in: fixture.userIds } },
        { grantedByAdminId: { in: fixture.userIds } },
        { revokedByAdminId: { in: fixture.userIds } }
      ]
    }
  });

  await prisma.userSession.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.userDevice.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.auditLog.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.user.deleteMany({
    where: { id: { in: fixture.userIds } }
  });
}

describeE2E('Auth premium device policy (HTTP e2e)', () => {
  it('registers with email OTP only and keeps free users out of device registry', async () => {
    const fixture: AuthFixture = { userIds: [] };
    const app = await buildApp();

    try {
      const email = `${uniqueToken('register')}@example.com`;
      const password = 'SecurePass123!';

      const registerResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          email,
          password,
          fullName: 'Register User'
        }
      });

      expect(registerResponse.statusCode).toBe(201);
      expect(registerResponse.json()).toMatchObject({
        requiresOTP: true,
        verificationType: 'EMAIL_VERIFICATION'
      });

      const user = await prisma.user.findUniqueOrThrow({
        where: { email }
      });
      fixture.userIds.push(user.id);

      const deviceCountBefore = await prisma.userDevice.count({
        where: { userId: user.id }
      });
      expect(deviceCountBefore).toBe(0);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          verificationToken: await hashOtp('123456'),
          tokenExpiresAt: new Date(Date.now() + 10 * 60 * 1000)
        }
      });

      const verifyResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/verify-otp',
        payload: {
          email,
          otp: '123456'
        }
      });

      expect(verifyResponse.statusCode).toBe(200);
      const verifyBody = verifyResponse.json() as any;
      expect(verifyBody.requiresOTP).toBe(false);
      expect(verifyBody.accessToken).toBeTruthy();

      const deviceCountAfter = await prisma.userDevice.count({
        where: { userId: user.id }
      });
      const sessionCount = await prisma.userSession.count({
        where: {
          userId: user.id,
          isActive: true
        }
      });

      expect(deviceCountAfter).toBe(0);
      expect(sessionCount).toBe(1);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  });

  it('lets free users keep multiple active sessions without device OTP', async () => {
    const fixture: AuthFixture = { userIds: [] };
    const app = await buildApp();

    try {
      const { user, password } = await createVerifiedUser(fixture, {
        isPremium: false,
        deviceAccessMode: 'FREE'
      });

      const loginA = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password
        }
      });

      const loginB = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password
        }
      });

      expect(loginA.statusCode).toBe(200);
      expect(loginB.statusCode).toBe(200);
      expect(loginA.json()).toMatchObject({ requiresOTP: false });
      expect(loginB.json()).toMatchObject({ requiresOTP: false });

      const activeSessionCount = await prisma.userSession.count({
        where: {
          userId: user.id,
          isActive: true
        }
      });
      const deviceCount = await prisma.userDevice.count({
        where: { userId: user.id }
      });

      expect(activeSessionCount).toBe(2);
      expect(deviceCount).toBe(0);

      const meResponse = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer ${(loginA.json() as any).accessToken}`
        }
      });

      expect(meResponse.statusCode).toBe(200);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  });

  it('forces premium users into a fresh two-device policy and uses OTP for the second device', async () => {
    const fixture: AuthFixture = { userIds: [] };
    const app = await buildApp();

    try {
      const { user, password } = await createVerifiedUser(fixture, {
        isPremium: false,
        deviceAccessMode: 'FREE'
      });

      const freeLoginA = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password
        }
      });

      const freeLoginB = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password
        }
      });

      expect(freeLoginA.statusCode).toBe(200);
      expect(freeLoginB.statusCode).toBe(200);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          isPremium: true,
          subscriptionEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      });

      await prisma.premiumEntitlement.create({
        data: {
          userId: user.id,
          grantedByAdminId: user.id,
          kind: 'MANUAL',
          startsAt: new Date(),
          endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          note: 'Test premium upgrade entitlement.'
        }
      });

      const premiumLoginA = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password,
          ...premiumDevicePayload('device-a')
        }
      });

      expect(premiumLoginA.statusCode).toBe(200);
      expect(premiumLoginA.json()).toMatchObject({ requiresOTP: false });

      const refreshedUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          deviceAccessMode: true,
          authPolicyVersion: true
        }
      });

      const activeSessionsAfterUpgrade = await prisma.userSession.count({
        where: {
          userId: user.id,
          isActive: true
        }
      });
      const verifiedDevicesAfterUpgrade = await prisma.userDevice.count({
        where: {
          userId: user.id,
          isVerified: true
        }
      });

      expect(refreshedUser.deviceAccessMode).toBe('PREMIUM');
      expect(refreshedUser.authPolicyVersion).toBe(1);
      expect(activeSessionsAfterUpgrade).toBe(1);
      expect(verifiedDevicesAfterUpgrade).toBe(1);

      const oldFreeSessionCheck = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer ${(freeLoginA.json() as any).accessToken}`
        }
      });

      expect(oldFreeSessionCheck.statusCode).toBe(401);

      const premiumLoginB = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password,
          ...premiumDevicePayload('device-b')
        }
      });

      expect(premiumLoginB.statusCode).toBe(200);
      expect(premiumLoginB.json()).toMatchObject({
        requiresOTP: true,
        verificationType: 'DEVICE_REGISTRATION'
      });

      const pendingDevice = await prisma.userDevice.findFirstOrThrow({
        where: {
          userId: user.id,
          isVerified: false
        }
      });

      await prisma.userDevice.update({
        where: { id: pendingDevice.id },
        data: {
          verificationTokenHash: await hashOtp('654321'),
          verificationTokenExpiresAt: new Date(Date.now() + 10 * 60 * 1000)
        }
      });

      const verifySecondDevice = await app.inject({
        method: 'POST',
        url: '/api/auth/verify-otp',
        payload: {
          email: user.email,
          otp: '654321',
          ...premiumDevicePayload('device-b')
        }
      });

      expect(verifySecondDevice.statusCode).toBe(200);
      expect(verifySecondDevice.json()).toMatchObject({ requiresOTP: false });

      const activeSessionsAfterSecondDevice = await prisma.userSession.count({
        where: {
          userId: user.id,
          isActive: true
        }
      });
      const verifiedDevicesAfterSecondDevice = await prisma.userDevice.count({
        where: {
          userId: user.id,
          isVerified: true
        }
      });

      expect(activeSessionsAfterSecondDevice).toBe(1);
      expect(verifiedDevicesAfterSecondDevice).toBe(2);

      const firstPremiumSessionCheck = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer ${(premiumLoginA.json() as any).accessToken}`
        }
      });

      const secondPremiumSessionCheck = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer ${(verifySecondDevice.json() as any).accessToken}`
        }
      });

      expect(firstPremiumSessionCheck.statusCode).toBe(401);
      expect(secondPremiumSessionCheck.statusCode).toBe(200);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('clears premium device registry after downgrade and returns to free multi-session login', async () => {
    const fixture: AuthFixture = { userIds: [] };
    const app = await buildApp();

    try {
      const { user, password } = await createVerifiedUser(fixture, {
        isPremium: true,
        deviceAccessMode: 'PREMIUM',
        authPolicyVersion: 1
      });

      await prisma.userDevice.createMany({
        data: [
          {
            userId: user.id,
            deviceId: 'premium-device-a',
            deviceName: 'Premium Device A',
            userAgent: 'Mozilla/5.0',
            fingerprintHash: 'hash-a',
            fingerprintData: { browserName: 'chrome' },
            isVerified: true,
            isActive: false
          },
          {
            userId: user.id,
            deviceId: 'premium-device-b',
            deviceName: 'Premium Device B',
            userAgent: 'Mozilla/5.0',
            fingerprintHash: 'hash-b',
            fingerprintData: { browserName: 'chrome' },
            isVerified: true,
            isActive: false
          }
        ]
      });

      await prisma.user.update({
        where: { id: user.id },
        data: {
          isPremium: false
        }
      });

      const freeLoginA = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password
        }
      });

      const freeLoginB = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password
        }
      });

      expect(freeLoginA.statusCode).toBe(200);
      expect(freeLoginB.statusCode).toBe(200);
      expect(freeLoginA.json()).toMatchObject({ requiresOTP: false });
      expect(freeLoginB.json()).toMatchObject({ requiresOTP: false });

      const deviceCount = await prisma.userDevice.count({
        where: { userId: user.id }
      });
      const activeSessionCount = await prisma.userSession.count({
        where: {
          userId: user.id,
          isActive: true
        }
      });
      const downgradedUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          deviceAccessMode: true
        }
      });

      expect(deviceCount).toBe(0);
      expect(activeSessionCount).toBe(2);
      expect(downgradedUser.deviceAccessMode).toBe('FREE');
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('treats the same physical web device as one premium slot across browsers', async () => {
    const fixture: AuthFixture = { userIds: [] };
    const app = await buildApp();

    try {
      const { user, password } = await createVerifiedUser(fixture, {
        isPremium: true,
        deviceAccessMode: 'PREMIUM',
        authPolicyVersion: 1
      });

      const chromeLogin = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password,
          ...premiumDevicePayload('shared-laptop')
        }
      });

      expect(chromeLogin.statusCode).toBe(200);
      expect(chromeLogin.json()).toMatchObject({ requiresOTP: false });

      const edgeLogin = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password,
          ...premiumDevicePayloadVariant('shared-laptop', {
            installationId: 'shared-laptop-edge-install',
            deviceName: 'Edge on shared laptop',
            browserName: 'edge',
            browserVersion: '124.0',
            userAgent: 'Mozilla/5.0 Edge/124.0'
          })
        }
      });

      expect(edgeLogin.statusCode).toBe(200);
      expect(edgeLogin.json()).toMatchObject({ requiresOTP: false });

      const deviceCount = await prisma.userDevice.count({
        where: {
          userId: user.id,
          isVerified: true
        }
      });
      const activeSessionCount = await prisma.userSession.count({
        where: {
          userId: user.id,
          isActive: true
        }
      });

      expect(deviceCount).toBe(1);
      expect(activeSessionCount).toBe(1);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('exempts admin accounts from premium device limits and OTP device approval', async () => {
    const fixture: AuthFixture = { userIds: [] };
    const app = await buildApp();

    try {
      const { user, password } = await createVerifiedUser(fixture, {
        isPremium: true,
        deviceAccessMode: 'PREMIUM',
        authPolicyVersion: 1,
      });

      await prisma.user.update({
        where: { id: user.id },
        data: {
          role: 'ADMIN'
        }
      });

      const firstLogin = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password,
          ...premiumDevicePayload('admin-device-a')
        }
      });

      const secondLogin = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password,
          ...premiumDevicePayload('admin-device-b')
        }
      });

      expect(firstLogin.statusCode).toBe(200);
      expect(secondLogin.statusCode).toBe(200);
      expect(firstLogin.json()).toMatchObject({ requiresOTP: false });
      expect(secondLogin.json()).toMatchObject({ requiresOTP: false });

      const deviceCount = await prisma.userDevice.count({
        where: { userId: user.id }
      });
      const activeSessionCount = await prisma.userSession.count({
        where: {
          userId: user.id,
          isActive: true
        }
      });

      expect(deviceCount).toBe(0);
      expect(activeSessionCount).toBe(2);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);
});

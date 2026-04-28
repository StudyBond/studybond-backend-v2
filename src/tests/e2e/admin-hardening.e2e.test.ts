import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import prisma from '../../config/database';
import { adminService } from '../../modules/admin/admin.service';
import { devOtpPreviewService } from '../../shared/devtools/otp-preview.service';
import { hashPassword } from '../../shared/utils/hash';
import { generateTokens } from '../../shared/utils/jwt';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeE2E = runIntegration ? describe : describe.skip;
const DEV_TOOLS_TOKEN = 'integration-dev-tools-token';
const originalDevOtpEnv = {
  DEV_OTP_PREVIEW_ENABLED: process.env.DEV_OTP_PREVIEW_ENABLED,
  DEV_TOOLS_TOKEN: process.env.DEV_TOOLS_TOKEN
};

interface AdminFixture {
  userIds: number[];
}

function uniqueToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

async function createUserFixture(
  fixture: AdminFixture,
  input: Partial<{
    email: string;
    password: string;
    role: 'USER' | 'ADMIN' | 'SUPERADMIN';
    isPremium: boolean;
    deviceAccessMode: 'FREE' | 'PREMIUM';
    authPolicyVersion: number;
  }> = {}
) {
  const password = input.password || 'SecurePass123!';
  const user = await prisma.user.create({
    data: {
      email: input.email || `${uniqueToken('admin-user')}@example.com`,
      passwordHash: await hashPassword(password),
      fullName: uniqueToken('Admin Fixture User'),
      isVerified: true,
      role: input.role ?? 'USER',
      isPremium: input.isPremium ?? false,
      deviceAccessMode: input.deviceAccessMode ?? (input.isPremium ? 'PREMIUM' : 'FREE'),
      authPolicyVersion: input.authPolicyVersion ?? 0
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
  const deviceId = input.deviceId || uniqueToken('admin-device');
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

async function requestSuperadminStepUpToken(
  app: Awaited<ReturnType<typeof buildApp>>,
  authHeader: string,
  email: string
): Promise<string> {
  const requestResponse = await app.inject({
    method: 'POST',
    url: '/api/admin/step-up/request',
    headers: {
      authorization: authHeader
    }
  });

  expect(requestResponse.statusCode).toBe(200);
  const challenge = requestResponse.json();
  expect(challenge.challengeId).toBeTruthy();

  const previewResponse = await app.inject({
    method: 'GET',
    url: `/internal/dev/otp-previews?email=${encodeURIComponent(email)}&emailType=ADMIN_STEP_UP_OTP&limit=1`,
    headers: {
      'x-dev-tools-token': DEV_TOOLS_TOKEN
    }
  });

  expect(previewResponse.statusCode).toBe(200);
  const previewPayload = previewResponse.json();
  expect(previewPayload.previews).toHaveLength(1);
  expect(previewPayload.previews[0].otpCode).toMatch(/^\d{6}$/);

  const verifyResponse = await app.inject({
    method: 'POST',
    url: '/api/admin/step-up/verify',
    headers: {
      authorization: authHeader
    },
    payload: {
      challengeId: challenge.challengeId,
      otp: previewPayload.previews[0].otpCode
    }
  });

  expect(verifyResponse.statusCode).toBe(200);
  return verifyResponse.json().stepUpToken;
}

async function cleanupFixture(fixture: AdminFixture): Promise<void> {
  if (fixture.userIds.length === 0) return;

  await prisma.idempotencyRecord.deleteMany({
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

  await prisma.user.deleteMany({
    where: { id: { in: fixture.userIds } }
  });
}

describeE2E('Admin hardening (HTTP e2e)', () => {
  it('removes a premium user device through the canonical admin support route and invalidates device sessions', async () => {
    const fixture: AdminFixture = { userIds: [] };
    process.env.DEV_OTP_PREVIEW_ENABLED = 'true';
    process.env.DEV_TOOLS_TOKEN = DEV_TOOLS_TOKEN;
    const app = await buildApp();
    const premiumDeviceId = 'fp:81209701cd897044fa40344e74a314114057905e3a67d32950f4c70dc8c13787';

    try {
      const { user: admin } = await createUserFixture(fixture, {
        role: 'ADMIN'
      });
      const { user: targetUser } = await createUserFixture(fixture, {
        isPremium: true,
        deviceAccessMode: 'PREMIUM',
        authPolicyVersion: 1
      });
      const adminAuthHeader = await createAuthHeader(admin);

      const targetSession = await prisma.userSession.create({
        data: {
          userId: targetUser.id,
          deviceId: premiumDeviceId,
          isActive: true,
          authPolicyVersion: 1,
          tokenVersion: 0,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });

      const device = await prisma.userDevice.create({
        data: {
          userId: targetUser.id,
          deviceId: premiumDeviceId,
          deviceName: 'Lost Premium Device',
          userAgent: 'Mozilla/5.0',
          fingerprintHash: 'fingerprint-hash',
          fingerprintData: { browserName: 'chrome' },
          isVerified: true,
          isActive: true
        }
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${targetUser.id}/devices/${device.deviceId}/remove`,
        headers: {
          authorization: adminAuthHeader,
          'idempotency-key': uniqueToken('admin-remove-device')
        },
        payload: {
          reason: 'User lost the old phone'
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        success: true,
        message: 'Device removed successfully'
      });

      const deletedDevice = await prisma.userDevice.findUnique({
        where: { id: device.id }
      });
      const refreshedSession = await prisma.userSession.findUniqueOrThrow({
        where: { id: targetSession.id }
      });
      const auditLog = await prisma.adminAuditLog.findFirst({
        where: {
          actorId: admin.id,
          action: 'DEVICE_REMOVED',
          targetId: device.deviceId
        }
      });

      expect(deletedDevice).toBeNull();
      expect(refreshedSession.isActive).toBe(false);
      expect(auditLog).not.toBeNull();
    } finally {
      await devOtpPreviewService.clear({});
      await cleanupFixture(fixture);
      process.env.DEV_OTP_PREVIEW_ENABLED = originalDevOtpEnv.DEV_OTP_PREVIEW_ENABLED;
      process.env.DEV_TOOLS_TOKEN = originalDevOtpEnv.DEV_TOOLS_TOKEN;
      await app.close();
    }
  }, 120000);

  it('keeps the legacy delete-device route working while the admin UI migrates', async () => {
    const fixture: AdminFixture = { userIds: [] };
    process.env.DEV_OTP_PREVIEW_ENABLED = 'true';
    process.env.DEV_TOOLS_TOKEN = DEV_TOOLS_TOKEN;
    const app = await buildApp();

    try {
      const { user: admin } = await createUserFixture(fixture, {
        role: 'ADMIN'
      });
      const { user: targetUser } = await createUserFixture(fixture, {
        isPremium: true,
        deviceAccessMode: 'PREMIUM',
        authPolicyVersion: 1
      });
      const adminAuthHeader = await createAuthHeader(admin);

      await prisma.userSession.create({
        data: {
          userId: targetUser.id,
          deviceId: 'legacy-device-id',
          isActive: true,
          authPolicyVersion: 1,
          tokenVersion: 0,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });

      const device = await prisma.userDevice.create({
        data: {
          userId: targetUser.id,
          deviceId: 'legacy-device-id',
          deviceName: 'Legacy Device',
          userAgent: 'Mozilla/5.0',
          fingerprintHash: 'legacy-hash',
          fingerprintData: { browserName: 'chrome' },
          isVerified: true,
          isActive: true
        }
      });

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/admin/devices/${device.id}`,
        headers: {
          authorization: adminAuthHeader,
          'idempotency-key': uniqueToken('admin-remove-device-legacy')
        },
        payload: {
          userId: targetUser.id,
          reason: 'Legacy admin client support'
        }
      });

      expect(response.statusCode).toBe(200);

      const deletedDevice = await prisma.userDevice.findUnique({
        where: { id: device.id }
      });

      expect(deletedDevice).toBeNull();
    } finally {
      await devOtpPreviewService.clear({});
      await cleanupFixture(fixture);
      process.env.DEV_OTP_PREVIEW_ENABLED = originalDevOtpEnv.DEV_OTP_PREVIEW_ENABLED;
      process.env.DEV_TOOLS_TOKEN = originalDevOtpEnv.DEV_TOOLS_TOKEN;
      await app.close();
    }
  }, 120000);

  it('supports legacy delete-device requests without a body by accepting the userId in querystring', async () => {
    const fixture: AdminFixture = { userIds: [] };
    process.env.DEV_OTP_PREVIEW_ENABLED = 'true';
    process.env.DEV_TOOLS_TOKEN = DEV_TOOLS_TOKEN;
    const app = await buildApp();

    try {
      const { user: admin } = await createUserFixture(fixture, {
        role: 'ADMIN'
      });
      const { user: targetUser } = await createUserFixture(fixture, {
        isPremium: true,
        deviceAccessMode: 'PREMIUM',
        authPolicyVersion: 1
      });
      const adminAuthHeader = await createAuthHeader(admin);

      await prisma.userSession.create({
        data: {
          userId: targetUser.id,
          deviceId: 'legacy-query-device-id',
          isActive: true,
          authPolicyVersion: 1,
          tokenVersion: 0,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });

      const device = await prisma.userDevice.create({
        data: {
          userId: targetUser.id,
          deviceId: 'legacy-query-device-id',
          deviceName: 'Legacy Query Device',
          userAgent: 'Mozilla/5.0',
          fingerprintHash: 'legacy-query-hash',
          fingerprintData: { browserName: 'chrome' },
          isVerified: true,
          isActive: true
        }
      });

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/admin/devices/${device.id}?userId=${targetUser.id}`,
        headers: {
          authorization: adminAuthHeader,
          'idempotency-key': uniqueToken('admin-remove-device-legacy-query')
        }
      });

      expect(response.statusCode).toBe(200);

      const deletedDevice = await prisma.userDevice.findUnique({
        where: { id: device.id }
      });

      expect(deletedDevice).toBeNull();
    } finally {
      await devOtpPreviewService.clear({});
      await cleanupFixture(fixture);
      process.env.DEV_OTP_PREVIEW_ENABLED = originalDevOtpEnv.DEV_OTP_PREVIEW_ENABLED;
      process.env.DEV_TOOLS_TOKEN = originalDevOtpEnv.DEV_TOOLS_TOKEN;
      await app.close();
    }
  }, 120000);

  it('blocks admins from superadmin-only premium visibility at both route and service boundaries', async () => {
    const fixture: AdminFixture = { userIds: [] };
    process.env.DEV_OTP_PREVIEW_ENABLED = 'true';
    process.env.DEV_TOOLS_TOKEN = DEV_TOOLS_TOKEN;
    const app = await buildApp();

    try {
      const { user: admin } = await createUserFixture(fixture, {
        role: 'ADMIN'
      });
      const authHeader = await createAuthHeader(admin);

      const httpResponse = await app.inject({
        method: 'GET',
        url: '/api/admin/premium-users',
        headers: {
          authorization: authHeader
        }
      });

      expect(httpResponse.statusCode).toBe(403);

      await expect(
        adminService.getPremiumUsers(admin.id, admin.role, 1, 20)
      ).rejects.toMatchObject({
        statusCode: 403
      });
    } finally {
      await devOtpPreviewService.clear({});
      await cleanupFixture(fixture);
      process.env.DEV_OTP_PREVIEW_ENABLED = originalDevOtpEnv.DEV_OTP_PREVIEW_ENABLED;
      process.env.DEV_TOOLS_TOKEN = originalDevOtpEnv.DEV_TOOLS_TOKEN;
      await app.close();
    }
  }, 120000);

  it('replays superadmin promotion safely with one idempotency key and one audit record', async () => {
    const fixture: AdminFixture = { userIds: [] };
    process.env.DEV_OTP_PREVIEW_ENABLED = 'true';
    process.env.DEV_TOOLS_TOKEN = DEV_TOOLS_TOKEN;
    const app = await buildApp();

    try {
      const { user: superadmin } = await createUserFixture(fixture, {
        role: 'SUPERADMIN'
      });
      const { user: targetUser } = await createUserFixture(fixture, {
        role: 'USER'
      });
      const authHeader = await createAuthHeader(superadmin);
      const stepUpToken = await requestSuperadminStepUpToken(app, authHeader, superadmin.email);
      const idempotencyKey = uniqueToken('admin-promote');

      const firstResponse = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${targetUser.id}/promote`,
        headers: {
          authorization: authHeader,
          'idempotency-key': idempotencyKey,
          'x-admin-step-up-token': stepUpToken
        },
        payload: {
          newRole: 'ADMIN',
          reason: 'Operational delegation'
        }
      });

      const secondResponse = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${targetUser.id}/promote`,
        headers: {
          authorization: authHeader,
          'idempotency-key': idempotencyKey,
          'x-admin-step-up-token': stepUpToken
        },
        payload: {
          newRole: 'ADMIN',
          reason: 'Operational delegation'
        }
      });

      expect(firstResponse.statusCode).toBe(200);
      expect(secondResponse.statusCode).toBe(200);

      const refreshedTarget = await prisma.user.findUniqueOrThrow({
        where: { id: targetUser.id },
        select: { role: true }
      });
      const auditCount = await prisma.adminAuditLog.count({
        where: {
          actorId: superadmin.id,
          action: 'ROLE_PROMOTED',
          targetId: String(targetUser.id)
        }
      });

      expect(refreshedTarget.role).toBe('ADMIN');
      expect(auditCount).toBe(1);
    } finally {
      await devOtpPreviewService.clear({});
      await cleanupFixture(fixture);
      process.env.DEV_OTP_PREVIEW_ENABLED = originalDevOtpEnv.DEV_OTP_PREVIEW_ENABLED;
      process.env.DEV_TOOLS_TOKEN = originalDevOtpEnv.DEV_TOOLS_TOKEN;
      await app.close();
    }
  }, 120000);
});

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
const ADMIN_PREMIUM_E2E_TIMEOUT_MS = 240000;
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
    subscriptionEndDate: Date | null;
  }> = {}
) {
  const password = input.password || 'SecurePass123!';
  const user = await prisma.user.create({
    data: {
      email: input.email || `${uniqueToken('admin-premium-user')}@example.com`,
      passwordHash: await hashPassword(password),
      fullName: uniqueToken('Admin Premium Fixture'),
      isVerified: true,
      role: input.role ?? 'USER',
      isPremium: input.isPremium ?? false,
      deviceAccessMode: input.deviceAccessMode ?? (input.isPremium ? 'PREMIUM' : 'FREE'),
      authPolicyVersion: input.authPolicyVersion ?? 0,
      subscriptionEndDate: input.subscriptionEndDate ?? null
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
  const deviceId = input.deviceId || uniqueToken('admin-premium-device');
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

  await prisma.subscriptionPayment.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.subscription.deleteMany({
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

  await prisma.user.deleteMany({
    where: { id: { in: fixture.userIds } }
  });
}

describeE2E('Admin premium management (HTTP e2e)', () => {
  it('lets a superadmin grant premium to a free user and invalidates old sessions for the premium policy switch', async () => {
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

      const existingFreeSession = await prisma.userSession.create({
        data: {
          userId: targetUser.id,
          deviceId: 'free-session-before-upgrade',
          isActive: true,
          authPolicyVersion: 0,
          tokenVersion: 0,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${targetUser.id}/premium/grants`,
        headers: {
          authorization: authHeader,
          'idempotency-key': uniqueToken('premium-grant'),
          'x-admin-step-up-token': stepUpToken
        },
        payload: {
          kind: 'PROMOTIONAL',
          durationDays: 30,
          note: 'Promotional campus ambassador grant.'
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        success: true,
        message: 'Premium access granted successfully.'
      });

      const refreshedUser = await prisma.user.findUniqueOrThrow({
        where: { id: targetUser.id },
        select: {
          isPremium: true,
          deviceAccessMode: true,
          authPolicyVersion: true,
          subscriptionEndDate: true
        }
      });
      const refreshedSession = await prisma.userSession.findUniqueOrThrow({
        where: { id: existingFreeSession.id }
      });
      const entitlement = await prisma.premiumEntitlement.findFirst({
        where: {
          userId: targetUser.id,
          grantedByAdminId: superadmin.id,
          kind: 'PROMOTIONAL'
        }
      });
      const auditLog = await prisma.adminAuditLog.findFirst({
        where: {
          actorId: superadmin.id,
          action: 'PREMIUM_GRANTED',
          targetId: String(targetUser.id)
        }
      });

      expect(refreshedUser.isPremium).toBe(true);
      expect(refreshedUser.deviceAccessMode).toBe('PREMIUM');
      expect(refreshedUser.authPolicyVersion).toBe(1);
      expect(refreshedUser.subscriptionEndDate).not.toBeNull();
      expect(refreshedSession.isActive).toBe(false);
      expect(entitlement).not.toBeNull();
      expect(auditLog).not.toBeNull();
    } finally {
      await devOtpPreviewService.clear({});
      await cleanupFixture(fixture);
      process.env.DEV_OTP_PREVIEW_ENABLED = originalDevOtpEnv.DEV_OTP_PREVIEW_ENABLED;
      process.env.DEV_TOOLS_TOKEN = originalDevOtpEnv.DEV_TOOLS_TOKEN;
      await app.close();
    }
  }, ADMIN_PREMIUM_E2E_TIMEOUT_MS);

  it('blocks regular admins from manually granting premium at both route and service boundaries', async () => {
    const fixture: AdminFixture = { userIds: [] };
    process.env.DEV_OTP_PREVIEW_ENABLED = 'true';
    process.env.DEV_TOOLS_TOKEN = DEV_TOOLS_TOKEN;
    const app = await buildApp();

    try {
      const { user: admin } = await createUserFixture(fixture, {
        role: 'ADMIN'
      });
      const { user: targetUser } = await createUserFixture(fixture, {
        role: 'USER'
      });
      const authHeader = await createAuthHeader(admin);

      const response = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${targetUser.id}/premium/grants`,
        headers: {
          authorization: authHeader,
          'idempotency-key': uniqueToken('premium-grant-blocked')
        },
        payload: {
          kind: 'MANUAL',
          durationDays: 14,
          note: 'Manual support premium grant.'
        }
      });

      expect(response.statusCode).toBe(403);

      await expect(
        adminService.grantPremium(
          admin.id,
          admin.role,
          {
            userId: targetUser.id,
            kind: 'MANUAL',
            durationDays: 14,
            note: 'Manual support premium grant.'
          },
          {
            idempotencyKey: uniqueToken('service-premium-grant-blocked')
          }
        )
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
  }, ADMIN_PREMIUM_E2E_TIMEOUT_MS);

  it('extends premium contiguously and exposes the grant history to superadmins', async () => {
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

      const firstGrant = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${targetUser.id}/premium/grants`,
        headers: {
          authorization: authHeader,
          'idempotency-key': uniqueToken('premium-grant-history'),
          'x-admin-step-up-token': stepUpToken
        },
        payload: {
          kind: 'MANUAL',
          durationDays: 10,
          note: 'Manual support premium grant.'
        }
      });

      expect(firstGrant.statusCode).toBe(200);

      const extendResponse = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${targetUser.id}/premium/extend`,
        headers: {
          authorization: authHeader,
          'idempotency-key': uniqueToken('premium-extend-history'),
          'x-admin-step-up-token': stepUpToken
        },
        payload: {
          kind: 'CORRECTIVE',
          durationDays: 5,
          note: 'Corrective extension after outage.'
        }
      });

      expect(extendResponse.statusCode).toBe(200);

      const historyResponse = await app.inject({
        method: 'GET',
        url: `/api/admin/users/${targetUser.id}/premium/history`,
        headers: {
          authorization: authHeader
        }
      });

      expect(historyResponse.statusCode).toBe(200);
      const history = historyResponse.json();

      expect(history.currentAccess.isPremium).toBe(true);
      expect(history.currentAccess.activeSourceTypes).toContain('ADMIN_ENTITLEMENT');
      expect(history.entitlements).toHaveLength(2);
      expect(new Date(history.currentAccess.effectiveEndDate).getTime()).toBeGreaterThan(
        new Date(history.entitlements[0].endsAt).getTime() - (24 * 60 * 60 * 1000)
      );
    } finally {
      await devOtpPreviewService.clear({});
      await cleanupFixture(fixture);
      process.env.DEV_OTP_PREVIEW_ENABLED = originalDevOtpEnv.DEV_OTP_PREVIEW_ENABLED;
      process.env.DEV_TOOLS_TOKEN = originalDevOtpEnv.DEV_TOOLS_TOKEN;
      await app.close();
    }
  }, ADMIN_PREMIUM_E2E_TIMEOUT_MS);

  it('revokes admin-issued premium without touching paid subscription state semantics', async () => {
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

      const grantResponse = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${targetUser.id}/premium/grants`,
        headers: {
          authorization: authHeader,
          'idempotency-key': uniqueToken('premium-grant-revoke'),
          'x-admin-step-up-token': stepUpToken
        },
        payload: {
          kind: 'MANUAL',
          durationDays: 7,
          note: 'Manual support recovery grant.'
        }
      });

      expect(grantResponse.statusCode).toBe(200);

      const revokeResponse = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${targetUser.id}/premium/revoke`,
        headers: {
          authorization: authHeader,
          'idempotency-key': uniqueToken('premium-revoke'),
          'x-admin-step-up-token': stepUpToken
        },
        payload: {
          note: 'Revoking manual grant after support resolution.'
        }
      });

      expect(revokeResponse.statusCode).toBe(200);
      expect(revokeResponse.json()).toMatchObject({
        success: true,
        revokedCount: 1
      });

      const refreshedUser = await prisma.user.findUniqueOrThrow({
        where: { id: targetUser.id },
        select: {
          isPremium: true,
          deviceAccessMode: true
        }
      });
      const revokedEntitlement = await prisma.premiumEntitlement.findFirstOrThrow({
        where: {
          userId: targetUser.id
        },
        select: {
          status: true,
          revokedAt: true,
          revokedByAdminId: true
        }
      });

      expect(refreshedUser.isPremium).toBe(false);
      expect(refreshedUser.deviceAccessMode).toBe('FREE');
      expect(revokedEntitlement.status).toBe('REVOKED');
      expect(revokedEntitlement.revokedAt).not.toBeNull();
      expect(revokedEntitlement.revokedByAdminId).toBe(superadmin.id);
    } finally {
      await devOtpPreviewService.clear({});
      await cleanupFixture(fixture);
      process.env.DEV_OTP_PREVIEW_ENABLED = originalDevOtpEnv.DEV_OTP_PREVIEW_ENABLED;
      process.env.DEV_TOOLS_TOKEN = originalDevOtpEnv.DEV_TOOLS_TOKEN;
      await app.close();
    }
  }, ADMIN_PREMIUM_E2E_TIMEOUT_MS);
});
